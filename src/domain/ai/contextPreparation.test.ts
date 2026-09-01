import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareGenerationContext, DEFAULT_CONTEXT_CHAR_BUDGET } from "./contextPreparation";
import type { NormalizedSourceContent, NormalizedChunk } from "../normalization/types";

function makeChunk(id: string, index: number, size: number): NormalizedChunk {
  return {
    id,
    index,
    text: "x".repeat(size),
    approxSize: size,
    provenance: {},
  };
}

function makeContent(chunks: NormalizedChunk[]): NormalizedSourceContent {
  return {
    sourceId: "src-1",
    sourceType: "text",
    title: "Test Source",
    contentKind: "text",
    chunks,
    metadata: {},
    extraction: { status: "ready", adapter: "text-v1" },
    normalizationVersion: 1,
  };
}

test("prepareGenerationContext includes everything when it fits the budget", () => {
  const content = makeContent([makeChunk("a", 0, 100), makeChunk("b", 1, 100)]);
  const context = prepareGenerationContext(content);
  assert.equal(context.fullSourceIncluded, true);
  assert.equal(context.excludedChunkCount, 0);
  assert.deepEqual(context.chunks.map((c) => c.id), ["a", "b"]);
});

test("prepareGenerationContext excludes whole chunks once the budget is exceeded, never splitting text", () => {
  const big = DEFAULT_CONTEXT_CHAR_BUDGET;
  const content = makeContent([makeChunk("a", 0, big), makeChunk("b", 1, 10)]);
  const context = prepareGenerationContext(content);
  assert.equal(context.fullSourceIncluded, false);
  assert.deepEqual(context.excludedChunkIds, ["b"]);
  assert.equal(context.excludedChunkCount, 1);
  assert.equal(context.chunks[0].text.length, big);
});

test("prepareGenerationContext returns chunks in original document order even when selection order differs", () => {
  const content = makeContent([makeChunk("a", 0, 10), makeChunk("b", 1, 10), makeChunk("c", 2, 10)]);
  const context = prepareGenerationContext(content, {
    rankChunks: (chunks) => [...chunks].reverse(),
  });
  assert.deepEqual(context.chunks.map((c) => c.id), ["a", "b", "c"]);
});

test("prepareGenerationContext is deterministic for identical input", () => {
  const content = makeContent([makeChunk("a", 0, 50), makeChunk("b", 1, 50)]);
  const first = prepareGenerationContext(content);
  const second = prepareGenerationContext(content);
  assert.deepEqual(first, second);
});

test("prepareGenerationContext on an empty source reports fullSourceIncluded false", () => {
  const content = makeContent([]);
  const context = prepareGenerationContext(content);
  assert.equal(context.fullSourceIncluded, false);
  assert.equal(context.chunkCount, 0);
});
