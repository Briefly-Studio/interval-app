import type { ReviewEvent, SchedulerReviewOutcome, ReviewRating } from "./types";

// REVIEW EVENTS MUST BE APPEND-ONLY. Nothing in this file (or anywhere else in the app) mutates
// or deletes an existing ReviewEvent — a correction/deletion feature is explicit future work (see
// docs/spaced-repetition-foundation.md), not something this module silently permits today.

/** Deterministic, collision-resistant id for one review event. Content-addressed (not random) so
 * that re-deriving an id from the same inputs twice — e.g. a retried write after an interrupted
 * persistence — can be recognized as the same event rather than silently duplicating history;
 * never actually re-derived with the SAME inputs in today's single-write call site, but this
 * property costs nothing and directly serves "migration must be deterministic and idempotent"
 * for any future code path that might re-derive an id. Simple FNV-1a over the fields that make a
 * review event unique — not a cryptographic hash, which this does not need to be. */
export function computeReviewEventId(cardId: string, reviewedAt: string, rating: ReviewRating): string {
  const input = `${cardId}|${reviewedAt}|${rating}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export type BuildReviewEventInput = {
  cardId: string;
  deckId: string;
  sessionId?: string;
  reviewedAt: Date;
  rating: ReviewRating;
  outcome: SchedulerReviewOutcome;
  schedulerAlgorithm: string;
  schedulerVersion: string;
  /** Only ever passed when the caller directly, trustworthily measured it — see types.ts's
   * `ReviewEvent.responseTimeMs` doc comment. */
  responseTimeMs?: number;
};

/** Builds one immutable `ReviewEvent` from a scheduler decision. Pure — takes `reviewedAt`
 * explicitly rather than calling `Date.now()`, so the same inputs always produce the same event
 * (aside from the event's own id, which is itself a deterministic function of cardId/reviewedAt/
 * rating — see `computeReviewEventId`). */
export function buildReviewEvent(input: BuildReviewEventInput): ReviewEvent {
  const reviewedAtIso = input.reviewedAt.toISOString();
  return {
    id: computeReviewEventId(input.cardId, reviewedAtIso, input.rating),
    cardId: input.cardId,
    deckId: input.deckId,
    sessionId: input.sessionId,
    reviewedAt: reviewedAtIso,
    rating: input.rating,
    previousState: input.outcome.previousState,
    resultingState: input.outcome.resultingState,
    previousDueAt: input.outcome.previousDueAt,
    nextDueAt: input.outcome.nextDueAt,
    elapsedDays: input.outcome.elapsedDays,
    scheduledDays: input.outcome.scheduledDays,
    previousStability: input.outcome.previousStability,
    nextStability: input.outcome.nextStability,
    previousSchedulingDifficulty: input.outcome.previousSchedulingDifficulty,
    nextSchedulingDifficulty: input.outcome.nextSchedulingDifficulty,
    responseTimeMs: input.responseTimeMs,
    schedulerAlgorithm: input.schedulerAlgorithm,
    schedulerVersion: input.schedulerVersion,
  };
}
