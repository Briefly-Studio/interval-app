import { test } from "node:test";
import assert from "node:assert/strict";

import { buildReviewEvent, computeReviewEventId } from "./reviewEvent";
import type { SchedulerReviewOutcome } from "./types";

const outcome: SchedulerReviewOutcome = {
  nextState: {
    cardId: "card-1",
    state: "learning",
    dueAt: "2026-01-01T00:10:00.000Z",
    lastReviewedAt: "2026-01-01T00:00:00.000Z",
    stability: 2.3065,
    schedulingDifficulty: 2.1181,
    scheduledDays: 0,
    elapsedDays: 0,
    reps: 1,
    lapses: 0,
    schedulerAlgorithm: "fsrs",
    schedulerVersion: "v5.4.2 using FSRS-6.0",
  },
  previousState: "new",
  resultingState: "learning",
  previousDueAt: "2026-01-01T00:00:00.000Z",
  nextDueAt: "2026-01-01T00:10:00.000Z",
  previousStability: undefined,
  nextStability: 2.3065,
  previousSchedulingDifficulty: undefined,
  nextSchedulingDifficulty: 2.1181,
  elapsedDays: 0,
  scheduledDays: 0,
};

test("computeReviewEventId is deterministic for identical inputs", () => {
  const a = computeReviewEventId("card-1", "2026-01-01T00:00:00.000Z", "good");
  const b = computeReviewEventId("card-1", "2026-01-01T00:00:00.000Z", "good");
  assert.equal(a, b);
});

test("computeReviewEventId differs when any single input differs", () => {
  const base = computeReviewEventId("card-1", "2026-01-01T00:00:00.000Z", "good");
  assert.notEqual(computeReviewEventId("card-2", "2026-01-01T00:00:00.000Z", "good"), base);
  assert.notEqual(computeReviewEventId("card-1", "2026-01-01T00:00:01.000Z", "good"), base);
  assert.notEqual(computeReviewEventId("card-1", "2026-01-01T00:00:00.000Z", "easy"), base);
});

test("buildReviewEvent: carries every outcome field through honestly, never inventing a value the outcome didn't have", () => {
  const event = buildReviewEvent({
    cardId: "card-1",
    deckId: "deck-1",
    reviewedAt: new Date("2026-01-01T00:00:00.000Z"),
    rating: "good",
    outcome,
    schedulerAlgorithm: "fsrs",
    schedulerVersion: "v5.4.2 using FSRS-6.0",
  });
  assert.equal(event.cardId, "card-1");
  assert.equal(event.deckId, "deck-1");
  assert.equal(event.reviewedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(event.rating, "good");
  assert.equal(event.previousState, "new");
  assert.equal(event.resultingState, "learning");
  assert.equal(event.previousDueAt, outcome.previousDueAt);
  assert.equal(event.nextDueAt, outcome.nextDueAt);
  assert.equal(event.previousStability, undefined);
  assert.equal(event.nextStability, 2.3065);
  assert.equal(event.elapsedDays, 0);
  assert.equal(event.scheduledDays, 0);
  assert.equal(event.responseTimeMs, undefined);
  assert.equal(event.id, computeReviewEventId("card-1", "2026-01-01T00:00:00.000Z", "good"));
});

test("buildReviewEvent is deterministic for identical inputs (same id, same every field)", () => {
  const a = buildReviewEvent({
    cardId: "card-1",
    deckId: "deck-1",
    reviewedAt: new Date("2026-01-01T00:00:00.000Z"),
    rating: "good",
    outcome,
    schedulerAlgorithm: "fsrs",
    schedulerVersion: "v5.4.2 using FSRS-6.0",
  });
  const b = buildReviewEvent({
    cardId: "card-1",
    deckId: "deck-1",
    reviewedAt: new Date("2026-01-01T00:00:00.000Z"),
    rating: "good",
    outcome,
    schedulerAlgorithm: "fsrs",
    schedulerVersion: "v5.4.2 using FSRS-6.0",
  });
  assert.deepEqual(a, b);
});

test("buildReviewEvent two different reviews of the same card get two different, unique ids", () => {
  const first = buildReviewEvent({
    cardId: "card-1",
    deckId: "deck-1",
    reviewedAt: new Date("2026-01-01T00:00:00.000Z"),
    rating: "good",
    outcome,
    schedulerAlgorithm: "fsrs",
    schedulerVersion: "v5.4.2 using FSRS-6.0",
  });
  const second = buildReviewEvent({
    cardId: "card-1",
    deckId: "deck-1",
    reviewedAt: new Date("2026-01-01T00:10:00.000Z"),
    rating: "good",
    outcome,
    schedulerAlgorithm: "fsrs",
    schedulerVersion: "v5.4.2 using FSRS-6.0",
  });
  assert.notEqual(first.id, second.id);
});
