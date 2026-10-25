// Pure first-use AI consent decision logic — no storage, no UI, no React Native import. See
// src/storage/aiConsent.ts for persistence and src/ui/aiConsentDialog.ts for the Alert.alert-based
// prompt. docs/ai-generation-foundation.md's "First-use consent" section has the full policy.
//
// Versioned so a future, MATERIALLY different data-sharing behavior (not a wording tweak) can
// require renewed acknowledgment by bumping CURRENT_AI_CONSENT_VERSION — existing accepted
// records at an older version simply stop satisfying hasCurrentAiConsent, prompting again exactly
// once per user per such change.

export const CURRENT_AI_CONSENT_VERSION = 1;

export type AiConsentRecord = {
  version: number;
  /** ISO 8601 UTC — when the user tapped Continue. Never backdated, never inferred. */
  acceptedAt: string;
};

/** Rejects (never coerces) anything that doesn't look like a real, previously-accepted consent
 * record — malformed persisted state must fail safely back to "consent required," never be
 * repaired into a guessed-valid shape. */
export function isValidAiConsentRecord(value: unknown): value is AiConsentRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return typeof r.version === "number" && Number.isFinite(r.version) && typeof r.acceptedAt === "string" && r.acceptedAt.length > 0;
}

/** True only for a structurally valid record whose version EXACTLY matches the currently-
 * required one. Deliberately strict equality, not `>=`: a stored version higher than
 * CURRENT_AI_CONSENT_VERSION should be impossible under correct operation, and treating it as
 * valid would mean a corrupt/unexpected future value silently passes instead of failing closed.
 * A record at an older version, a higher version, or anything malformed/absent all mean consent
 * must be shown again. */
export function hasCurrentAiConsent(record: unknown): boolean {
  return isValidAiConsentRecord(record) && record.version === CURRENT_AI_CONSENT_VERSION;
}

export function buildAiConsentRecord(now: Date): AiConsentRecord {
  return { version: CURRENT_AI_CONSENT_VERSION, acceptedAt: now.toISOString() };
}

/**
 * The single decision point: does THIS generation attempt need to show the consent prompt first?
 * Takes `isRealProviderActive` as a plain boolean (not a function call) specifically so this stays
 * pure and testable — the real caller (the Generate screen) resolves that boolean from
 * providerSelection.ts's isRealProviderActive() once, immediately before calling this.
 *
 * Mock generation never needs consent, regardless of stored state — "do not interrupt mock
 * generation unnecessarily."
 */
export function needsAiConsent(isRealProviderActive: boolean, storedRecord: unknown): boolean {
  if (!isRealProviderActive) return false;
  return !hasCurrentAiConsent(storedRecord);
}
