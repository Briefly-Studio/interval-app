import { activeScheduler, createDefaultSchedulingState } from "./defaults";
import type { Scheduler } from "./scheduler";
import { buildReviewEvent } from "./reviewEvent";
import { isReviewRating, type CardSchedulingState, type ReviewEvent, type ReviewRating } from "./types";

// The one pure domain action every caller (review UI today; a future quiz-grading flow,
// import/replay tooling, etc.) uses to turn "a user rated a card" into both pieces this
// foundation's core principle requires: an updated CURRENT scheduling state and an immutable
// HISTORICAL review event. Never called with `Date.now()` baked in — `reviewedAt` is always
// caller-supplied, so a fixed input always produces a fixed, testable output.

export type ApplyCardReviewInput = {
  cardId: string;
  deckId: string;
  sessionId?: string;
  /** The card's current scheduling state, or `undefined` for a card with no prior state (a
   * brand-new card, or one not yet migrated) — `applyCardReview` creates the honest "nothing has
   * happened yet" default itself rather than requiring every caller to special-case this. */
  schedulingState: CardSchedulingState | undefined;
  rating: ReviewRating;
  reviewedAt: Date;
  responseTimeMs?: number;
  scheduler?: Scheduler;
};

export type ApplyCardReviewResult =
  | { status: "ok"; nextSchedulingState: CardSchedulingState; reviewEvent: ReviewEvent }
  | { status: "invalid-rating" };

export function applyCardReview(input: ApplyCardReviewInput): ApplyCardReviewResult {
  if (!isReviewRating(input.rating)) return { status: "invalid-rating" };

  const scheduler = input.scheduler ?? activeScheduler;
  const currentState = input.schedulingState ?? createDefaultSchedulingState(input.cardId, input.reviewedAt, scheduler);

  const outcome = scheduler.scheduleReview(currentState, input.rating, input.reviewedAt);

  const reviewEvent = buildReviewEvent({
    cardId: input.cardId,
    deckId: input.deckId,
    sessionId: input.sessionId,
    reviewedAt: input.reviewedAt,
    rating: input.rating,
    outcome,
    schedulerAlgorithm: scheduler.algorithm,
    schedulerVersion: scheduler.version,
    responseTimeMs: input.responseTimeMs,
  });

  return { status: "ok", nextSchedulingState: outcome.nextState, reviewEvent };
}
