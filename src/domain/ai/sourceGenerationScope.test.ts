import { test } from "node:test";
import assert from "node:assert/strict";

import type { NormalizedChunk } from "../normalization/types";
import { DEFAULT_CONTEXT_CHAR_BUDGET } from "./contextPreparation";
import { fitsContextBudget, getSectionCount, resolveSourceGenerationScope } from "./sourceGenerationScope";

function chunk(index: number, overrides: Partial<NormalizedChunk> = {}): NormalizedChunk {
  return {
    id: `chunk_${index}`,
    index,
    text: `Chunk ${index} text`,
    approxSize: 100,
    provenance: {},
    ...overrides,
  };
}

function pdfChunks(perPage: Record<number, number>): NormalizedChunk[] {
  const chunks: NormalizedChunk[] = [];
  let globalIndex = 0;
  for (const [page, count] of Object.entries(perPage)) {
    for (let i = 0; i < count; i++) {
      chunks.push(chunk(globalIndex, { provenance: { page: Number(page) } }));
      globalIndex++;
    }
  }
  return chunks;
}

// ---- Automatic ----

test("automatic always resolves to no restriction, regardless of input", () => {
  const result = resolveSourceGenerationScope({ chunks: [chunk(0), chunk(1)], scope: { type: "automatic" } });
  assert.deepEqual(result, { status: "ok" });
});

test("automatic resolves to no restriction even for an empty chunk list", () => {
  const result = resolveSourceGenerationScope({ chunks: [], scope: { type: "automatic" } });
  assert.deepEqual(result, { status: "ok" });
});

// ---- Entire source ----

test("entireSource resolves ok with every chunk id, explicitly, when the full source fits the budget", () => {
  const chunks = [chunk(0, { approxSize: 100 }), chunk(1, { approxSize: 100 })];
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "entireSource" } });
  assert.deepEqual(result, { status: "ok", chunkIds: ["chunk_0", "chunk_1"] });
});

// Multi-batch generation (batchPlanning.ts/multiBatchGeneration.ts) is what now makes "entire
// source" truthful for a source larger than one context budget — scope resolution itself no
// longer gates on budget at all, only on whether there's any content to select from.
test("entireSource still resolves ok with every chunk id even when the full source exceeds one context budget", () => {
  const chunks = [
    chunk(0, { approxSize: DEFAULT_CONTEXT_CHAR_BUDGET }),
    chunk(1, { approxSize: DEFAULT_CONTEXT_CHAR_BUDGET }),
  ];
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "entireSource" } });
  assert.deepEqual(result, { status: "ok", chunkIds: ["chunk_0", "chunk_1"] });
});

test("entireSource errors for a source with zero chunks", () => {
  const result = resolveSourceGenerationScope({ chunks: [], scope: { type: "entireSource" } });
  assert.deepEqual(result, { status: "error", code: "entire-source-too-large" });
});

// fitsContextBudget is no longer entireSource's own gate (multi-batch planning now handles the
// "doesn't fit one budget" case) — it remains used by the options screen to decide whether a
// RESTRICTIVE scope's own candidate set needs batching at all. Still exercised directly here.
test("fitsContextBudget: true only when every chunk fits within one context budget", () => {
  const fits = [chunk(0, { approxSize: 10 }), chunk(1, { approxSize: 10 })];
  const tooBig = [chunk(0, { approxSize: DEFAULT_CONTEXT_CHAR_BUDGET + 1 })];
  assert.equal(fitsContextBudget(fits), true);
  assert.equal(fitsContextBudget(tooBig), false);
  assert.equal(fitsContextBudget([]), false);
});

// ---- Uncovered ----

test("uncovered selects only uncovered chunk ids, preserving source order", () => {
  const chunks = [chunk(0), chunk(1), chunk(2), chunk(3)];
  const coverage = {
    totalChunkCount: 4,
    coveredChunkCount: 2,
    uncoveredChunkCount: 2,
    coverageRatio: 0.5,
    coveredChunkIds: ["chunk_0", "chunk_2"],
    uncoveredChunkIds: ["chunk_1", "chunk_3"],
  };
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "uncovered" }, coverage });
  assert.deepEqual(result, { status: "ok", chunkIds: ["chunk_1", "chunk_3"] });
});

test("uncovered excludes covered chunks even if coverage data is out of order", () => {
  const chunks = [chunk(0), chunk(1), chunk(2)];
  const coverage = {
    totalChunkCount: 3,
    coveredChunkCount: 1,
    uncoveredChunkCount: 2,
    coverageRatio: 2 / 3,
    coveredChunkIds: ["chunk_1"],
    // Deliberately listed out of document order — result must still follow `chunks`' own order.
    uncoveredChunkIds: ["chunk_2", "chunk_0"],
  };
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "uncovered" }, coverage });
  assert.deepEqual(result, { status: "ok", chunkIds: ["chunk_0", "chunk_2"] });
});

test("uncovered errors when there is zero uncovered material", () => {
  const chunks = [chunk(0), chunk(1)];
  const coverage = {
    totalChunkCount: 2,
    coveredChunkCount: 2,
    uncoveredChunkCount: 0,
    coverageRatio: 1,
    coveredChunkIds: ["chunk_0", "chunk_1"],
    uncoveredChunkIds: [],
  };
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "uncovered" }, coverage });
  assert.deepEqual(result, { status: "error", code: "uncovered-unavailable" });
});

