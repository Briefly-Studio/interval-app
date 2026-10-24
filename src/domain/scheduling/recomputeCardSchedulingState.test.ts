import { test } from "node:test";
import assert from "node:assert/strict";

import { applyCardReview } from "./applyCardReview";
import { fsrsScheduler } from "./fsrsScheduler";
import { orderReviewEventsForReplay, recomputeCardSchedulingState } from "./recomputeCardSchedulingState";
import type { CardSchedulingState, ReviewEvent, ReviewRating } from "./types";

const cardId = "card-1";
const deckId = "deck-1";

function review(state: CardSchedulingState | undefined, rating: ReviewRating, at: string) {
  const result = applyCardReview({
    cardId,
    deckId,
    schedulingState: state,
    rating,
    reviewedAt: new Date(at),
    scheduler: fsrsScheduler,
  });
  if (result.status !== "ok") throw new Error("expected ok");
  return result;
}

// A minimal fixture event — recomputeCardSchedulingState's replay only ever reads
// cardId/rating/reviewedAt (plus `id` for sort/dedup); every other field is pure provenance the
// replay loop never consults, so these placeholder values are deliberately unrealistic/unused.
function fixtureEvent(id: string, rating: ReviewRating, reviewedAt: string, overrides: Partial<ReviewEvent> = {}): ReviewEvent {
  return {
    id,
    cardId,
    deckId,
    reviewedAt,
    rating,
    previousState: "new",
    resultingState: "learning",
    previousDueAt: reviewedAt,
    nextDueAt: reviewedAt,
    elapsedDays: 0,
    scheduledDays: 0,
    schedulerAlgorithm: "fsrs",
    schedulerVersion: "test-fixture",
    ...overrides,
  };
}

test("one-device replay matches the sequential scheduling result", () => {
  let state: CardSchedulingState | undefined;
  const events: ReviewEvent[] = [];
  const steps: [ReviewRating, string][] = [
    ["good", "2026-01-01T00:00:00.000Z"],
    ["again", "2026-01-02T00:00:00.000Z"],
    ["easy", "2026-01-06T00:00:00.000Z"],
  ];
  for (const [rating, at] of steps) {
    const result = review(state, rating, at);
    state = result.nextSchedulingState;
    events.push(result.reviewEvent);
  }

  const recomputed = recomputeCardSchedulingState({ cardId, reviewEvents: events, scheduler: fsrsScheduler });
  assert.deepEqual(recomputed, state);
});

test("two offline devices rating the same card create distinct events; merge replays both", () => {
  // Device A, offline: rates the never-reviewed card "good" at 10:00.
  const deviceA = review(undefined, "good", "2026-03-01T10:00:00.000Z");
  // Device B, offline, independently: rates the SAME never-reviewed card "again" at 10:05 —
  // built from `undefined` (not deviceA's result), exactly like a real second device that has
  // not seen device A's edit yet.
  const deviceB = review(undefined, "again", "2026-03-01T10:05:00.000Z");

  assert.notEqual(deviceA.reviewEvent.id, deviceB.reviewEvent.id);

  const merged = recomputeCardSchedulingState({
    cardId,
    reviewEvents: [deviceA.reviewEvent, deviceB.reviewEvent],
    scheduler: fsrsScheduler,
  });

  // The deterministic merge replays BOTH events, in chronological order (good @ 10:00, then
  // again @ 10:05) — never just picking one device's local result as the winner.
  const expected = fsrsScheduler.scheduleReview(deviceA.nextSchedulingState, "again", new Date("2026-03-01T10:05:00.000Z"));
  assert.deepEqual(merged, expected.nextState);
  assert.notDeepEqual(merged, deviceA.nextSchedulingState);
  assert.notDeepEqual(merged, deviceB.nextSchedulingState);
});

test("merge order is deterministic regardless of input array order", () => {
  const e1 = fixtureEvent("a1", "good", "2026-01-01T00:00:00.000Z");
  const e2 = fixtureEvent("a2", "again", "2026-01-02T00:00:00.000Z");
  const e3 = fixtureEvent("a3", "easy", "2026-01-05T00:00:00.000Z");

  const orderings = [
    [e1, e2, e3],
    [e3, e1, e2],
    [e2, e3, e1],
    [e3, e2, e1],
  ];

  const results = orderings.map((events) => recomputeCardSchedulingState({ cardId, reviewEvents: events, scheduler: fsrsScheduler }));
  for (const result of results.slice(1)) {
    assert.deepEqual(result, results[0]);
  }
});

