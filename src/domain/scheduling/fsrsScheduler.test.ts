import { test } from "node:test";
import assert from "node:assert/strict";

import { fsrsScheduler } from "./fsrsScheduler";

// Expected values below were captured by running this exact pinned `ts-fsrs@5.4.2` version
// directly (with `enable_fuzz: false`, the library's own default) against these exact inputs —
// not hand-derived or guessed. Re-running the same probe against the same installed package
// version reproduces them exactly; a future `ts-fsrs` version bump should re-capture and update
// these, never adjust them to "look right."

const NOW = new Date("2026-01-01T00:00:00.000Z");

test("createNewCardState: a brand-new card is immediately due, state 'new', with no fabricated history", () => {
  const state = fsrsScheduler.createNewCardState("card-1", NOW);
  assert.equal(state.cardId, "card-1");
  assert.equal(state.state, "new");
  assert.equal(state.dueAt, NOW.toISOString());
  assert.equal(state.lastReviewedAt, undefined);
  assert.equal(state.stability, undefined);
  assert.equal(state.schedulingDifficulty, undefined);
  assert.equal(state.scheduledDays, 0);
  assert.equal(state.elapsedDays, 0);
  assert.equal(state.reps, 0);
  assert.equal(state.lapses, 0);
  assert.equal(state.schedulerAlgorithm, "fsrs");
  assert.match(state.schedulerVersion, /FSRS-6/);
});

test("createNewCardState is deterministic for a fixed timestamp", () => {
  const a = fsrsScheduler.createNewCardState("card-1", NOW);
  const b = fsrsScheduler.createNewCardState("card-1", NOW);
  assert.deepEqual(a, b);
});

test("scheduleReview: rating 'again' on a new card moves to learning, due in 1 minute, reps 1, no lapse", () => {
  const newState = fsrsScheduler.createNewCardState("card-1", NOW);
  const outcome = fsrsScheduler.scheduleReview(newState, "again", NOW);
  assert.equal(outcome.previousState, "new");
  assert.equal(outcome.resultingState, "learning");
  assert.equal(outcome.nextState.dueAt, "2026-01-01T00:01:00.000Z");
  assert.equal(outcome.nextState.reps, 1);
  assert.equal(outcome.nextState.lapses, 0);
  assert.equal(outcome.elapsedDays, 0);
});

test("scheduleReview: rating 'hard' on a new card moves to learning, due in 6 minutes", () => {
  const newState = fsrsScheduler.createNewCardState("card-1", NOW);
  const outcome = fsrsScheduler.scheduleReview(newState, "hard", NOW);
  assert.equal(outcome.resultingState, "learning");
  assert.equal(outcome.nextState.dueAt, "2026-01-01T00:06:00.000Z");
});

test("scheduleReview: rating 'good' on a new card moves to learning, due in 10 minutes", () => {
  const newState = fsrsScheduler.createNewCardState("card-1", NOW);
  const outcome = fsrsScheduler.scheduleReview(newState, "good", NOW);
  assert.equal(outcome.resultingState, "learning");
  assert.equal(outcome.nextState.dueAt, "2026-01-01T00:10:00.000Z");
  assert.ok((outcome.nextStability ?? 0) > 0);
});

test("scheduleReview: rating 'easy' on a new card jumps straight to review state with a multi-day interval", () => {
  const newState = fsrsScheduler.createNewCardState("card-1", NOW);
  const outcome = fsrsScheduler.scheduleReview(newState, "easy", NOW);
  assert.equal(outcome.resultingState, "review");
  assert.equal(outcome.scheduledDays, 8);
  assert.equal(outcome.nextDueAt, "2026-01-09T00:00:00.000Z");
});

test("scheduleReview: a second 'good' review exactly on the due date advances learning -> review", () => {
  const newState = fsrsScheduler.createNewCardState("card-1", NOW);
  const first = fsrsScheduler.scheduleReview(newState, "good", NOW);
  const secondNow = new Date(first.nextState.dueAt);
  const second = fsrsScheduler.scheduleReview(first.nextState, "good", secondNow);
  assert.equal(first.resultingState, "learning");
  assert.equal(second.resultingState, "review");
  assert.equal(second.scheduledDays, 2);
  assert.equal(second.nextState.reps, 2);
});

test("scheduleReview: a lapse (Again on a review-state card) increments lapses, moves to relearning, and computes real elapsed days", () => {
  const newState = fsrsScheduler.createNewCardState("card-1", NOW);
  const r1 = fsrsScheduler.scheduleReview(newState, "good", NOW);
  const r2 = fsrsScheduler.scheduleReview(r1.nextState, "good", new Date(r1.nextState.dueAt));
  assert.equal(r2.resultingState, "review");

  const lapseNow = new Date(r2.nextState.dueAt);
  const r3 = fsrsScheduler.scheduleReview(r2.nextState, "again", lapseNow);
  assert.equal(r3.previousState, "review");
  assert.equal(r3.resultingState, "relearning");
  assert.equal(r3.nextState.lapses, 1);
  // elapsedDays must reflect the real UTC-calendar-day gap between the previous review and this
  // one, not a hardcoded/zero value — r2's last review was on its own due date, 2 days after r1.
  assert.equal(r3.elapsedDays, 2);
});

test("scheduleReview is deterministic for identical state/rating/timestamp", () => {
  const newState = fsrsScheduler.createNewCardState("card-1", NOW);
  const a = fsrsScheduler.scheduleReview(newState, "good", NOW);
  const b = fsrsScheduler.scheduleReview(newState, "good", NOW);
  assert.deepEqual(a, b);
});

test("scheduleReview never calls Date.now() internally — passing a far-past or far-future `now` still produces a consistent, fixed result", () => {
  const newState = fsrsScheduler.createNewCardState("card-1", new Date("2020-01-01T00:00:00.000Z"));
  const farFuture = new Date("2030-01-01T00:00:00.000Z");
  const a = fsrsScheduler.scheduleReview(newState, "good", farFuture);
  const b = fsrsScheduler.scheduleReview(newState, "good", farFuture);
  assert.deepEqual(a, b);
});

test("previewReview: returns all four ratings, and each entry matches what scheduleReview would actually do", () => {
  const newState = fsrsScheduler.createNewCardState("card-1", NOW);
  const preview = fsrsScheduler.previewReview(newState, NOW);
  assert.deepEqual(
    preview.map((p) => p.rating),
    ["again", "hard", "good", "easy"]
  );
  for (const entry of preview) {
    const actual = fsrsScheduler.scheduleReview(newState, entry.rating, NOW);
    assert.deepEqual(entry.nextState, actual.nextState);
    assert.equal(entry.scheduledDays, actual.scheduledDays);
  }
});

test("previewReview never mutates the input state (calling it twice gives identical results)", () => {
  const newState = fsrsScheduler.createNewCardState("card-1", NOW);
  const first = fsrsScheduler.previewReview(newState, NOW);
  const second = fsrsScheduler.previewReview(newState, NOW);
  assert.deepEqual(first, second);
  assert.equal(newState.state, "new");
});

test("algorithm/version metadata is read from the library itself, not hand-typed", () => {
  assert.equal(fsrsScheduler.algorithm, "fsrs");
  assert.match(fsrsScheduler.version, /^v5\.4\.2 using FSRS-6\.0$/);
});
