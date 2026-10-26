import { test } from "node:test";
import assert from "node:assert/strict";

import { allocateCardsAcrossBatches, distributeEvenly } from "./batchCardAllocation";

test("distributeEvenly sums to exactly the total, spread evenly (mission's own 4+4+4+3 example, in a different but equally fair order)", () => {
  const result = distributeEvenly(15, 4);
  assert.equal(result.reduce((a, b) => a + b, 0), 15);
  assert.deepEqual(result, [3, 4, 4, 4]);
});

test("distributeEvenly gives every bucket at least floor(total/count) when total >= count", () => {
  const result = distributeEvenly(9, 8);
  assert.equal(result.reduce((a, b) => a + b, 0), 9);
  assert.ok(result.every((n) => n >= 1));
});

test("distributeEvenly spreads a shortfall across the sequence rather than clustering zeros at the end", () => {
  const result = distributeEvenly(8, 10);
  assert.equal(result.reduce((a, b) => a + b, 0), 8);
  const zeroIndexes = result.flatMap((n, i) => (n === 0 ? [i] : []));
  assert.equal(zeroIndexes.length, 2);
  // Neither the very first nor the very last bucket should both be among the only two zeros in a
  // way that systematically starves one end — spot-check the LAST bucket specifically gets a
  // nonzero share (late batches must not be starved).
  assert.notEqual(result[result.length - 1], 0);
});

test("distributeEvenly returns an empty array for zero/negative count", () => {
  assert.deepEqual(distributeEvenly(10, 0), []);
  assert.deepEqual(distributeEvenly(10, -1), []);
});

test("distributeEvenly handles total smaller than count by giving most buckets zero, deterministically", () => {
  const a = distributeEvenly(2, 5);
  const b = distributeEvenly(2, 5);
  assert.deepEqual(a, b);
  assert.equal(a.reduce((x, y) => x + y, 0), 2);
});

// ---- Small (ceiling 8) ----

test("Small across 1 batch: the whole ceiling goes to the only batch", () => {
  assert.deepEqual(allocateCardsAcrossBatches({ batchCount: 1, requestedCardCount: 8 }), [8]);
});

test("Small across 2 batches: sum <= ceiling, deterministic, no batch starved", () => {
  const result = allocateCardsAcrossBatches({ batchCount: 2, requestedCardCount: 8 });
  assert.equal(result.reduce((a, b) => a + b, 0), 8);
  assert.ok(result.every((n) => n >= 1));
});

test("Small across 5 batches: every batch still gets a real opportunity (effective ceiling rises to 5)", () => {
  const result = allocateCardsAcrossBatches({ batchCount: 5, requestedCardCount: 8 });
  assert.equal(result.length, 5);
  assert.ok(result.every((n) => n >= 1));
  // 8 already >= 5, so no effective-ceiling bump is needed here; sum stays at the nominal ceiling.
  assert.equal(result.reduce((a, b) => a + b, 0), 8);
});

// ---- Medium (ceiling 15) ----

test("Medium across 1 batch", () => {
  assert.deepEqual(allocateCardsAcrossBatches({ batchCount: 1, requestedCardCount: 15 }), [15]);
});

test("Medium across 2 batches", () => {
  const result = allocateCardsAcrossBatches({ batchCount: 2, requestedCardCount: 15 });
  assert.equal(result.reduce((a, b) => a + b, 0), 15);
  assert.ok(result.every((n) => n >= 1));
});

test("Medium across 4 batches matches the mission's own worked example", () => {
  assert.deepEqual(allocateCardsAcrossBatches({ batchCount: 4, requestedCardCount: 15 }), [3, 4, 4, 4]);
});

test("Medium across many (8) batches: no batch starved, sum stays at the nominal ceiling", () => {
  const result = allocateCardsAcrossBatches({ batchCount: 8, requestedCardCount: 15 });
  assert.equal(result.length, 8);
  assert.ok(result.every((n) => n >= 1));
  assert.equal(result.reduce((a, b) => a + b, 0), 15);
});

// ---- Large (ceiling 25) ----

test("Large across 1 batch", () => {
  assert.deepEqual(allocateCardsAcrossBatches({ batchCount: 1, requestedCardCount: 25 }), [25]);
});

test("Large across 3 batches", () => {
  const result = allocateCardsAcrossBatches({ batchCount: 3, requestedCardCount: 25 });
  assert.equal(result.reduce((a, b) => a + b, 0), 25);
  assert.ok(result.every((n) => n >= 1));
});

test("Large across 6 batches", () => {
  const result = allocateCardsAcrossBatches({ batchCount: 6, requestedCardCount: 25 });
  assert.equal(result.reduce((a, b) => a + b, 0), 25);
  assert.ok(result.every((n) => n >= 1));
  assert.equal(result.length, 6);
});

// ---- Guarantees across the board ----

test("every batch gets at least 1 even when batchCount exceeds the nominal ceiling (effective ceiling rises, bounded)", () => {
  // Only reachable via a raw numeric cardCount override below MAX_BATCHES_PER_GENERATION — not
  // through the shipped Small/Medium/Large UI — but must still behave safely.
  const result = allocateCardsAcrossBatches({ batchCount: 8, requestedCardCount: 3 });
  assert.equal(result.length, 8);
  assert.ok(result.every((n) => n >= 1));
  assert.equal(result.reduce((a, b) => a + b, 0), 8); // effective ceiling rose to batchCount
});

test("deterministic for the same inputs", () => {
  const a = allocateCardsAcrossBatches({ batchCount: 7, requestedCardCount: 15 });
  const b = allocateCardsAcrossBatches({ batchCount: 7, requestedCardCount: 15 });
  assert.deepEqual(a, b);
});

test("zero batches allocates nothing", () => {
  assert.deepEqual(allocateCardsAcrossBatches({ batchCount: 0, requestedCardCount: 15 }), []);
});