test("uncovered errors when no coverage was supplied at all", () => {
  const result = resolveSourceGenerationScope({ chunks: [chunk(0)], scope: { type: "uncovered" } });
  assert.deepEqual(result, { status: "error", code: "uncovered-unavailable" });
});

test("uncovered safely ignores a stale coverage chunk id that no longer exists in the current chunks", () => {
  const chunks = [chunk(0), chunk(1)];
  const coverage = {
    totalChunkCount: 3,
    coveredChunkCount: 1,
    uncoveredChunkCount: 2,
    coverageRatio: 1 / 3,
    coveredChunkIds: ["chunk_2"],
    // "chunk_99" was never in `chunks` — e.g. a re-normalization under a new NORMALIZATION_VERSION.
    uncoveredChunkIds: ["chunk_0", "chunk_99"],
  };
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "uncovered" }, coverage });
  assert.deepEqual(result, { status: "ok", chunkIds: ["chunk_0"] });
});

// ---- PDF page range ----

test("pageRange selects only chunks whose provenance page falls in the requested range", () => {
  const chunks = pdfChunks({ 1: 1, 2: 2, 3: 1, 4: 1 });
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "pageRange", startPage: 2, endPage: 3 }, pageCount: 4 });
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.deepEqual(
      result.chunkIds,
      chunks.filter((c) => c.provenance.page === 2 || c.provenance.page === 3).map((c) => c.id)
    );
  }
});

test("pageRange supports a single-page range", () => {
  const chunks = pdfChunks({ 1: 1, 2: 1, 3: 1 });
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "pageRange", startPage: 2, endPage: 2 }, pageCount: 3 });
  assert.equal(result.status, "ok");
  if (result.status === "ok") assert.deepEqual(result.chunkIds, [chunks[1].id]);
});

test("pageRange rejects a reversed range", () => {
  const chunks = pdfChunks({ 1: 1, 2: 1 });
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "pageRange", startPage: 2, endPage: 1 }, pageCount: 2 });
  assert.deepEqual(result, { status: "error", code: "invalid-range" });
});

test("pageRange rejects an out-of-bounds range", () => {
  const chunks = pdfChunks({ 1: 1, 2: 1 });
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "pageRange", startPage: 1, endPage: 10 }, pageCount: 2 });
  assert.deepEqual(result, { status: "error", code: "invalid-range" });
});

test("pageRange rejects a zero/negative start page", () => {
  const chunks = pdfChunks({ 1: 1 });
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "pageRange", startPage: 0, endPage: 1 }, pageCount: 1 });
  assert.deepEqual(result, { status: "error", code: "invalid-range" });
});

test("pageRange errors when no page count is known at all", () => {
  const chunks = pdfChunks({ 1: 1, 2: 1 });
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "pageRange", startPage: 1, endPage: 2 } });
  assert.deepEqual(result, { status: "error", code: "page-range-unavailable" });
});

test("pageRange reports empty-selection when a valid range matches zero chunks (e.g. blank pages produced none)", () => {
  // Pages 2-3 produced no chunks at all (blank), even though the document has 4 pages.
  const chunks = pdfChunks({ 1: 1, 4: 1 });
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "pageRange", startPage: 2, endPage: 3 }, pageCount: 4 });
  assert.deepEqual(result, { status: "error", code: "empty-selection" });
});

test("pageRange correctly handles chunks never spanning a page boundary", () => {
  const chunks = pdfChunks({ 5: 3 });
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "pageRange", startPage: 5, endPage: 5 }, pageCount: 5 });
  assert.equal(result.status, "ok");
  if (result.status === "ok") assert.equal(result.chunkIds?.length, 3);
});

// ---- Generic section range ----

test("sectionRange selects a 1-based ordinal range of chunks and preserves order", () => {
  const chunks = [chunk(0), chunk(1), chunk(2), chunk(3), chunk(4)];
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "sectionRange", startSection: 2, endSection: 4 } });
  assert.deepEqual(result, { status: "ok", chunkIds: ["chunk_1", "chunk_2", "chunk_3"] });
});

test("sectionRange rejects a reversed range", () => {
  const chunks = [chunk(0), chunk(1), chunk(2)];
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "sectionRange", startSection: 3, endSection: 1 } });
  assert.deepEqual(result, { status: "error", code: "invalid-range" });
});

test("sectionRange rejects an out-of-bounds range", () => {
  const chunks = [chunk(0), chunk(1)];
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "sectionRange", startSection: 1, endSection: 5 } });
  assert.deepEqual(result, { status: "error", code: "invalid-range" });
});

test("sectionRange errors for a source with zero chunks", () => {
  const result = resolveSourceGenerationScope({ chunks: [], scope: { type: "sectionRange", startSection: 1, endSection: 1 } });
  assert.deepEqual(result, { status: "error", code: "invalid-range" });
});

test("getSectionCount is simply the chunk count", () => {
  assert.equal(getSectionCount([chunk(0), chunk(1), chunk(2)]), 3);
  assert.equal(getSectionCount([]), 0);
});
