// Backend Lambda for Generate Study Deck. Implemented in CDK (Development-only — see
// infra/lib/interval-sync-stack.ts), but no `cdk deploy` has been run from this repository for
// this change or any prior one; see CLAUDE.md's "Environment Safety" for the standing rule that
// any AWS deployment requires its own separate, explicit founder approval every time.
//
// The Bedrock Runtime call itself is implemented (see bedrockClient.mjs), using Amazon Nova 2
// Lite as the first configured model — but the model/inference-profile identifier is read only
// from this Lambda's own BEDROCK_MODEL_ID environment variable (see callModelProvider below),
// never hardcoded as a product constant. No credential of any kind is read from an Expo/client
// env var, embedded in mobile code, or logged — only read from this Lambda's own server-side
// environment configuration (Bedrock requires no API key when the Lambda's execution role has
// invoke permission; DynamoDB access below is likewise IAM-only, no credential of any kind).
//
// Mirrors src/domain/ai/responseValidation.ts's validation RULES (not its code — "no shared
// module exists between Lambdas in this repository", same convention as
// backend/lambdas/library-source-storage/index.mjs) so a real deployment rejects exactly the same
// malformed/unsafe model output the mobile-side mock pipeline already exercises in tests.
//
// RATE LIMITING AND USAGE METERING are implemented in this batch (see rateLimiter.mjs) — a
// durable, atomic, per-user DynamoDB-backed daily quota and concurrency lease, replacing the
// previous always-allow placeholder. See docs/ai-generation-foundation.md's "Rate limits and
// cost controls" section for the full policy this enforces.

import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { runGeneration } from "./bedrockClient.mjs";
import { acquireConcurrencyLease, checkAndConsumeDailyQuota, releaseConcurrencyLease } from "./rateLimiter.mjs";

const GENERATION_CONTRACT_VERSION = 1;

// Mirrors src/domain/ai/limits.ts's GENERATION_LIMITS — restated here, not imported, per the
// no-shared-module convention above.
const LIMITS = {
  maxCardsPerRequest: 40,
  maxContextCharsPerRequest: 60_000,
  maxRequestsPerUserPerDay: 20,
  maxConcurrentRequestsPerUser: 1,
  // Was 30_000 — reduced to stay safely below API Gateway HTTP API's fixed, non-configurable
  // 29-second integration timeout. 30s exceeded that ceiling: API Gateway would return a generic
  // 504 at 29s while this Lambda still believed it had 1 more second, producing a failure that
  // never reaches this Lambda's own structured error response. 25s leaves ~4s of margin for
  // Lambda cold start, request validation, and response validation/serialization outside the
  // Bedrock call itself (which is independently bounded to 20s — see bedrockClient.mjs's
  // BEDROCK_CALL_TIMEOUT_MS).
  requestTimeoutMs: 25_000,
};

// Centralized rate-limit/cost-guardrail configuration — the three values a future tuning pass
// would touch, kept together and named plainly rather than scattered as magic numbers through
// checkRateLimit below. DAILY_REQUEST_LIMIT/MAX_CONCURRENT_REQUESTS mirror LIMITS above (which
// mirrors src/domain/ai/limits.ts) — restated here as their own object because these three are
// specifically the operational knobs this policy is built around, not every request-shape
// ceiling LIMITS also enforces.
const RATE_LIMIT_CONFIG = {
  DAILY_REQUEST_LIMIT: LIMITS.maxRequestsPerUserPerDay,
  // Always 1 in this batch. rateLimiter.mjs's single fixed-SK ("LEASE") lease design is built
  // specifically for a one-slot-per-user model and does not generalize to a higher concurrency
  // ceiling without a different key scheme (e.g. a bounded set of lease slots) — raising this
  // alone would not be sufficient if that ever changes.
  MAX_CONCURRENT_REQUESTS: LIMITS.maxConcurrentRequestsPerUser,
  // Comfortably longer than this Lambda's own CDK-configured timeout (28s, Phase B) so a
  // crashed/timed-out invocation's lease has already expired by the time any plausible retry or
  // follow-up request could arrive — see rateLimiter.mjs's acquireConcurrencyLease.
  LEASE_TTL_SECONDS: 60,
  // Cleanup only, not the correctness mechanism (the UTC-date partition key in quotaKey() is) —
  // generous enough that a delayed DynamoDB TTL sweep can never delete a row still legitimately
  // in use.
  QUOTA_ROW_TTL_SECONDS: 172_800,
};

