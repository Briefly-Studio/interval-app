import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveGenerationStatus, validateGeneratedDeckResponse } from "./responseValidation";
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

function makeRequest(overrides: Partial<GenerateStudyDeckRequest> = {}): GenerateStudyDeckRequest {
  return {
    sourceId: "src-1",
    sourceTitle: "Test",
    normalizationVersion: 1,
    generationContractVersion: 1,
    selectedChunkIds: ["a", "b"],
    requestedCardCount: 5,
    targetMinimumCardCount: 3,
    options: { cardCount: "small", difficulty: "balanced", cardStyle: "question-answer" },
    ...overrides,
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

// ---- Count contract: Small (targetMinimum 5, max 8) / Medium (10, 15) / Large (18, 25) ----
// See docs/ai-generation-foundation.md's "Count contract and insufficient-distinct-content"
// section. Every case below uses a distinct chunk per card (own id, own front/back) so the only
// thing under test is count/status handling — never provenance or duplicate-detection.

function chunkIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `c${i}`);
}

function cardsFor(count: number, ids: string[]): { front: string; back: string; sourceChunkIds: string[] }[] {
  return Array.from({ length: count }, (_, i) => ({ front: `Q${i}`, back: `A${i}`, sourceChunkIds: [ids[i]] }));
}

function tierRequest(cardCount: "small" | "medium" | "large", requestedCardCount: number, targetMinimumCardCount: number): GenerateStudyDeckRequest {
  return { ...makeRequest(), options: { cardCount, difficulty: "balanced", cardStyle: "question-answer" }, requestedCardCount, targetMinimumCardCount };
}

const TIERS = [
  { name: "small" as const, targetMinimum: 5, max: 8 },
  { name: "medium" as const, targetMinimum: 10, max: 15 },
  { name: "large" as const, targetMinimum: 18, max: 25 },
];

for (const tier of TIERS) {
  test(`${tier.name}: targetMinimum cards + complete status is a valid, "complete" result`, () => {
    const ids = chunkIds(tier.max);
    const raw = { title: "Deck", generationStatus: "complete", cards: cardsFor(tier.targetMinimum, ids) };
    const outcome = validateGeneratedDeckResponse(raw, makeContext(ids), tierRequest(tier.name, tier.max, tier.targetMinimum), "mock-v1");
    assert.equal(outcome.status, "valid");
    if (outcome.status === "valid") {
      assert.equal(outcome.draft.cards.length, tier.targetMinimum);
      assert.equal(outcome.draft.generation.generationStatus, "complete");
    }
  });

  test(`${tier.name}: max cards + complete status is a valid, "complete" result`, () => {
    const ids = chunkIds(tier.max);
    const raw = { title: "Deck", generationStatus: "complete", cards: cardsFor(tier.max, ids) };
    const outcome = validateGeneratedDeckResponse(raw, makeContext(ids), tierRequest(tier.name, tier.max, tier.targetMinimum), "mock-v1");
    assert.equal(outcome.status, "valid");
    if (outcome.status === "valid") {
      assert.equal(outcome.draft.cards.length, tier.max);
      assert.equal(outcome.draft.generation.generationStatus, "complete");
    }
  });

  test(`${tier.name}: below-target cards claiming "complete" is a contradiction — handled by overriding to insufficient-distinct-content, cards still kept`, () => {
    const belowTarget = tier.targetMinimum - 2;
    const ids = chunkIds(tier.max);
    const raw = { title: "Deck", generationStatus: "complete", cards: cardsFor(belowTarget, ids) };
    const outcome = validateGeneratedDeckResponse(raw, makeContext(ids), tierRequest(tier.name, tier.max, tier.targetMinimum), "mock-v1");
    assert.equal(outcome.status, "valid", "a below-target shortfall is never a whole-deck rejection by itself");
    if (outcome.status === "valid") {
      assert.equal(outcome.draft.cards.length, belowTarget);
      assert.equal(
        outcome.draft.generation.generationStatus,
        "insufficient-distinct-content",
        "the model's self-reported 'complete' must never be trusted over the actual count"
      );
    }
  });

  test(`${tier.name}: below-target cards + a matching insufficient-distinct-content self-report is a valid, consistent shortfall`, () => {
    const belowTarget = tier.targetMinimum - 2;
    const ids = chunkIds(tier.max);
    const raw = { title: "Deck", generationStatus: "insufficient-distinct-content", cards: cardsFor(belowTarget, ids) };
    const outcome = validateGeneratedDeckResponse(raw, makeContext(ids), tierRequest(tier.name, tier.max, tier.targetMinimum), "mock-v1");
    assert.equal(outcome.status, "valid");
    if (outcome.status === "valid") {
      assert.equal(outcome.draft.cards.length, belowTarget);
      assert.equal(outcome.draft.generation.generationStatus, "insufficient-distinct-content");
    }
  });

  test(`${tier.name}: more cards than the requested maximum is rejected outright (exceeds-requested-max), never truncated locally`, () => {
    const ids = chunkIds(tier.max + 1);
    const raw = { title: "Deck", generationStatus: "complete", cards: cardsFor(tier.max + 1, ids) };
    const outcome = validateGeneratedDeckResponse(raw, makeContext(ids), tierRequest(tier.name, tier.max, tier.targetMinimum), "mock-v1");
    assert.equal(outcome.status, "invalid");
    if (outcome.status === "invalid") assert.equal(outcome.deckIssues[0].code, "exceeds-requested-max");
  });
}

