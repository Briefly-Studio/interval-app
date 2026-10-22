import { test } from "node:test";
import assert from "node:assert/strict";

import { applyCardReview } from "./applyCardReview";
import { fsrsScheduler } from "./fsrsScheduler";

const NOW = new Date("2026-01-01T00:00:00.000Z");

test("applyCardReview: with no prior scheduling state, treats the card as brand-new (no fabricated history)", () => {
  const result = applyCardReview({
    cardId: "card-1",
    deckId: "deck-1",
    schedulingState: undefined,
    rating: "good",
    reviewedAt: NOW,
    scheduler: fsrsScheduler,
  });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.reviewEvent.previousState, "new");
  assert.equal(result.reviewEvent.previousStability, undefined);
  assert.equal(result.reviewEvent.previousSchedulingDifficulty, undefined);
});

test("applyCardReview: rejects an invalid rating instead of guessing or defaulting", () => {
  const result = applyCardReview({
    cardId: "card-1",
    deckId: "deck-1",
    schedulingState: undefined,
    // @ts-expect-error — deliberately invalid at the runtime boundary
    rating: "medium",
    reviewedAt: NOW,
    scheduler: fsrsScheduler,
  });
  assert.equal(result.status, "invalid-rating");
});

test("applyCardReview: the returned nextSchedulingState and reviewEvent agree with each other", () => {
  const result = applyCardReview({
    cardId: "card-1",
    deckId: "deck-1",
    schedulingState: undefined,
    rating: "good",
    reviewedAt: NOW,
    scheduler: fsrsScheduler,
  });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.nextSchedulingState.dueAt, result.reviewEvent.nextDueAt);
  assert.equal(result.nextSchedulingState.state, result.reviewEvent.resultingState);
  assert.equal(result.nextSchedulingState.stability, result.reviewEvent.nextStability);
  assert.equal(result.reviewEvent.cardId, "card-1");
  assert.equal(result.reviewEvent.deckId, "deck-1");
  assert.equal(result.reviewEvent.reviewedAt, NOW.toISOString());
  assert.equal(result.reviewEvent.rating, "good");
});

test("applyCardReview: a second review builds on the FIRST review's resulting state, not a freshly-created default", () => {
  const first = applyCardReview({
    cardId: "card-1",
    deckId: "deck-1",
    schedulingState: undefined,
    rating: "good",
    reviewedAt: NOW,
    scheduler: fsrsScheduler,
  });
  assert.equal(first.status, "ok");
  if (first.status !== "ok") return;

  const secondNow = new Date(first.nextSchedulingState.dueAt);
  const second = applyCardReview({
    cardId: "card-1",
    deckId: "deck-1",
    schedulingState: first.nextSchedulingState,
    rating: "good",
    reviewedAt: secondNow,
    scheduler: fsrsScheduler,
  });
  assert.equal(second.status, "ok");
  if (second.status !== "ok") return;
  assert.equal(second.reviewEvent.previousState, "learning");
  assert.equal(second.reviewEvent.resultingState, "review");
  assert.notEqual(second.nextSchedulingState.dueAt, first.nextSchedulingState.dueAt);
});

test("applyCardReview carries sessionId through to the review event only when supplied", () => {
  const withSession = applyCardReview({
    cardId: "card-1",
    deckId: "deck-1",
    sessionId: "session-1",
    schedulingState: undefined,
    rating: "good",
    reviewedAt: NOW,
    scheduler: fsrsScheduler,
  });
  const withoutSession = applyCardReview({
    cardId: "card-1",
    deckId: "deck-1",
    schedulingState: undefined,
    rating: "good",
    reviewedAt: NOW,
    scheduler: fsrsScheduler,
  });
  assert.equal(withSession.status, "ok");
  assert.equal(withoutSession.status, "ok");
  if (withSession.status !== "ok" || withoutSession.status !== "ok") return;
  assert.equal(withSession.reviewEvent.sessionId, "session-1");
  assert.equal(withoutSession.reviewEvent.sessionId, undefined);
});

test("applyCardReview only records responseTimeMs when the caller actually supplied it", () => {
  const withTiming = applyCardReview({
    cardId: "card-1",
    deckId: "deck-1",
    schedulingState: undefined,
    rating: "good",
    reviewedAt: NOW,
    responseTimeMs: 4200,
    scheduler: fsrsScheduler,
  });
  const withoutTiming = applyCardReview({
    cardId: "card-1",
    deckId: "deck-1",
    schedulingState: undefined,
    rating: "good",
    reviewedAt: NOW,
    scheduler: fsrsScheduler,
  });
  assert.equal(withTiming.status, "ok");
  assert.equal(withoutTiming.status, "ok");
  if (withTiming.status !== "ok" || withoutTiming.status !== "ok") return;
  assert.equal(withTiming.reviewEvent.responseTimeMs, 4200);
  assert.equal(withoutTiming.reviewEvent.responseTimeMs, undefined);
});

test("applyCardReview is deterministic for a fixed timestamp", () => {
  const a = applyCardReview({
    cardId: "card-1",
    deckId: "deck-1",
    schedulingState: undefined,
    rating: "easy",
    reviewedAt: NOW,
    scheduler: fsrsScheduler,
  });
  const b = applyCardReview({
    cardId: "card-1",
    deckId: "deck-1",
    schedulingState: undefined,
    rating: "easy",
    reviewedAt: NOW,
    scheduler: fsrsScheduler,
  });
  assert.deepEqual(a, b);
});