const MAX_TITLE_LENGTH = 80;
const MAX_FRONT_LENGTH = 300;
const MAX_BACK_LENGTH = 500;

// Mirrors src/domain/ai/responseValidation.ts's deriveGenerationStatus exactly — restated, not
// imported (no shared module between Lambdas/mobile). Deliberately a pure function of the actual
// accepted count vs. the tier's quality floor, never the model's own self-reported
// generationStatus — see that file's doc comment for the full fail-safe rationale.
function deriveGenerationStatus(resultingCardCount, targetMinimumCardCount) {
  return resultingCardCount >= targetMinimumCardCount ? "complete" : "insufficient-distinct-content";
}

// Constructed once at module scope — reused across warm Lambda invocations rather than
// reconstructed per request. No explicit region is passed: Lambda sets AWS_REGION automatically
// to the function's own deployed region (us-east-2 for both Development and Staging — see
// infra/bin/interval-infra.ts), and the SDK v3 client resolves it from that without this file
// needing to know or hardcode it. maxAttempts is set explicitly to 2 (one retry beyond the
// initial attempt) — the ONLY retry mechanism anywhere in this Lambda; bedrockClient.mjs's
// runGeneration performs no retry of its own, so retries are never stacked across two layers.
const bedrockClient = new BedrockRuntimeClient({ maxAttempts: 2 });

// Same reuse-across-warm-invocations reasoning as bedrockClient above. @aws-sdk/client-dynamodb
// is reliably bundled in the Lambda Node.js runtime (unlike @aws-sdk/client-bedrock-runtime —
// see package.json's own header comment), so no extra dependency/packaging step is needed for
// this client, exactly like sync-push/sync-pull's own DynamoDB usage.
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function resp(statusCode, obj) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj),
  };
}

