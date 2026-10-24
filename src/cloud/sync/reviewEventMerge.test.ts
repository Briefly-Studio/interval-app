import { test } from "node:test";
import assert from "node:assert/strict";

import type { ReviewEventRecord } from "../../models/reviewEvent";
import { mergeIncomingReviewEvents } from "./reviewEventMerge";

function record(id: string, cardId: string, overrides: Partial<ReviewEventRecord> = {}): ReviewEventRecord {
  return {
    id,
    cardId,
    deckId: "deck-1",
    reviewedAt: "2026-01-01T00:00:00.000Z",
    rating: "good",
    previousState: "new",
    resultingState: "learning",
    previousDueAt: "2026-01-01T00:00:00.000Z",
    nextDueAt: "2026-01-01T00:10:00.000Z",
    elapsedDays: 0,
    scheduledDays: 0,
    schedulerAlgorithm: "fsrs",
    schedulerVersion: "test-fixture",
    rev: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    dirty: true,
    ...overrides,
  };
}

test("two offline devices' distinct events are both preserved by merge", () => {
  const deviceAEvent = record("device-a-1", "card-1", { rating: "good" });
  const deviceBEvent = record("device-b-1", "card-1", { rating: "again", reviewedAt: "2026-01-01T00:05:00.000Z" });

  const result = mergeIncomingReviewEvents([], [deviceAEvent, deviceBEvent]);

  assert.equal(result.merged.length, 2);
  assert.deepEqual(new Set(result.merged.map((e) => e.id)), new Set(["device-a-1", "device-b-1"]));
  assert.deepEqual(result.affectedCardIds, ["card-1"]);
});

test("an id already present locally is ignored outright — no rev/timestamp comparison", () => {
  const existing = record("ev-1", "card-1", { rev: 1, dirty: false });
  // Same id arriving again from a pull — even if it somehow carried a different rev/timestamp,
  // existence alone is what matters (an id collision is definitionally the same immutable fact).
  const incomingDuplicate = record("ev-1", "card-1", { rev: 1, dirty: true });

  const result = mergeIncomingReviewEvents([existing], [incomingDuplicate]);

  assert.equal(result.merged.length, 1);
  assert.equal(result.affectedCardIds.length, 0);
  // The EXISTING local copy wins untouched — the incoming duplicate is never written over it.
  assert.deepEqual(result.merged[0], existing);
});

test("repeated merge of the exact same incoming batch is idempotent", () => {
  const existing = [record("ev-1", "card-1")];
  const incoming = [record("ev-2", "card-1", { rating: "again" })];

  const first = mergeIncomingReviewEvents(existing, incoming);
  const second = mergeIncomingReviewEvents(first.merged, incoming);

  assert.equal(first.merged.length, 2);
  assert.equal(second.merged.length, 2);
  assert.deepEqual(
    new Set(second.merged.map((e) => e.id)),
    new Set(["ev-1", "ev-2"])
  );
  // The second merge found nothing genuinely new — no card needs recomputing again.
  assert.equal(second.affectedCardIds.length, 0);
});

test("merge result does not depend on incoming array order", () => {
  const e1 = record("ev-1", "card-1", { rating: "good" });
  const e2 = record("ev-2", "card-2", { rating: "again" });

  const forward = mergeIncomingReviewEvents([], [e1, e2]);
  const reversed = mergeIncomingReviewEvents([], [e2, e1]);

  assert.deepEqual(new Set(forward.merged.map((e) => e.id)), new Set(reversed.merged.map((e) => e.id)));
  assert.deepEqual(new Set(forward.affectedCardIds), new Set(reversed.affectedCardIds));
});

test("incoming records are always written back with dirty:false, regardless of their own dirty flag", () => {
  const incoming = record("ev-1", "card-1", { dirty: true });
  const result = mergeIncomingReviewEvents([], [incoming]);
  assert.equal(result.merged[0].dirty, false);
});

test("affectedCardIds only names cards that received a genuinely new event, never every card touched", () => {
  const existingCard1Event = record("ev-1", "card-1");
  const newCard2Event = record("ev-2", "card-2");
  const duplicateCard1Event = record("ev-1", "card-1"); // same id as existing — not new

  const result = mergeIncomingReviewEvents([existingCard1Event], [duplicateCard1Event, newCard2Event]);

  assert.deepEqual(result.affectedCardIds, ["card-2"]);
});

test("existing events never belonging to the incoming batch are preserved untouched", () => {
  const untouched = record("ev-untouched", "card-9", { dirty: true });
  const result = mergeIncomingReviewEvents([untouched], []);
  assert.equal(result.merged.length, 1);
  assert.deepEqual(result.merged[0], untouched);
  assert.equal(result.affectedCardIds.length, 0);
});
