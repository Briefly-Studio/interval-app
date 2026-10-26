import { test } from "node:test";
import assert from "node:assert/strict";

import type { GeneratedCardProvenance } from "../models/generatedCardProvenance";
import { computeSourceCoverage, deriveCoveredChunkIds, deriveSourceCoverageDisplayState } from "./sourceCoverage";

function provenance(overrides: Partial<GeneratedCardProvenance>): GeneratedCardProvenance {
  return {
    cardId: "card-1",
    deckId: "deck-1",
    sourceId: "source-1",
    sourceChunkIds: ["chunk_1"],
    generatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---- computeSourceCoverage ----

test("computeSourceCoverage: zero chunks never fabricates a percentage", () => {
  const coverage = computeSourceCoverage([], []);
  assert.equal(coverage.totalChunkCount, 0);
  assert.equal(coverage.coveredChunkCount, 0);
  assert.equal(coverage.uncoveredChunkCount, 0);
  assert.equal(coverage.coverageRatio, null);
});

test("computeSourceCoverage: zero covered chunks out of a real total", () => {
  const coverage = computeSourceCoverage(["chunk_1", "chunk_2", "chunk_3"], []);
  assert.equal(coverage.totalChunkCount, 3);
  assert.equal(coverage.coveredChunkCount, 0);
  assert.equal(coverage.uncoveredChunkCount, 3);
  assert.equal(coverage.coverageRatio, 0);
  assert.deepEqual(coverage.uncoveredChunkIds, ["chunk_1", "chunk_2", "chunk_3"]);
});

test("computeSourceCoverage: partial coverage", () => {
  const coverage = computeSourceCoverage(["chunk_1", "chunk_2", "chunk_3", "chunk_4"], ["chunk_2", "chunk_4"]);
  assert.equal(coverage.totalChunkCount, 4);
  assert.equal(coverage.coveredChunkCount, 2);
  assert.equal(coverage.uncoveredChunkCount, 2);
  assert.equal(coverage.coverageRatio, 0.5);
  assert.deepEqual(coverage.coveredChunkIds, ["chunk_2", "chunk_4"]);
  assert.deepEqual(coverage.uncoveredChunkIds, ["chunk_1", "chunk_3"]);
});

test("computeSourceCoverage: full coverage", () => {
  const coverage = computeSourceCoverage(["chunk_1", "chunk_2"], ["chunk_1", "chunk_2"]);
  assert.equal(coverage.coveredChunkCount, 2);
  assert.equal(coverage.uncoveredChunkCount, 0);
  assert.equal(coverage.coverageRatio, 1);
});

test("computeSourceCoverage: duplicate entries in liveCoveredChunkIds do not double-count", () => {
  const coverage = computeSourceCoverage(["chunk_1", "chunk_2"], ["chunk_1", "chunk_1", "chunk_1"]);
  assert.equal(coverage.coveredChunkCount, 1);
});

test("computeSourceCoverage: unknown chunk ids (stale provenance) are ignored, not crashed on", () => {
  const coverage = computeSourceCoverage(["chunk_1"], ["chunk_1", "chunk_does_not_exist_anymore"]);
  assert.equal(coverage.totalChunkCount, 1);
  assert.equal(coverage.coveredChunkCount, 1);
  assert.deepEqual(coverage.coveredChunkIds, ["chunk_1"]);
});

// ---- deriveCoveredChunkIds ----

test("deriveCoveredChunkIds: a deleted card's provenance is excluded", () => {
  const entries = [provenance({ cardId: "card-dead", sourceChunkIds: ["chunk_1"] })];
  const covered = deriveCoveredChunkIds(entries, new Set());
  assert.equal(covered.size, 0);
});

test("deriveCoveredChunkIds: a restored (live) card's provenance is included", () => {
  const entries = [provenance({ cardId: "card-1", sourceChunkIds: ["chunk_1"] })];
  const covered = deriveCoveredChunkIds(entries, new Set(["card-1"]));
  assert.deepEqual(Array.from(covered), ["chunk_1"]);
});

test("deriveCoveredChunkIds: multiple cards covering the same chunk collapse to one entry", () => {
  const entries = [
    provenance({ cardId: "card-1", sourceChunkIds: ["chunk_1"] }),
    provenance({ cardId: "card-2", sourceChunkIds: ["chunk_1"] }),
  ];
  const covered = deriveCoveredChunkIds(entries, new Set(["card-1", "card-2"]));
  assert.deepEqual(Array.from(covered), ["chunk_1"]);
});

test("deriveCoveredChunkIds: multiple decks covering different chunks of the same source aggregate", () => {
  const entries = [
    provenance({ cardId: "card-1", deckId: "deck-A", sourceChunkIds: ["chunk_1", "chunk_2"] }),
    provenance({ cardId: "card-2", deckId: "deck-B", sourceChunkIds: ["chunk_2", "chunk_3"] }),
  ];
  const covered = deriveCoveredChunkIds(entries, new Set(["card-1", "card-2"]));
  assert.deepEqual(Array.from(covered).sort(), ["chunk_1", "chunk_2", "chunk_3"]);
});

test("deriveCoveredChunkIds: a provenance entry for a different source must be pre-filtered by the caller — this function trusts the list it's given", () => {
  // getProvenanceForSource is the thing responsible for the sourceId filter; this pure function
  // only ever sees already-scoped entries in real use. Documented here so the contract is explicit.
  const entries = [provenance({ cardId: "card-1", sourceId: "some-other-source", sourceChunkIds: ["chunk_1"] })];
  const covered = deriveCoveredChunkIds(entries, new Set(["card-1"]));
  // Without an explicit sourceId filter this WOULD be counted — proving the filter must happen
  // upstream (getProvenanceForSource), not here.
  assert.deepEqual(Array.from(covered), ["chunk_1"]);
});

test("deriveCoveredChunkIds: manual/imported cards never appear (no provenance entry exists for them)", () => {
  // Manual/CSV-imported cards simply never produce a GeneratedCardProvenance entry, so an empty
  // provenance list for a source with such cards correctly yields zero coverage contribution.
  const covered = deriveCoveredChunkIds([], new Set(["manual-card-1", "imported-card-2"]));
  assert.equal(covered.size, 0);
});

// ---- deriveSourceCoverageDisplayState ----

test("deriveSourceCoverageDisplayState: no-content when totalChunkCount is 0", () => {
  const state = deriveSourceCoverageDisplayState(computeSourceCoverage([], []));
  assert.deepEqual(state, { kind: "no-content" });
});

test("deriveSourceCoverageDisplayState: no-cards when total > 0 but nothing is covered", () => {
  const state = deriveSourceCoverageDisplayState(computeSourceCoverage(["chunk_1", "chunk_2"], []));
  assert.deepEqual(state, { kind: "no-cards", totalChunkCount: 2 });
});

test("deriveSourceCoverageDisplayState: partial reports a rounded percent", () => {
  const state = deriveSourceCoverageDisplayState(computeSourceCoverage(["c1", "c2", "c3"], ["c1"]));
  assert.deepEqual(state, { kind: "partial", coveredChunkCount: 1, totalChunkCount: 3, percent: 33 });
});

test("deriveSourceCoverageDisplayState: full when every chunk is covered", () => {
  const state = deriveSourceCoverageDisplayState(computeSourceCoverage(["c1", "c2"], ["c1", "c2"]));
  assert.deepEqual(state, { kind: "full", totalChunkCount: 2 });
});

test("deriveSourceCoverageDisplayState is deterministic for the same input", () => {
  const coverage = computeSourceCoverage(["c1", "c2", "c3", "c4", "c5", "c6", "c7"], ["c1", "c2", "c3"]);
  const a = deriveSourceCoverageDisplayState(coverage);
  const b = deriveSourceCoverageDisplayState(coverage);
  assert.deepEqual(a, b);
});
