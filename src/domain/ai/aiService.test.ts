import { test } from "node:test";
import assert from "node:assert/strict";
import { generateStudyDeck } from "./aiService";
import type { ModelProvider } from "./aiService";
import { createMockProvider } from "./mockProvider";
import type { NormalizedSourceContent, NormalizedChunk } from "../normalization/types";
import { DEFAULT_GENERATION_OPTIONS } from "./generationOptions";

function makeChunk(id: string, index: number, size = 100): NormalizedChunk {
  return {
    id,
    index,
    text: `Chunk ${id} content `.repeat(Math.max(1, Math.floor(size / 20))),
    approxSize: size,
    provenance: {},
  };
}

function makeContent(chunks: NormalizedChunk[], status: NormalizedSourceContent["extraction"]["status"] = "ready"): NormalizedSourceContent {
  return {
    sourceId: "src-1",
    sourceType: "text",
    title: "Test Source",
    contentKind: "text",
    chunks,
    metadata: {},
    extraction: { status, adapter: "text-v1" },
    normalizationVersion: 1,
  };
}

test("generateStudyDeck maps a non-ready extraction status to an error, never calling the provider", async () => {
  let called = false;
  const provider: ModelProvider = {
    id: "spy",
    async generate() {
      called = true;
      return { status: "ok", raw: { title: "x", cards: [] } };
    },
  };
  const content = makeContent([], "unsupported");
  const outcome = await generateStudyDeck(provider, { sourceTitle: "T", normalizedContent: content, options: DEFAULT_GENERATION_OPTIONS });
  assert.equal(outcome.status, "error");
  assert.equal(called, false);
  if (outcome.status === "error") assert.equal(outcome.error.code, "unsupported-source");
});

test("generateStudyDeck end to end with the mock provider produces a valid draft", async () => {
  const content = makeContent([makeChunk("a", 0), makeChunk("b", 1)]);
  const outcome = await generateStudyDeck(createMockProvider(), {
    sourceTitle: "Test Source",
    normalizedContent: content,
    options: DEFAULT_GENERATION_OPTIONS,
  });
  assert.equal(outcome.status, "ready");
  if (outcome.status === "ready") {
    assert.equal(outcome.draft.generation.fullSourceIncluded, true);
    assert.equal(outcome.draft.cards.length, 2);
  }
});

// Regression test for the "partial selection reported as full source" provenance bug: when a
// caller restricts generation to a subset of chunks via selectedChunkIds, fullSourceIncluded must
// be false and the omitted chunks must be reported as excluded — even when the selected subset
// itself fits entirely within the context budget.
test("generateStudyDeck reports fullSourceIncluded: false when selectedChunkIds omits chunks that would otherwise fit", async () => {
  const content = makeContent([makeChunk("a", 0), makeChunk("b", 1), makeChunk("c", 2)]);
  const outcome = await generateStudyDeck(createMockProvider(), {
    sourceTitle: "Test Source",
    normalizedContent: content,
    options: DEFAULT_GENERATION_OPTIONS,
    selectedChunkIds: ["a"],
  });
  assert.equal(outcome.status, "ready");
  if (outcome.status === "ready") {
    assert.equal(outcome.draft.generation.fullSourceIncluded, false);
    assert.equal(outcome.draft.generation.excludedChunkCount, 2);
  }
});

test("generateStudyDeck still reports fullSourceIncluded: true when every chunk is selected", async () => {
  const content = makeContent([makeChunk("a", 0), makeChunk("b", 1)]);
  const outcome = await generateStudyDeck(createMockProvider(), {
    sourceTitle: "Test Source",
    normalizedContent: content,
    options: DEFAULT_GENERATION_OPTIONS,
    selectedChunkIds: ["a", "b"],
  });
  assert.equal(outcome.status, "ready");
  if (outcome.status === "ready") {
    assert.equal(outcome.draft.generation.fullSourceIncluded, true);
    assert.equal(outcome.draft.generation.excludedChunkCount, 0);
  }
});

// Count contract end-to-end (mission: card-count quality) — the mock provider honestly produces
// one card per available chunk and self-reports accordingly, so a Medium request (targetMinimum
// 10) with only 3 available chunks legitimately falls short, and the draft carries that as a real
// insufficient-distinct-content result, not a silent/unexplained shortfall.
test("generateStudyDeck end to end: a Medium request with too few context chunks to meet the target minimum is reported as insufficient-distinct-content", async () => {
  const content = makeContent([makeChunk("a", 0), makeChunk("b", 1), makeChunk("c", 2)]);
  const outcome = await generateStudyDeck(createMockProvider(), {
    sourceTitle: "Test Source",
    normalizedContent: content,
    options: { cardCount: "medium", difficulty: "balanced", cardStyle: "question-answer" },
  });
  assert.equal(outcome.status, "ready");
  if (outcome.status === "ready") {
    assert.equal(outcome.draft.cards.length, 3);
    assert.equal(outcome.draft.generation.targetMinimumCardCount, 10);
    assert.equal(outcome.draft.generation.requestedCardCount, 15);
    assert.equal(outcome.draft.generation.generationStatus, "insufficient-distinct-content");
  }
});

test("generateStudyDeck end to end: a Small request with enough context chunks to meet the target minimum is reported as complete", async () => {
  const content = makeContent([makeChunk("a", 0), makeChunk("b", 1), makeChunk("c", 2), makeChunk("d", 3), makeChunk("e", 4)]);
  const outcome = await generateStudyDeck(createMockProvider(), {
    sourceTitle: "Test Source",
    normalizedContent: content,
    options: { cardCount: "small", difficulty: "balanced", cardStyle: "question-answer" },
  });
  assert.equal(outcome.status, "ready");
  if (outcome.status === "ready") {
    assert.equal(outcome.draft.cards.length, 5);
    assert.equal(outcome.draft.generation.targetMinimumCardCount, 5);
    assert.equal(outcome.draft.generation.generationStatus, "complete");
  }
});
