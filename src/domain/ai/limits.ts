// Beta-safe operating constants — the contract a real backend needs to enforce, not a billing
// product. None of this is wired to real infrastructure in this batch (no AWS deployment); these
// are the numbers and the interface shape a future backend implementation is expected to honor.
// See docs/ai-generation-foundation.md's "Rate limits / cost controls" section.

export const GENERATION_LIMITS = {
  /** Mirrors generationOptions.ts's ABSOLUTE_MAX_CARDS_PER_DECK — restated here as the
   * request-time ceiling a backend should reject before ever calling a provider. */
  maxCardsPerRequest: 40,
  /** Mirrors contextPreparation.ts's MAX_CONTEXT_CHAR_BUDGET. */
  maxContextCharsPerRequest: 60_000,
  /** Placeholder beta quota — a real value belongs to a future founder/product decision once a
   * provider and its real pricing are selected; kept here only so the CONTRACT (a per-user daily
   * cap must exist) is established now. */
  maxRequestsPerUserPerDay: 20,
  maxConcurrentRequestsPerUser: 1,
  // Was 30_000 — reduced to stay safely below API Gateway HTTP API's fixed, non-configurable
  // 29-second integration timeout. 30s exceeded that ceiling: API Gateway would return a generic
  // 504 at 29s while the backend Lambda still believed it had 1 more second, producing a failure
  // that never reaches the Lambda's own structured error response. 25s leaves ~4s of margin for
  // Lambda cold start, request validation, and response validation/serialization outside the
  // Bedrock call itself (which is independently bounded to 20s — see
  // backend/lambdas/ai-generate-study-deck/bedrockClient.mjs's BEDROCK_CALL_TIMEOUT_MS). Mirrored,
  // not imported, in that Lambda's own restated LIMITS — keep both in sync if this ever changes.
  requestTimeoutMs: 25_000,
} as const;

/**
 * The interface a future backend rate limiter must satisfy — no implementation exists in this
 * batch (a real one needs durable per-user counters, e.g. DynamoDB, which is explicitly out of
 * scope: "NO AWS DEPLOYMENT"). `checkAndConsume` is expected to be atomic in a real
 * implementation (check-and-increment in one operation) to avoid a race under concurrent
 * requests from the same user — that atomicity guarantee is a property of whatever real
 * implementation is built later, not something this interface can enforce by itself.
 */
export interface GenerationRateLimiter {
  checkAndConsume(userId: string): Promise<{ allowed: true } | { allowed: false; reason: "daily-quota-exceeded" | "concurrent-limit" }>;
}

/**
 * Always allows — explicitly NOT a real rate limiter. Exists only so the mobile-side mock
 * pipeline (mockProvider.ts) and its tests can exercise the full AIService flow without needing a
 * real backend. A real backend implementation must NEVER use this in place of a durable limiter —
 * see the interface doc comment above.
 */
export const NOOP_RATE_LIMITER: GenerationRateLimiter = {
  async checkAndConsume() {
    return { allowed: true };
  },
};
