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

export type SourceCoverageDisplayState =
  | { kind: "no-content" }
  | { kind: "no-cards"; totalChunkCount: number }
  | { kind: "full"; totalChunkCount: number }
  | { kind: "partial"; coveredChunkCount: number; totalChunkCount: number; percent: number };

/** Picks which of the four honest copy states the UI should show — see docs/source-coverage.md's
 * "What the UI says" section for the exact wording and why each threshold is handled distinctly
 * (never a fabricated percentage, never conflating "no content" with "no cards yet"). */
export function deriveSourceCoverageDisplayState(coverage: SourceCoverage): SourceCoverageDisplayState {
  if (coverage.totalChunkCount === 0) return { kind: "no-content" };
  if (coverage.coveredChunkCount === 0) return { kind: "no-cards", totalChunkCount: coverage.totalChunkCount };
  if (coverage.coveredChunkCount === coverage.totalChunkCount) return { kind: "full", totalChunkCount: coverage.totalChunkCount };
  return {
    kind: "partial",
    coveredChunkCount: coverage.coveredChunkCount,
    totalChunkCount: coverage.totalChunkCount,
    percent: Math.round((coverage.coveredChunkCount / coverage.totalChunkCount) * 100),
  };
}