// Identical helper to backend/lambdas/library-source-storage/index.mjs — duplicated
// deliberately, not imported (see file header).
function getUserSub(event) {
  const subV2 = event?.requestContext?.authorizer?.jwt?.claims?.sub;
  if (typeof subV2 === "string" && subV2.length) return subV2;

  const subV1 = event?.requestContext?.authorizer?.claims?.sub;
  if (typeof subV1 === "string" && subV1.length) return subV1;

  const subLoose = event?.requestContext?.authorizer?.sub;
  if (typeof subLoose === "string" && subLoose.length) return subLoose;

  return null;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Structural + size-ceiling checks on the INCOMING request — rejects before any rate-limit
// consumption or provider call, so a malformed request never counts against a user's quota.
function validateRequestBody(body) {
  if (!isPlainObject(body)) return { error: "invalid-json" };

  const { request, context } = body;
  if (!isPlainObject(request) || !isPlainObject(context)) return { error: "malformed-request" };

  if (typeof request.sourceId !== "string" || request.sourceId.length === 0) return { error: "malformed-request" };
  if (request.generationContractVersion !== GENERATION_CONTRACT_VERSION) return { error: "unsupported-contract-version" };
  if (typeof request.requestedCardCount !== "number" || request.requestedCardCount < 1 || request.requestedCardCount > LIMITS.maxCardsPerRequest) {
    return { error: "invalid-requested-card-count" };
  }
  // Mirrors the requestedCardCount check above — the companion quality floor must be a sane
  // number that never exceeds the ceiling it's paired with (see generationOptions.ts's
  // resolveTargetMinimumCardCount, which this request field is always computed from client-side).
  if (
    typeof request.targetMinimumCardCount !== "number" ||
    request.targetMinimumCardCount < 1 ||
    request.targetMinimumCardCount > request.requestedCardCount
  ) {
    return { error: "invalid-requested-card-count" };
  }
  if (!Array.isArray(request.selectedChunkIds) || !request.selectedChunkIds.every((id) => typeof id === "string")) {
    return { error: "malformed-request" };
  }

  if (!Array.isArray(context.chunks)) return { error: "malformed-request" };

  // Never trust a client-supplied totalChars for the cost/privacy size ceiling — recompute from
  // the actual chunk text so a client can't understate size to slip past the limit.
  let computedTotalChars = 0;
  for (const chunk of context.chunks) {
    if (!isPlainObject(chunk) || typeof chunk.id !== "string" || typeof chunk.text !== "string") {
      return { error: "malformed-request" };
    }
    computedTotalChars += chunk.text.length;
  }
  if (computedTotalChars > LIMITS.maxContextCharsPerRequest) {
    return { error: "context-too-large" };
  }

  // The mobile pipeline always derives selectedChunkIds from the exact context chunks it built
  // (see aiService.ts's buildRequest) — enforce that invariant here rather than trusting a client
  // to keep the two fields in sync, so provenance/audit metadata can't silently diverge from what
  // was actually generated against.
  const contextChunkIdSet = new Set(context.chunks.map((chunk) => chunk.id));
  const selectedChunkIdSet = new Set(request.selectedChunkIds);
  if (selectedChunkIdSet.size !== contextChunkIdSet.size || ![...selectedChunkIdSet].every((id) => contextChunkIdSet.has(id))) {
    return { error: "malformed-request" };
  }

  return { request, context };
}

// Mirrors src/domain/ai/responseValidation.ts's coerce-then-validate structure and its
// structural-failure-vs-per-card-exclusion design (see that file's header comment for the
// reasoning). Kept intentionally minimal here — this Lambda is not a second source of truth for
// the validation contract; it exists so a real deployment enforces the same rules regardless of
// which provider produced the raw response.
function validateModelResponse(raw, contextChunkIds, request) {
  if (!isPlainObject(raw) || typeof raw.title !== "string" || !Array.isArray(raw.cards)) {
    return { status: "invalid", deckIssues: [{ code: "malformed-response" }] };
  }

  const title = raw.title.trim();
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    return { status: "invalid", deckIssues: [{ code: "invalid-title" }] };
  }
  if (raw.cards.length > LIMITS.maxCardsPerRequest) {
    return { status: "invalid", deckIssues: [{ code: "too-many-cards" }] };
  }
  // Tier-specific ceiling, checked before any per-card work — mirrors
  // src/domain/ai/responseValidation.ts's identical "exceeds-requested-max" check exactly.
  if (raw.cards.length > request.requestedCardCount) {
    return { status: "invalid", deckIssues: [{ code: "exceeds-requested-max" }] };
  }

  const seen = new Set();
  const cardIssues = [];
  const acceptedCards = [];

  raw.cards.forEach((card, index) => {
    if (!isPlainObject(card) || typeof card.front !== "string" || typeof card.back !== "string" || !Array.isArray(card.sourceChunkIds)) {
      return cardIssues.push({ cardIndex: index, code: "malformed-response" });
    }
    const front = card.front.trim();
    const back = card.back.trim();
    if (front.length === 0) return cardIssues.push({ cardIndex: index, code: "empty-front" });
    if (back.length === 0) return cardIssues.push({ cardIndex: index, code: "empty-back" });
    if (front.length > MAX_FRONT_LENGTH) return cardIssues.push({ cardIndex: index, code: "front-too-long" });
    if (back.length > MAX_BACK_LENGTH) return cardIssues.push({ cardIndex: index, code: "back-too-long" });
    if (card.sourceChunkIds.length === 0) return cardIssues.push({ cardIndex: index, code: "missing-provenance" });
    if (!card.sourceChunkIds.every((id) => contextChunkIds.has(id))) {
      return cardIssues.push({ cardIndex: index, code: "unknown-chunk-id" });
    }
    const dupKey = `${front.toLowerCase()}|${back.toLowerCase()}`;
    if (seen.has(dupKey)) return cardIssues.push({ cardIndex: index, code: "duplicate-card" });
    seen.add(dupKey);
    // Dedupe a card's own repeated sourceChunkIds (e.g. ["c1", "c1"]) rather than rejecting —
    // mirrors src/domain/ai/responseValidation.ts.
    acceptedCards.push({ front, back, sourceChunkIds: Array.from(new Set(card.sourceChunkIds)) });
  });

  if (acceptedCards.length === 0) {
    return { status: "invalid", deckIssues: [{ code: "no-valid-cards" }], cardIssues };
  }

  return { status: "valid", title, cards: acceptedCards, cardIssues };
}

