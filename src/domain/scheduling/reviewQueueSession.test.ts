import { test } from "node:test";
import assert from "node:assert/strict";

import { consumePendingReviewQueue, setPendingReviewQueue } from "./reviewQueueSession";

test("consumePendingReviewQueue returns null when nothing is pending", () => {
  assert.equal(consumePendingReviewQueue("deck-none"), null);
});

test("set then consume returns the exact card ids for the matching deck", () => {
  setPendingReviewQueue("deck-1", ["card-a", "card-b"]);
  assert.deepEqual(consumePendingReviewQueue("deck-1"), ["card-a", "card-b"]);
});

test("consuming clears the queue — a second consume for the same deck returns null", () => {
  setPendingReviewQueue("deck-1", ["card-a"]);
  consumePendingReviewQueue("deck-1");
  assert.equal(consumePendingReviewQueue("deck-1"), null);
});

test("a queue set for one deck is never returned for a different deck", () => {
  setPendingReviewQueue("deck-1", ["card-a"]);
  assert.equal(consumePendingReviewQueue("deck-2"), null);
  // Still pending for the deck it was actually set for — a mismatched read must not clear it.
  assert.deepEqual(consumePendingReviewQueue("deck-1"), ["card-a"]);
});

test("setting a new queue replaces any previous pending queue outright", () => {
  setPendingReviewQueue("deck-1", ["card-a"]);
  setPendingReviewQueue("deck-2", ["card-b"]);
  assert.equal(consumePendingReviewQueue("deck-1"), null);
  assert.deepEqual(consumePendingReviewQueue("deck-2"), ["card-b"]);
});
