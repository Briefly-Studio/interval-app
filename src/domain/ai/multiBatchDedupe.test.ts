import { test } from "node:test";
import assert from "node:assert/strict";

import { dedupeCombinedCards } from "./multiBatchDedupe";
import type { GeneratedCardDraft } from "./types";

function card(overrides: Partial<GeneratedCardDraft> & { id: string; front: string; back: string }): GeneratedCardDraft {
  return { sourceChunkIds: [], ...overrides };
}

test("no duplicates: every card survives unchanged, in order", () => {
  const cards = [
    card({ id: "1", front: "Q1", back: "A1", sourceChunkIds: ["c1"] }),
    card({ id: "2", front: "Q2", back: "A2", sourceChunkIds: ["c2"] }),
  ];
  const result = dedupeCombinedCards(cards);
  assert.deepEqual(result.cards, cards);
  assert.equal(result.duplicatesRemoved, 0);
});

test("exact duplicate (byte-for-byte) across batches is collapsed, keeping the first occurrence", () => {
  const cards = [
    card({ id: "1", front: "What is X?", back: "It is Y", sourceChunkIds: ["c1"] }),
    card({ id: "2", front: "What is X?", back: "It is Y", sourceChunkIds: ["c5"] }),
  ];
  const result = dedupeCombinedCards(cards);
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].id, "1");
  assert.equal(result.duplicatesRemoved, 1);
});

test("duplicate detection is case-insensitive and whitespace-collapsing, matching responseValidation.ts exactly", () => {
  const cards = [
    card({ id: "1", front: "What  is   X?", back: "it is y", sourceChunkIds: ["c1"] }),
    card({ id: "2", front: "what is x?", back: "It Is Y", sourceChunkIds: ["c2"] }),
  ];
  const result = dedupeCombinedCards(cards);
  assert.equal(result.cards.length, 1);
  assert.equal(result.duplicatesRemoved, 1);
});

test("duplicate's sourceChunkIds are unioned into the retained card, never silently lost", () => {
  const cards = [
    card({ id: "1", front: "Q", back: "A", sourceChunkIds: ["c1", "c2"] }),
    card({ id: "2", front: "Q", back: "A", sourceChunkIds: ["c2", "c3"] }),
  ];
  const result = dedupeCombinedCards(cards);
  assert.equal(result.cards.length, 1);
  assert.deepEqual(result.cards[0].sourceChunkIds, ["c1", "c2", "c3"]);
});

test("similar-but-not-identical wording is never merged — no fuzzy/semantic matching", () => {
  const cards = [
    card({ id: "1", front: "What is the capital of France?", back: "Paris", sourceChunkIds: ["c1"] }),
    card({ id: "2", front: "What's the capital city of France?", back: "Paris", sourceChunkIds: ["c2"] }),
  ];
  const result = dedupeCombinedCards(cards);
  assert.equal(result.cards.length, 2);
  assert.equal(result.duplicatesRemoved, 0);
});

test("empty input returns empty output", () => {
  const result = dedupeCombinedCards([]);
  assert.deepEqual(result.cards, []);
  assert.equal(result.duplicatesRemoved, 0);
});

test("three-way exact duplicate collapses to one, unioning all three sourceChunkIds", () => {
  const cards = [
    card({ id: "1", front: "Q", back: "A", sourceChunkIds: ["c1"] }),
    card({ id: "2", front: "Q", back: "A", sourceChunkIds: ["c2"] }),
    card({ id: "3", front: "Q", back: "A", sourceChunkIds: ["c3"] }),
  ];
  const result = dedupeCombinedCards(cards);
  assert.equal(result.cards.length, 1);
  assert.equal(result.duplicatesRemoved, 2);
  assert.deepEqual(result.cards[0].sourceChunkIds, ["c1", "c2", "c3"]);
});

test("preserves source (first-seen) order across a mix of unique and duplicate cards", () => {
  const cards = [
    card({ id: "1", front: "Q1", back: "A1" }),
    card({ id: "2", front: "Q2", back: "A2" }),
    card({ id: "3", front: "Q1", back: "A1" }), // duplicate of #1
    card({ id: "4", front: "Q3", back: "A3" }),
  ];
  const result = dedupeCombinedCards(cards);
  assert.deepEqual(result.cards.map((c) => c.id), ["1", "2", "4"]);
});
