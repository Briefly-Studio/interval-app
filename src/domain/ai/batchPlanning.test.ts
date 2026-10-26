import { test } from "node:test";
import assert from "node:assert/strict";

import type { NormalizedChunk } from "../normalization/types";
import { canPlanBatchesFor, MAX_BATCHES_PER_GENERATION, planGenerationBatches } from "./batchPlanning";

function chunk(index: number, approxSize = 100): NormalizedChunk {
  return { id: `chunk_${index}`, index, text: `Chunk ${index}`, approxSize, provenance: {} };
}

function manyChunks(count: number, approxSize = 100): NormalizedChunk[] {
  return Array.from({ length: count }, (_, i) => chunk(i, approxSize));
}

test("a source that fits one batch produces a single batch with every chunk", () => {
  const chunks = manyChunks(5, 100);
  const plan = planGenerationBatches(chunks, { charBudget: 1000 });
  assert.equal(plan.status, "ok");
  if (plan.status === "ok") {
    assert.equal(plan.batches.length, 1);
    assert.deepEqual(plan.batches[0].chunkIds, chunks.map((c) => c.id));
    assert.equal(plan.totalCandidateChunks, 5);
  }
});

test("a source that exactly fills one batch stays a single batch", () => {
  const chunks = manyChunks(10, 100); // exactly 1000 chars
  const plan = planGenerationBatches(chunks, { charBudget: 1000 });
  assert.equal(plan.status, "ok");
  if (plan.status === "ok") assert.equal(plan.batches.length, 1);
});

test("one chunk over budget spills into a second batch", () => {
  const chunks = manyChunks(11, 100); // 1100 chars, budget 1000
  const plan = planGenerationBatches(chunks, { charBudget: 1000 });
  assert.equal(plan.status, "ok");
  if (plan.status === "ok") {
    assert.equal(plan.batches.length, 2);
    assert.equal(plan.batches[0].chunkIds.length, 10);
    assert.equal(plan.batches[1].chunkIds.length, 1);
  }
});

test("many chunks partition into several batches, every chunk assigned exactly once, source order preserved", () => {
  const chunks = manyChunks(45, 100); // budget 1000 -> 10 per batch -> 5 batches
  const plan = planGenerationBatches(chunks, { charBudget: 1000 });
  assert.equal(plan.status, "ok");
  if (plan.status === "ok") {
    assert.equal(plan.batches.length, 5);
    const allAssignedIds = plan.batches.flatMap((b) => b.chunkIds);
    assert.deepEqual(allAssignedIds, chunks.map((c) => c.id));
    assert.deepEqual(new Set(allAssignedIds), new Set(chunks.map((c) => c.id)));
    for (const batch of plan.batches) {
      assert.ok(batch.chunkIds.length > 0, "no batch is ever empty");
      assert.ok(batch.approxChars <= 1000, "no batch exceeds the budget");
    }
  }
});

test("no chunks is an explicit no-content error, never an empty-but-ok plan", () => {
  const plan = planGenerationBatches([]);
  assert.deepEqual(plan, { status: "error", code: "no-content" });
});

test("a plan needing more than the max batch count is refused before any provider call", () => {
  const chunks = manyChunks(100, 100); // budget 100 -> 1 per batch -> 100 batches
  const plan = planGenerationBatches(chunks, { charBudget: 100, maxBatches: 8 });
  assert.deepEqual(plan, { status: "error", code: "plan-too-large" });
});

test("default maxBatches matches the exported MAX_BATCHES_PER_GENERATION constant", () => {
  const chunks = manyChunks(MAX_BATCHES_PER_GENERATION + 1, 100);
  const plan = planGenerationBatches(chunks, { charBudget: 100 });
  assert.deepEqual(plan, { status: "error", code: "plan-too-large" });
});

test("deterministic — the same input always produces the same plan", () => {
  const chunks = manyChunks(23, 137);
  const planA = planGenerationBatches(chunks, { charBudget: 1000 });
  const planB = planGenerationBatches(chunks, { charBudget: 1000 });
  assert.deepEqual(planA, planB);
});

test("a single chunk whose own approxSize exceeds the budget still gets its own batch, never dropped", () => {
  const chunks = [chunk(0, 50), chunk(1, 5000), chunk(2, 50)];
  const plan = planGenerationBatches(chunks, { charBudget: 1000 });
  assert.equal(plan.status, "ok");
  if (plan.status === "ok") {
    const allAssignedIds = plan.batches.flatMap((b) => b.chunkIds);
    assert.deepEqual(allAssignedIds, ["chunk_0", "chunk_1", "chunk_2"]);
    // The oversized chunk gets isolated into its own batch rather than being merged/dropped.
    const oversizedBatch = plan.batches.find((b) => b.chunkIds.includes("chunk_1"));
    assert.deepEqual(oversizedBatch?.chunkIds, ["chunk_1"]);
  }
});

test("works identically on a pre-restricted candidate subset (e.g. an uncovered/page/section range selection)", () => {
  const subset = [chunk(3, 100), chunk(7, 100), chunk(9, 100)];
  const plan = planGenerationBatches(subset, { charBudget: 1000 });
  assert.equal(plan.status, "ok");
  if (plan.status === "ok") {
    assert.equal(plan.batches.length, 1);
    assert.deepEqual(plan.batches[0].chunkIds, ["chunk_3", "chunk_7", "chunk_9"]);
  }
});

test("canPlanBatchesFor is true exactly when planGenerationBatches would succeed", () => {
  assert.equal(canPlanBatchesFor(manyChunks(5, 100), { charBudget: 1000 }), true);
  assert.equal(canPlanBatchesFor([], { charBudget: 1000 }), false);
  assert.equal(canPlanBatchesFor(manyChunks(100, 100), { charBudget: 100, maxBatches: 8 }), false);
});