// Resolves the DynamoDB client/table/Command constructors this call should use — real module-
// scope values by default, overridable via `deps` (index.test.mjs only; never a runtime
// configuration surface, exactly like callModelProvider's own `deps` seam below).
function resolveRateLimitDeps(deps) {
  return {
    client: deps.dynamoClient ?? dynamoClient,
    tableName: deps.rateLimitTableName ?? process.env.AI_RATE_LIMIT_TABLE,
    PutCommandCtor: deps.PutCommandCtor ?? PutCommand,
    UpdateCommandCtor: deps.UpdateCommandCtor ?? UpdateCommand,
    DeleteCommandCtor: deps.DeleteCommandCtor ?? DeleteCommand,
  };
}

/**
 * Backend-authoritative rate limiting — see rateLimiter.mjs for the real atomic DynamoDB logic.
 * Mobile-reported counters are never trusted; this is the sole source of truth.
 *
 * Order matters: the concurrency lease is acquired FIRST, and only a request that actually wins
 * the concurrency slot then consumes a daily-quota unit. A request rejected purely because
 * another one is already in flight for this user never consumes quota for that attempt — it was
 * never allowed to even begin. If the quota check itself then denies the request, the
 * just-acquired lease is released immediately rather than held for its full TTL for a request
 * that will never proceed to the provider call.
 *
 * FAILS CLOSED: if the rate-limit table isn't configured, or either DynamoDB call throws
 * anything other than a condition-check failure (i.e. "limiter state could not be safely
 * determined"), this returns `{allowed: false}` — it never falls back to allowing the request
 * through. On success, returns a bound `release()` the caller must invoke exactly once, after
 * the generation attempt finishes (success OR failure) — see handleGenerateStudyDeck below.
 */
async function checkRateLimit(sub, deps = {}) {
  const { client, tableName, PutCommandCtor, UpdateCommandCtor, DeleteCommandCtor } = resolveRateLimitDeps(deps);
  const now = deps.now ?? new Date();

  if (!tableName) {
    console.log("[ai-generate-study-deck] rate limiter unavailable: AI_RATE_LIMIT_TABLE not configured");
    return { allowed: false, reason: "limiter-unavailable" };
  }

  const release = (leaseToken) => releaseConcurrencyLease({ client, DeleteCommandCtor, tableName, sub, leaseToken });

  let lease;
  try {
    lease = await acquireConcurrencyLease({ client, PutCommandCtor, tableName, sub, now, leaseTtlSeconds: RATE_LIMIT_CONFIG.LEASE_TTL_SECONDS });
  } catch (error) {
    console.log("[ai-generate-study-deck] concurrency check failed:", error?.name || "UnknownError");
    return { allowed: false, reason: "limiter-unavailable" };
  }
  console.log("[ai-generate-study-deck] concurrency:", lease.acquired ? "allowed" : "denied");
  if (!lease.acquired) {
    return { allowed: false, reason: lease.reason };
  }

  let quota;
  try {
    quota = await checkAndConsumeDailyQuota({
      client,
      UpdateCommandCtor,
      tableName,
      sub,
      now,
      limit: RATE_LIMIT_CONFIG.DAILY_REQUEST_LIMIT,
      ttlSeconds: RATE_LIMIT_CONFIG.QUOTA_ROW_TTL_SECONDS,
    });
  } catch (error) {
    console.log("[ai-generate-study-deck] quota check failed:", error?.name || "UnknownError");
    await release(lease.leaseToken);
    return { allowed: false, reason: "limiter-unavailable" };
  }
  console.log("[ai-generate-study-deck] quota:", quota.allowed ? "allowed" : "denied");
  if (!quota.allowed) {
    await release(lease.leaseToken);
    return { allowed: false, reason: quota.reason };
  }

  return { allowed: true, release: () => release(lease.leaseToken) };
}

