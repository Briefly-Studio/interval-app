// REFERENCE SKELETON — NOT DEPLOYED. Not wired into any CDK stack, API Gateway route, or IAM
// policy in this repository. Exists to make the backend half of the AI Generation Foundation
// contract concrete (see docs/ai-generation-foundation.md's "Backend architecture" section) so a
// future, explicitly founder-approved batch can wire an actual provider and deploy this without
// redesigning the request/response shape. Deploying this — or anything that calls a real model
// provider from it — requires its own separate founder approval and AWS change, same as any other
// AWS mutation in this repository (see CLAUDE.md's "Environment Safety").
//
// No provider SDK is imported here. PROVIDER_API_KEY (or any credential) is never read from an
// Expo/client env var, never embedded in mobile code, and never logged — only read from this
// Lambda's own server-side environment configuration, exactly like every other secret in this
// repository's backend.
//
// Mirrors src/domain/ai/responseValidation.ts's validation RULES (not its code — "no shared
// module exists between Lambdas in this repository", same convention as
// backend/lambdas/library-source-storage/index.mjs) so a real deployment would reject exactly the
// same malformed/unsafe model output the mobile-side mock pipeline already exercises in tests.

const GENERATION_CONTRACT_VERSION = 1;

// Mirrors src/domain/ai/limits.ts's GENERATION_LIMITS — restated here, not imported, per the
// no-shared-module convention above.
const LIMITS = {
  maxCardsPerRequest: 40,
  maxContextCharsPerRequest: 60_000,
  maxRequestsPerUserPerDay: 20,
  maxConcurrentRequestsPerUser: 1,
  requestTimeoutMs: 30_000,
};

const MAX_TITLE_LENGTH = 80;
const MAX_FRONT_LENGTH = 300;
const MAX_BACK_LENGTH = 500;

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
  if (typeof context.totalChars !== "number" || context.totalChars > LIMITS.maxContextCharsPerRequest) {
    return { error: "context-too-large" };
  }
  for (const chunk of context.chunks) {
    if (!isPlainObject(chunk) || typeof chunk.id !== "string" || typeof chunk.text !== "string") {
      return { error: "malformed-request" };
    }
  }

  return { request, context };
}

// Mirrors src/domain/ai/responseValidation.ts's coerce-then-validate structure and its
// structural-failure-vs-per-card-exclusion design (see that file's header comment for the
// reasoning). Kept intentionally minimal here — this Lambda is a reference skeleton, not a
// second source of truth for the validation contract.
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
    acceptedCards.push({ front, back, sourceChunkIds: card.sourceChunkIds });
  });

  if (acceptedCards.length === 0) {
    return { status: "invalid", deckIssues: [{ code: "no-valid-cards" }], cardIssues };
  }

  return { status: "valid", title, cards: acceptedCards, cardIssues };
}

// Placeholder only — a real implementation needs a durable, atomic, per-user counter (e.g.
// DynamoDB conditional update), which is explicitly out of scope here ("NO AWS DEPLOYMENT" for
// this batch). Always allows, so this Lambda cannot be mistaken for a working rate limiter if it
// were ever accidentally deployed as-is.
async function checkRateLimit(_sub) {
  return { allowed: true };
}

// Placeholder only — no provider SDK, no network call, no credential read. A real implementation
// sits entirely behind this one function boundary: everything above and below it (auth, request
// validation, rate limiting, response validation, error mapping) stays unchanged when a real
// provider is wired in.
async function callModelProvider(_request, _context) {
  return { status: "error", code: "provider-unavailable", message: "No model provider is configured in this reference skeleton." };
}

export const handler = async (event) => {
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

    const providerResult = await callModelProvider(request, context);
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
    console.log("[ai-generate-study-deck] unhandled error:", e?.name || "UnknownError");
    return resp(500, { error: "internal-error" });
  }
};
