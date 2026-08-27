import { test } from "node:test";
import assert from "node:assert/strict";
import { validateGeneratedDeckResponse } from "./responseValidation";
import type { GenerateStudyDeckRequest, GenerationContext } from "./types";
import type { NormalizedChunk } from "../normalization/types";

function makeChunk(id: string, index: number): NormalizedChunk {
  return { id, index, text: `text-${id}`, approxSize: 10, provenance: {} };
}

function makeContext(chunkIds: string[]): GenerationContext {
  const chunks = chunkIds.map((id, index) => makeChunk(id, index));
  return {
    chunks,
    totalChars: chunks.reduce((sum, c) => sum + c.approxSize, 0),
    chunkCount: chunks.length,
    fullSourceIncluded: true,
    excludedChunkIds: [],
    excludedChunkCount: 0,
  };
}

function makeRequest(): GenerateStudyDeckRequest {
  return {
    sourceId: "src-1",
    sourceTitle: "Test",
    normalizationVersion: 1,
    generationContractVersion: 1,
    selectedChunkIds: ["a", "b"],
    requestedCardCount: 5,
    options: { cardCount: "small", difficulty: "balanced", cardStyle: "question-answer" },
  };
}

test("rejects a malformed response outright", () => {
  const outcome = validateGeneratedDeckResponse({ notTitle: true }, makeContext(["a"]), makeRequest(), "mock-v1");
  assert.equal(outcome.status, "invalid");
  if (outcome.status === "invalid") assert.equal(outcome.deckIssues[0].code, "malformed-response");
});

test("rejects a card with a provenance id not present in the supplied context", () => {
  const raw = { title: "Deck", cards: [{ front: "Q", back: "A", sourceChunkIds: ["not-real"] }] };
  const outcome = validateGeneratedDeckResponse(raw, makeContext(["a", "b"]), makeRequest(), "mock-v1");
  assert.equal(outcome.status, "invalid");
  if (outcome.status === "invalid") assert.equal(outcome.cardIssues[0].code, "unknown-chunk-id");
});

test("excludes an individual bad card but keeps an otherwise-good deck", () => {
  const raw = {
    title: "Deck",
    cards: [
      { front: "", back: "A", sourceChunkIds: ["a"] },
      { front: "Q2", back: "A2", sourceChunkIds: ["a"] },
    ],
  };
  const outcome = validateGeneratedDeckResponse(raw, makeContext(["a"]), makeRequest(), "mock-v1");
  assert.equal(outcome.status, "valid");
  if (outcome.status === "valid") {
    assert.equal(outcome.draft.cards.length, 1);
    assert.equal(outcome.draft.generation.issues.length, 1);
    assert.equal(outcome.draft.generation.issues[0].code, "empty-front");
  }
});

test("escalates to a whole-deck failure when every card is excluded", () => {
  const raw = { title: "Deck", cards: [{ front: "", back: "", sourceChunkIds: ["a"] }] };
  const outcome = validateGeneratedDeckResponse(raw, makeContext(["a"]), makeRequest(), "mock-v1");
  assert.equal(outcome.status, "invalid");
  if (outcome.status === "invalid") assert.equal(outcome.deckIssues[0].code, "no-valid-cards");
});

// Regression test: a card whose own sourceChunkIds contains repeats (e.g. ["a", "a"]) must not be
// silently accepted with non-canonical provenance — it should be deduplicated in the draft.
test("dedupes repeated provenance ids within a single card instead of leaving them non-canonical", () => {
  const raw = { title: "Deck", cards: [{ front: "Q", back: "A", sourceChunkIds: ["a", "a"] }] };
  const outcome = validateGeneratedDeckResponse(raw, makeContext(["a", "b"]), makeRequest(), "mock-v1");
  assert.equal(outcome.status, "valid");
  if (outcome.status === "valid") {
    assert.deepEqual(outcome.draft.cards[0].sourceChunkIds, ["a"]);
  }
});

test("fullSourceIncluded and excludedChunkCount from context pass through to the draft's generation metadata", () => {
  const context: GenerationContext = {
    ...makeContext(["a"]),
    fullSourceIncluded: false,
    excludedChunkIds: ["b"],
    excludedChunkCount: 1,
  };
  const raw = { title: "Deck", cards: [{ front: "Q", back: "A", sourceChunkIds: ["a"] }] };
  const outcome = validateGeneratedDeckResponse(raw, context, makeRequest(), "mock-v1");
  assert.equal(outcome.status, "valid");
  if (outcome.status === "valid") {
    assert.equal(outcome.draft.generation.fullSourceIncluded, false);
    assert.equal(outcome.draft.generation.excludedChunkCount, 1);
  }
});