/**
 * Calls the configured Bedrock model and returns a provider outcome shaped exactly like the
 * mobile-side ModelProviderOutcome (src/domain/ai/aiService.ts) — `{status: "ok", raw}` or
 * `{status: "error", code, message}` using only EXISTING GenerationErrorCode values (see
 * bedrockClient.mjs's classifyBedrockError for the mapping rationale). Never returns a raw AWS
 * SDK exception message — every error branch below uses a fixed, generic, safe message.
 *
 * `deps` is an injectable override for backend/lambdas/ai-generate-study-deck/index.test.mjs only
 * (dependency injection, never a runtime configuration surface) — defaults to the real module-
 * scope client/command/timeout. No test ever imports or touches the real AWS SDK call path; see
 * bedrockClient.test.mjs for full adapter-logic coverage and this file's own test for the
 * end-to-end wiring with an injected fake client.
 */
async function callModelProvider(request, context, deps = {}) {
  // The model/inference-profile identifier is read ONLY from this Lambda's own environment
  // configuration — never hardcoded as a product/domain constant. Phase B's CDK change sets this
  // on the deployed function (see docs/ai-generation-foundation.md); nothing in this repository
  // defaults it to any specific model id.
  const modelId = process.env.BEDROCK_MODEL_ID;
  if (!modelId) {
    return {
      status: "error",
      code: "provider-unavailable",
      message: "The generation service is not configured in this environment.",
    };
  }

  const client = deps.client ?? bedrockClient;
  const CommandCtor = deps.CommandCtor ?? ConverseCommand;

  const result = await runGeneration(client, CommandCtor, modelId, request, context, deps.timeoutMs);
  if (result.status === "error") {
    return {
      status: "error",
      code: result.code,
      message: "The generation provider could not complete this request.",
    };
  }

  return { status: "ok", raw: result.raw, usage: result.usage };
}

/**
 * The real request-handling logic, factored out from the Lambda entry point so tests can inject
 * fake Bedrock dependencies (`deps`) without needing the real SDK, real credentials, or any
 * network access. `handler` below (the actual Lambda entry point AWS invokes) always calls this
 * with no override — real invocations are unaffected by this seam's existence.
 */