// ---- Status edge cases ----

test("an unrecognized/invalid generationStatus string is treated as unreported, never a structural rejection", () => {
  const ids = chunkIds(15);
  const raw = { title: "Deck", generationStatus: "not-a-real-status", cards: cardsFor(15, ids) };
  const outcome = validateGeneratedDeckResponse(raw, makeContext(ids), tierRequest("medium", 15, 10), "mock-v1");
  assert.equal(outcome.status, "valid");
  if (outcome.status === "valid") assert.equal(outcome.draft.generation.generationStatus, "complete");
});

test("a missing generationStatus field is treated the same as an unrecognized one — the derived status still wins", () => {
  const ids = chunkIds(15);
  const raw = { title: "Deck", cards: cardsFor(6, ids) };
  const outcome = validateGeneratedDeckResponse(raw, makeContext(ids), tierRequest("medium", 15, 10), "mock-v1");
  assert.equal(outcome.status, "valid");
  if (outcome.status === "valid") assert.equal(outcome.draft.generation.generationStatus, "insufficient-distinct-content");
});

test("a generationStatus of 'insufficient-distinct-content' despite meeting the target is overridden to complete", () => {
  const ids = chunkIds(15);
  const raw = { title: "Deck", generationStatus: "insufficient-distinct-content", cards: cardsFor(12, ids) };
  const outcome = validateGeneratedDeckResponse(raw, makeContext(ids), tierRequest("medium", 15, 10), "mock-v1");
  assert.equal(outcome.status, "valid");
  if (outcome.status === "valid") {
    assert.equal(outcome.draft.cards.length, 12);
    assert.equal(outcome.draft.generation.generationStatus, "complete", "the actual count already proves sufficiency");
  }
});

test("malformed generationStatus metadata (not a string) never crashes validation", () => {
  const ids = chunkIds(15);
  for (const malformed of [42, {}, [], null, true]) {
    const raw = { title: "Deck", generationStatus: malformed, cards: cardsFor(10, ids) };
    const outcome = validateGeneratedDeckResponse(raw, makeContext(ids), tierRequest("medium", 15, 10), "mock-v1");
    assert.equal(outcome.status, "valid");
    if (outcome.status === "valid") assert.equal(outcome.draft.generation.generationStatus, "complete");
  }
});

test("targetMinimumCardCount is echoed onto the draft's generation metadata exactly as requested", () => {
  const ids = chunkIds(15);
  const raw = { title: "Deck", generationStatus: "complete", cards: cardsFor(10, ids) };
  const outcome = validateGeneratedDeckResponse(raw, makeContext(ids), tierRequest("medium", 15, 10), "mock-v1");
  assert.equal(outcome.status, "valid");
  if (outcome.status === "valid") assert.equal(outcome.draft.generation.targetMinimumCardCount, 10);
});

// ---- deriveGenerationStatus (pure) ----

test("deriveGenerationStatus: at or above the target minimum is always complete", () => {
  assert.equal(deriveGenerationStatus(10, 10), "complete");
  assert.equal(deriveGenerationStatus(15, 10), "complete");
});

test("deriveGenerationStatus: below the target minimum is always insufficient-distinct-content", () => {
  assert.equal(deriveGenerationStatus(9, 10), "insufficient-distinct-content");
  assert.equal(deriveGenerationStatus(0, 1), "insufficient-distinct-content");
});

test("deriveGenerationStatus is deterministic for the same input", () => {
  assert.equal(deriveGenerationStatus(7, 10), deriveGenerationStatus(7, 10));
});
