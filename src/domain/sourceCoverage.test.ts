import { test } from "node:test";
import assert from "node:assert/strict";

import { pluralize, translate } from "../i18n/translate";
import { SUPPORTED_LOCALES } from "../i18n/types";
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
  assert.deepEqual(state, { kind: "no-cards", coveredChunkCount: 0, totalChunkCount: 2, uncoveredChunkCount: 2, percent: 0 });
});

test("deriveSourceCoverageDisplayState: partial reports a rounded percent", () => {
  const state = deriveSourceCoverageDisplayState(computeSourceCoverage(["c1", "c2", "c3"], ["c1"]));
  assert.deepEqual(state, { kind: "partial", coveredChunkCount: 1, totalChunkCount: 3, uncoveredChunkCount: 2, percent: 33 });
});

test("deriveSourceCoverageDisplayState: full when every chunk is covered", () => {
  const state = deriveSourceCoverageDisplayState(computeSourceCoverage(["c1", "c2"], ["c1", "c2"]));
  assert.deepEqual(state, { kind: "full", coveredChunkCount: 2, totalChunkCount: 2, uncoveredChunkCount: 0, percent: 100 });
});

test("deriveSourceCoverageDisplayState is deterministic for the same input", () => {
  const coverage = computeSourceCoverage(["c1", "c2", "c3", "c4", "c5", "c6", "c7"], ["c1", "c2", "c3"]);
  const a = deriveSourceCoverageDisplayState(coverage);
  const b = deriveSourceCoverageDisplayState(coverage);
  assert.deepEqual(a, b);
});

function displayCounts(total: number, covered: number) {
  return deriveSourceCoverageDisplayState({
    ...computeSourceCoverage([], []), totalChunkCount: total, coveredChunkCount: covered,
  });
}

test("presentation: 8/193 shows 4% and 185 remaining, independent of stored ratio/count hints", () => {
  assert.deepEqual(displayCounts(193, 8), {
    kind: "partial", totalChunkCount: 193, coveredChunkCount: 8, uncoveredChunkCount: 185, percent: 4,
  });
});

test("presentation: partial coverage never rounds to 100%, including 999/1000", () => {
  for (const [total, covered, percent] of [[193, 192, 99], [1000, 999, 99], [1000, 1, 0]]) {
    const state = displayCounts(total, covered);
    assert.equal(state.kind, "partial");
    assert.equal(state.percent, percent);
    assert.equal(state.uncoveredChunkCount, total - covered);
  }
});

test("presentation: only full nonempty coverage displays 100%", () => {
  assert.deepEqual(displayCounts(193, 193), {
    kind: "full", totalChunkCount: 193, coveredChunkCount: 193, uncoveredChunkCount: 0, percent: 100,
  });
  assert.deepEqual(displayCounts(0, 0), { kind: "no-content" });
});

test("presentation: malformed totals never produce a percentage", () => {
  for (const total of [-1, NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(displayCounts(total, 1), { kind: "no-content" });
  }
});

test("presentation: covered counts are bounded without mutating coverage math", () => {
  for (const covered of [-1, NaN, Infinity, 1.5]) {
    assert.deepEqual(displayCounts(2, covered), {
      kind: "no-cards", totalChunkCount: 2, coveredChunkCount: 0, uncoveredChunkCount: 2, percent: 0,
    });
  }
  assert.deepEqual(displayCounts(2, 3), {
    kind: "full", totalChunkCount: 2, coveredChunkCount: 2, uncoveredChunkCount: 0, percent: 100,
  });
  const coverage = computeSourceCoverage(["a", "b"], ["a"]);
  const original = structuredClone(coverage);
  deriveSourceCoverageDisplayState(coverage);
  assert.deepEqual(coverage, original);
});

test("coverage copy: singular/plural available, remaining, covered and full states", () => {
  assert.equal(pluralize("en", "sourceCoverage.available", 1), "1 section available.");
  assert.equal(pluralize("en", "sourceCoverage.available", 193), "193 sections available.");
  assert.equal(pluralize("en", "sourceCoverage.remaining", 1), "1 section remaining");
  assert.equal(pluralize("en", "sourceCoverage.remaining", 185), "185 sections remaining");
  assert.equal(pluralize("en", "sourceCoverage.summary", 1, { covered: 0, total: 1 }), "0 of 1 section covered");
  assert.equal(pluralize("en", "sourceCoverage.summary", 193, { covered: 8, total: 193 }), "8 of 193 sections covered");
  assert.equal(pluralize("en", "sourceCoverage.fullyCovered", 1), "The only section is covered.");
  assert.equal(pluralize("en", "sourceCoverage.fullyCovered", 193), "All 193 sections are covered.");
});

test("coverage copy: Russian and Arabic select their distinct plural categories", () => {
  assert.equal(pluralize("ru", "sourceCoverage.remaining", 1), "Остался 1 раздел");
  assert.equal(pluralize("ru", "sourceCoverage.remaining", 2), "Осталось 2 раздела");
  assert.equal(pluralize("ru", "sourceCoverage.remaining", 11), "Осталось 11 разделов");
  assert.equal(pluralize("ar", "sourceCoverage.remaining", 1), "قسم واحد متبقٍ");
  assert.equal(pluralize("ar", "sourceCoverage.remaining", 2), "قسمان متبقيان");
  assert.equal(pluralize("ar", "sourceCoverage.remaining", 3), "3 أقسام متبقية");
});

test("coverage copy: all 13 locales resolve every presentation key without placeholders", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of ["heading", "loading", "noContent", "noCardsYet", "explanation", "unavailable", "percentLabel"] as const) {
      const rendered = translate(locale, `sourceCoverage.${key}`, { percent: 99 });
      assert.ok(rendered.length > 0 && !rendered.includes("sourceCoverage.") && !rendered.includes("{{"), `${locale}: ${key}`);
    }
    for (const count of [0, 1, 2, 3, 11, 21, 193]) {
      for (const key of ["summary", "fullyCovered", "available", "remaining"] as const) {
        const rendered = pluralize(locale, `sourceCoverage.${key}`, count, { total: count, covered: count });
        assert.ok(rendered.length > 0 && !rendered.includes("sourceCoverage.") && !rendered.includes("{{"), `${locale}: ${key}`);
      }
    }
  }
});
