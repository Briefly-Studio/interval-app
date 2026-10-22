import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveReviewQueueCards } from "./resolveReviewQueueCards";

type FakeCard = { id: string; front: string };

const cards: FakeCard[] = [
  { id: "a", front: "A" },
  { id: "b", front: "B" },
  { id: "c", front: "C" },
];

test("resolveReviewQueueCards: null pending queue returns every live card unchanged (Study All Cards path)", () => {
  assert.deepEqual(resolveReviewQueueCards(cards, null), cards);
});

test("resolveReviewQueueCards: a pending queue reorders cards to match the queue's own order, not storage order", () => {
  assert.deepEqual(resolveReviewQueueCards(cards, ["c", "a"]).map((c) => c.id), ["c", "a"]);
});

test("resolveReviewQueueCards: a queued id no longer among the live cards is silently dropped, never substituted", () => {
  assert.deepEqual(resolveReviewQueueCards(cards, ["a", "deleted-card", "b"]).map((c) => c.id), ["a", "b"]);
});

test("resolveReviewQueueCards: an empty pending queue returns an empty review session (never falls back to all cards)", () => {
  assert.deepEqual(resolveReviewQueueCards(cards, []), []);
});

test("resolveReviewQueueCards: a queue naming every card in a different order is deterministic", () => {
  const first = resolveReviewQueueCards(cards, ["b", "c", "a"]);
  const second = resolveReviewQueueCards(cards, ["b", "c", "a"]);
  assert.deepEqual(first, second);
});
