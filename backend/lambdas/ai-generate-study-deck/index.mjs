// Backend Lambda for Generate Study Deck. NOT YET DEPLOYED — not wired into any CDK stack, API
// Gateway route, or IAM policy in this repository (Phase A of the Bedrock integration; see
// docs/ai-generation-foundation.md's "Backend architecture" section and the Bedrock integration
// audit/implementation reports). Deploying this — creating the Lambda/role/route in CDK, granting
// IAM, or configuring real environment variables against a live stack — is Phase B, its own
// separate, founder-approved AWS change, same as any other AWS mutation in this repository (see
// CLAUDE.md's "Environment Safety").
//
// The Bedrock Runtime call itself IS implemented in this batch (see bedrockClient.mjs), using
// Amazon Nova 2 Lite as the first configured model — but the model/inference-profile identifier
// is read only from this Lambda's own BEDROCK_MODEL_ID environment variable (see callModelProvider
// below), never hardcoded as a product constant. No credential of any kind is read from an Expo/
// client env var, embedded in mobile code, or logged — only read from this Lambda's own
// server-side environment configuration (via IAM, once Phase B grants it — Bedrock requires no
// API key when the Lambda's execution role has invoke permission).
//
// Mirrors src/domain/ai/responseValidation.ts's validation RULES (not its code — "no shared
// module exists between Lambdas in this repository", same convention as
// backend/lambdas/library-source-storage/index.mjs) so a real deployment rejects exactly the same
// malformed/unsafe model output the mobile-side mock pipeline already exercises in tests.

import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

import { runGeneration } from "./bedrockClient.mjs";

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

const MAX_TITLE_LENGTH = 80;
const MAX_FRONT_LENGTH = 300;
const MAX_BACK_LENGTH = 500;

// Constructed once at module scope — reused across warm Lambda invocations rather than
// reconstructed per request. No explicit region is passed: Lambda sets AWS_REGION automatically
// to the function's own deployed region (us-east-2 for both Development and Staging — see
// infra/bin/interval-infra.ts), and the SDK v3 client resolves it from that without this file
// needing to know or hardcode it. maxAttempts is set explicitly to 2 (one retry beyond the
// initial attempt) — the ONLY retry mechanism anywhere in this Lambda; bedrockClient.mjs's
// runGeneration performs no retry of its own, so retries are never stacked across two layers.
const bedrockClient = new BedrockRuntimeClient({ maxAttempts: 2 });

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
function validateModelResponse(raw, contextChunkIds) {
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

// Placeholder only — a real implementation needs a durable, atomic, per-user counter (e.g.
// DynamoDB conditional update), which is explicitly out of scope here ("NO AWS DEPLOYMENT" /
// "NO CDK RESOURCE CHANGES" for this batch). Always allows, so this Lambda cannot be mistaken for
// a working rate limiter if it were ever accidentally deployed as-is.
async function checkRateLimit(_sub) {
  return { allowed: true };
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

  return { status: "ok", raw: result.raw };
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

    const rateLimit = await checkRateLimit(sub);
    if (!rateLimit.allowed) return resp(429, { error: "rate-limited", reason: rateLimit.reason });

    const providerResult = await callModelProvider(request, context, deps);
    if (providerResult.status === "error") {
      return resp(502, { error: providerResult.code, message: providerResult.message });
    }

    const contextChunkIds = new Set(context.chunks.map((chunk) => chunk.id));
    const validation = validateModelResponse(providerResult.raw, contextChunkIds);
    if (validation.status === "invalid") {
      return resp(422, { error: "validation-failed", deckIssues: validation.deckIssues, cardIssues: validation.cardIssues || [] });
    }

    return resp(200, {
      title: validation.title,
      cards: validation.cards,
      generation: {
        generationContractVersion: GENERATION_CONTRACT_VERSION,
        normalizationVersion: request.normalizationVersion,
        sourceId: request.sourceId,
        selectedChunkIds: request.selectedChunkIds,
        requestedCardCount: request.requestedCardCount,
        resultingCardCount: validation.cards.length,
        generatedAt: new Date().toISOString(),
        issues: validation.cardIssues || [],
      },
    });
  } catch (e) {
    // Exception class name only — never a message, stack, or any fragment of source/model
    // content. See this repository's logging guardrails (CLAUDE.md) and this file's own header.
    console.log("[ai-generate-study-deck] unhandled error:", e?.name || "UnknownError");
    return resp(500, { error: "internal-error" });
  }
}

export const handler = async (event) => handleGenerateStudyDeck(event);
