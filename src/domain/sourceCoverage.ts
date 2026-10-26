import type { GeneratedCardProvenance } from "../models/generatedCardProvenance";

// Source Coverage — a truthful, read-only layer answering "which of this source's normalized
// chunks already have at least one LIVE saved study card referencing them?" See
// docs/source-coverage.md for the full product/architecture writeup, including exactly what
// counts and what doesn't. This is NOT generation-time budget coverage (see
// src/domain/ai/generationCoverage.ts, a different concept: "how much of the source fit in one
// generation's context window"). This module answers a persistent, after-the-fact question.
//
// Deliberately PURE — no storage, no normalization, no React Native import, directly analogous
// to src/domain/ai/aiConsent.ts's own pure/impure split. This is what lets
// src/domain/sourceCoverage.test.ts run under plain `node --test`: this file's only import is a
// type (erased at runtime), so nothing here ever pulls in AsyncStorage/expo-file-system
// transitively. The async orchestration that DOES need those lives in
// src/domain/sourceCoverageService.ts instead.

export type SourceCoverage = {
  totalChunkCount: number;
  coveredChunkCount: number;
  uncoveredChunkCount: number;
  /** null — never a fabricated 0% or 100% — when totalChunkCount is 0 (no normalizable content:
   * an unsupported format, a source still pending extraction, or one that failed to extract). */
  coverageRatio: number | null;
  /** In the current normalized chunk order. */
  coveredChunkIds: string[];
  uncoveredChunkIds: string[];
};

/**
 * Pure set math: which of the CURRENT source's chunk ids are referenced by at least one live
 * card. `liveCoveredChunkIds` may contain ids that no longer exist in `chunkIds` (stale
 * provenance — e.g. the source was re-normalized under a new NORMALIZATION_VERSION, or its
 * content changed) — those are silently ignored here, never counted and never thrown on.
 */
export function computeSourceCoverage(chunkIds: string[], liveCoveredChunkIds: Iterable<string>): SourceCoverage {
  const coveredSet = new Set(liveCoveredChunkIds);
  const coveredChunkIds: string[] = [];
  const uncoveredChunkIds: string[] = [];

  for (const id of chunkIds) {
    if (coveredSet.has(id)) coveredChunkIds.push(id);
    else uncoveredChunkIds.push(id);
  }

  const total = chunkIds.length;
  return {
    totalChunkCount: total,
    coveredChunkCount: coveredChunkIds.length,
    uncoveredChunkCount: uncoveredChunkIds.length,
    coverageRatio: total > 0 ? coveredChunkIds.length / total : null,
    coveredChunkIds,
    uncoveredChunkIds,
  };
}

/**
 * Reduces raw provenance entries + a live-card-id lookup down to the deduplicated set of chunk
 * ids actually covered. Pure — takes already-loaded data, no I/O:
 *   - a provenance entry whose cardId isn't in `liveCardIds` (deleted card, or a card from
 *     another source's provenance that slipped through an un-filtered list) contributes nothing.
 *   - duplicate chunk ids across one or many cards/decks collapse into one entry (Set).
 *   - manual/imported cards never have a provenance entry at all, so they're already excluded by
 *     construction — nothing here needs to special-case them.
 */
export function deriveCoveredChunkIds(provenance: GeneratedCardProvenance[], liveCardIds: ReadonlySet<string>): Set<string> {
  const covered = new Set<string>();
  for (const entry of provenance) {
    if (!liveCardIds.has(entry.cardId)) continue;
    for (const chunkId of entry.sourceChunkIds) covered.add(chunkId);
  }
  return covered;
}

type CoverageDisplayCounts = {
  coveredChunkCount: number;
  totalChunkCount: number;
  uncoveredChunkCount: number;
  percent: number;
};

export type SourceCoverageDisplayState =
  | { kind: "no-content" }
  | (CoverageDisplayCounts & { kind: "no-cards" | "full" | "partial" });

/** Presentation only: the underlying coverage sets/ratio are never changed. Counts are bounded
 * defensively so malformed input cannot show negative remaining sections or invalid progress.
 * Whole percentages use nearest-integer rounding, capped at 99 for partial coverage; only an
 * actually complete, nonempty source displays 100. See docs/source-coverage.md. */
export function deriveSourceCoverageDisplayState(coverage: SourceCoverage): SourceCoverageDisplayState {
  const total = Number.isSafeInteger(coverage.totalChunkCount) ? Math.max(0, coverage.totalChunkCount) : 0;
  if (total === 0) return { kind: "no-content" };
  const covered = Number.isSafeInteger(coverage.coveredChunkCount)
    ? Math.min(total, Math.max(0, coverage.coveredChunkCount))
    : 0;
  return {
    kind: covered === 0 ? "no-cards" : covered === total ? "full" : "partial",
    coveredChunkCount: covered,
    totalChunkCount: total,
    uncoveredChunkCount: total - covered,
    percent: covered === total ? 100 : Math.min(99, Math.round((covered / total) * 100)),
  };
}
