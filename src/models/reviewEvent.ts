import { isReviewRating, type CardLearningState, type ReviewEvent } from "../domain/scheduling/types";

// The storage-level record for one immutable review event — see
// src/domain/scheduling/types.ts for the pure domain shape, src/domain/scheduling/reviewEvent.ts
// for how one is built, and docs/spaced-repetition-foundation.md for the full model. REVIEW
// HISTORY IS DURABLE SOURCE OF TRUTH: no deletedAt field exists here at all, deliberately — a
// review event is never soft-deleted by anything in this batch; a correction/deletion feature,
// if ever built, is explicit future functionality with its own design, not a field quietly
// riding along on this record (see Phase 2's instruction in the mission this was built from).

export type ReviewEventRecord = ReviewEvent & {
  rev: number;
  updatedAt: string;
  dirty?: boolean;
};

const VALID_STATES: readonly CardLearningState[] = ["new", "learning", "review", "relearning"];

function isValidState(value: unknown): value is CardLearningState {
  return typeof value === "string" && (VALID_STATES as readonly string[]).includes(value);
}

/** Local-data upgrade helper — see cardScheduling.ts's own doc comment for why this exists even
 * though there is no known legacy shape to migrate from yet (forward safety, consistent
 * resilience-on-read posture with every other `getXAll` storage function). Rejects (returns
 * `null`) rather than coerces anything structurally unrecognizable — a malformed review event is
 * historical-looking data this app did not actually produce, and inventing a repaired version of
 * it would be worse than dropping it. */
export function upgradeReviewEventRecord(value: any): ReviewEventRecord | null {
  if (!value || typeof value.id !== "string" || !value.id) return null;
  if (typeof value.cardId !== "string" || !value.cardId) return null;
  if (typeof value.deckId !== "string" || !value.deckId) return null;
  if (typeof value.reviewedAt !== "string" || !value.reviewedAt) return null;
  if (!isReviewRating(value.rating)) return null;
  if (!isValidState(value.previousState) || !isValidState(value.resultingState)) return null;
  if (typeof value.previousDueAt !== "string" || typeof value.nextDueAt !== "string") return null;
  if (typeof value.elapsedDays !== "number" || typeof value.scheduledDays !== "number") return null;
  if (typeof value.schedulerAlgorithm !== "string" || !value.schedulerAlgorithm) return null;
  if (typeof value.schedulerVersion !== "string" || !value.schedulerVersion) return null;

  if (typeof value.rev === "number" && typeof value.updatedAt === "string") {
    return { ...value, dirty: value.dirty ?? false };
  }

  return {
    id: value.id,
    cardId: value.cardId,
    deckId: value.deckId,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : undefined,
    reviewedAt: value.reviewedAt,
    rating: value.rating,
    previousState: value.previousState,
    resultingState: value.resultingState,
    previousDueAt: value.previousDueAt,
    nextDueAt: value.nextDueAt,
    elapsedDays: value.elapsedDays,
    scheduledDays: value.scheduledDays,
    previousStability: typeof value.previousStability === "number" ? value.previousStability : undefined,
    nextStability: typeof value.nextStability === "number" ? value.nextStability : undefined,
    previousSchedulingDifficulty: typeof value.previousSchedulingDifficulty === "number" ? value.previousSchedulingDifficulty : undefined,
    nextSchedulingDifficulty: typeof value.nextSchedulingDifficulty === "number" ? value.nextSchedulingDifficulty : undefined,
    responseTimeMs: typeof value.responseTimeMs === "number" ? value.responseTimeMs : undefined,
    schedulerAlgorithm: value.schedulerAlgorithm,
    schedulerVersion: value.schedulerVersion,
    rev: 0,
    updatedAt: new Date().toISOString(),
    dirty: false,
  };
}