export async function handleGenerateStudyDeck(event, deps = {}) {
  try {
    const sub = getUserSub(event);
    if (!sub) return resp(401, { error: "unauthorized" });

    let body;
    try {
      body = event.body ? JSON.parse(event.body) : null;
    } catch {
      return resp(400, { error: "invalid-json" });
    }

    const parsed = validateRequestBody(body);
    if (parsed.error) return resp(400, { error: parsed.error });
    const { request, context } = parsed;

    // Rate limiting runs AFTER request validation (so a malformed/auth-invalid request never
    // consumes quota or a concurrency slot) and BEFORE the provider call (so quota is charged for
    // every attempt that actually reaches Bedrock — success, provider failure, or a response that
    // later fails validation — never multiple times for one attempt, and never zero times for a
    // real one; see docs/ai-generation-foundation.md's "Rate limits and cost controls" for the
    // full justification of this exact charging point).
    const rateLimit = await checkRateLimit(sub, deps);
    if (!rateLimit.allowed) {
      if (rateLimit.reason === "daily-quota-exceeded") return resp(429, { error: "daily-limit-reached" });
      if (rateLimit.reason === "concurrent-limit") return resp(429, { error: "generation-in-progress" });
      // "limiter-unavailable" — fail closed. Reuses the existing provider-unavailable code: from
      // the client's perspective this means exactly the same thing ("the generation service
      // could not be used for this request right now"), and it is not one of the two rate-limit
      // categories this batch introduces.
      return resp(503, { error: "provider-unavailable", message: "The generation service is temporarily unavailable." });
    }

    const startedAt = Date.now();
    let providerResult;
    try {
      providerResult = await callModelProvider(request, context, deps);
    } finally {
      // Always released — success AND failure — regardless of what callModelProvider returns or
      // throws, so a held slot is never left occupied longer than the actual attempt took. An
      // un-released lease still self-expires via its own TTL check (rateLimiter.mjs), so a
      // release-side hiccup here is a bounded availability cost, never a correctness one.
      await rateLimit.release();
    }
    const durationMs = Date.now() - startedAt;

    if (providerResult.status === "error") {
      // Category-level observability only — never source text, prompt, card contents, or a raw
      // provider exception (see CLAUDE.md's logging guardrails and this repository's existing
      // convention in runGeneration's own diagnostic line).
      console.log("[ai-generate-study-deck] provider outcome: failure", providerResult.code, "duration_ms:", durationMs);
      return resp(502, { error: providerResult.code, message: providerResult.message });
    }
    console.log(
      "[ai-generate-study-deck] provider outcome: success duration_ms:",
      durationMs,
      "token_usage:",
      providerResult.usage ?? "unavailable"
    );

    const contextChunkIds = new Set(context.chunks.map((chunk) => chunk.id));
    const validation = validateModelResponse(providerResult.raw, contextChunkIds, request);
    if (validation.status === "invalid") {
      return resp(422, { error: "validation-failed", deckIssues: validation.deckIssues, cardIssues: validation.cardIssues || [] });
    }

    const generationStatus = deriveGenerationStatus(validation.cards.length, request.targetMinimumCardCount);
    // Category-level aggregate counts only — never source text, prompts, or card content — so a
    // future pass can measure whether Small/Medium/Large are actually behaving as intended.
    console.log(
      "[ai-generate-study-deck] generation result:",
      "requestedMax:",
      request.requestedCardCount,
      "targetMinimum:",
      request.targetMinimumCardCount,
      "generatedCount:",
      validation.cards.length,
      "generationStatus:",
      generationStatus
    );

    return resp(200, {
      title: validation.title,
      cards: validation.cards,
      generation: {
        generationContractVersion: GENERATION_CONTRACT_VERSION,
        normalizationVersion: request.normalizationVersion,
        sourceId: request.sourceId,
        selectedChunkIds: request.selectedChunkIds,
        requestedCardCount: request.requestedCardCount,
        targetMinimumCardCount: request.targetMinimumCardCount,
        resultingCardCount: validation.cards.length,
        generationStatus,
        generatedAt: new Date().toISOString(),
        issues: validation.cardIssues || [],
      },
      // Top-level siblings of `generation`, deliberately NOT nested inside it — these are
      // provider-performance numbers (already computed above for the log lines; never fabricated
      // or estimated), not part of the generation CONTRACT metadata that review/session state
      // ever copies or persists. Added for the AI evaluation harness (docs/ai-evaluation.md) —
      // `usage` is Bedrock's own real `{inputTokens, outputTokens, totalTokens}` (never present
      // for a provider that doesn't report it), `durationMs` is this one provider call's wall-clock
      // time. Still never returned to the client on any error path above.
      usage: providerResult.usage ?? undefined,
      durationMs,
    });
  } catch (e) {
    // Exception class name only — never a message, stack, or any fragment of source/model
    // content. See this repository's logging guardrails (CLAUDE.md) and this file's own header.
    console.log("[ai-generate-study-deck] unhandled error:", e?.name || "UnknownError");
    return resp(500, { error: "internal-error" });
  }
}

export const handler = async (event) => handleGenerateStudyDeck(event);