test("Good-then-Again produces a different result than Again-then-Good", () => {
  const goodThenAgain = recomputeCardSchedulingState({
    cardId,
    reviewEvents: [
      fixtureEvent("g1", "good", "2026-02-01T00:00:00.000Z"),
      fixtureEvent("g2", "again", "2026-02-02T00:00:00.000Z"),
    ],
    scheduler: fsrsScheduler,
  });

  const againThenGood = recomputeCardSchedulingState({
    cardId,
    reviewEvents: [
      fixtureEvent("g1", "again", "2026-02-01T00:00:00.000Z"),
      fixtureEvent("g2", "good", "2026-02-02T00:00:00.000Z"),
    ],
    scheduler: fsrsScheduler,
  });

  assert.notDeepEqual(goodThenAgain, againThenGood);
});

test("same reviewedAt collision breaks the tie by event id, regardless of input array order", () => {
  const t = "2026-04-01T00:00:00.000Z";
  // "id-aaa" sorts before "id-zzz" lexically — the tiebreaker, not array position, decides order.
  const first = fixtureEvent("id-aaa", "easy", t);
  const second = fixtureEvent("id-zzz", "again", t);

  const forward = recomputeCardSchedulingState({ cardId, reviewEvents: [first, second], scheduler: fsrsScheduler });
  const reversed = recomputeCardSchedulingState({ cardId, reviewEvents: [second, first], scheduler: fsrsScheduler });
  assert.deepEqual(forward, reversed);

  // Confirm the tiebreak actually governs replay order: id-aaa (easy) must be applied BEFORE
  // id-zzz (again), matching a manual id-ordered replay.
  const manual = fsrsScheduler.scheduleReview(
    fsrsScheduler.scheduleReview(fsrsScheduler.createNewCardState(cardId, new Date(t)), "easy", new Date(t)).nextState,
    "again",
    new Date(t)
  );
  assert.deepEqual(forward, manual.nextState);
});

test("the exact same event appearing twice in the input is applied only once", () => {
  const event = fixtureEvent("dup-1", "good", "2026-05-01T00:00:00.000Z");
  const once = recomputeCardSchedulingState({ cardId, reviewEvents: [event], scheduler: fsrsScheduler });
  const twice = recomputeCardSchedulingState({ cardId, reviewEvents: [event, event], scheduler: fsrsScheduler });
  assert.deepEqual(once, twice);
  assert.equal(once.reps, twice.reps);
});

test("repeated recompute over identical input is identical every time", () => {
  const events = [
    fixtureEvent("r1", "good", "2026-06-01T00:00:00.000Z"),
    fixtureEvent("r2", "hard", "2026-06-03T00:00:00.000Z"),
  ];
  const first = recomputeCardSchedulingState({ cardId, reviewEvents: events, scheduler: fsrsScheduler });
  const second = recomputeCardSchedulingState({ cardId, reviewEvents: events, scheduler: fsrsScheduler });
  assert.deepEqual(first, second);
});

test("events belonging to other cards are ignored", () => {
  const ownEvent = fixtureEvent("own-1", "good", "2026-07-01T00:00:00.000Z");
  const otherCardEvent = fixtureEvent("other-1", "again", "2026-07-02T00:00:00.000Z", { cardId: "card-2" });

  const withOther = recomputeCardSchedulingState({ cardId, reviewEvents: [ownEvent, otherCardEvent], scheduler: fsrsScheduler });
  const withoutOther = recomputeCardSchedulingState({ cardId, reviewEvents: [ownEvent], scheduler: fsrsScheduler });
  assert.deepEqual(withOther, withoutOther);
});

test("a card with no events at all gets the scheduler's honest new-card default", () => {
  const recomputed = recomputeCardSchedulingState({ cardId, reviewEvents: [], scheduler: fsrsScheduler });
  assert.deepEqual(recomputed, fsrsScheduler.createNewCardState(cardId, new Date(0)));
});

test("orderReviewEventsForReplay: primary key reviewedAt, tiebreak by id, never mutates input", () => {
  const events = [
    fixtureEvent("z", "good", "2026-08-02T00:00:00.000Z"),
    fixtureEvent("b", "good", "2026-08-01T00:00:00.000Z"),
    fixtureEvent("a", "good", "2026-08-01T00:00:00.000Z"),
  ];
  const original = [...events];
  const ordered = orderReviewEventsForReplay(events);
  assert.deepEqual(events, original);
  assert.deepEqual(ordered.map((e) => e.id), ["a", "b", "z"]);
});
