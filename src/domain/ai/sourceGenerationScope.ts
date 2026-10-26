import type { NormalizedChunk } from "../normalization/types";
import type { SourceCoverage } from "../sourceCoverage";
import { DEFAULT_CONTEXT_CHAR_BUDGET } from "./contextPreparation";

// Source scope selection — lets the user choose WHAT PART of a Library source Generate Study
// Deck should draw from, instead of the app always picking an opaque bounded subset with no
// control. See docs/source-generation-scope.md for the full product/architecture writeup.
//
// Deliberately PURE — no storage, no normalization, no React Native import, same split as
// src/domain/sourceCoverage.ts / src/domain/ai/generationCoverage.ts. The async orchestration
// that loads coverage/normalizes a source lives in generateDeckFlow.ts instead.
//
// Scope selection and the existing bounded GenerationContext (contextPreparation.ts) are TWO
// DIFFERENT THINGS and must never be conflated:
//   - Scope selection (this file) decides the CANDIDATE chunk set — which chunks are even
//     eligible to be considered for this generation.
//   - GenerationContext (contextPreparation.ts, unchanged by this feature) then still applies the
//     existing safe per-request character budget on TOP of that candidate set, exactly as before.
// A scope whose candidates exceed one context budget is not an error by itself — it legitimately
// resolves to a partial-context generation, truthfully disclosed by the SAME
// fullSourceIncluded/excludedChunkCount machinery that already exists (aiService.ts's
// `reconcileFullSourceReporting`), with zero new plumbing needed on that side.

export type SourceGenerationScope =
  | { type: "automatic" }
  | { type: "entireSource" }
  | { type: "uncovered" }
  | { type: "pageRange"; startPage: number; endPage: number }
  | { type: "sectionRange"; startSection: number; endSection: number };

export type SourceGenerationScopeKind = SourceGenerationScope["type"];

export type SourceScopeResolutionErrorCode =
  // "Entire source" was selected but the full normalized source does not fit inside one
  // generation's context budget — never silently truncated and reported as "entire source".
  | "entire-source-too-large"
  // "Uncovered material" was selected but zero uncovered chunks exist (every chunk already has a
  // live card referencing it, or the source has no content at all). The options screen should
  // normally hide this choice before this is ever reachable — this is a defensive backstop.
  | "uncovered-unavailable"
  // A page range was selected but this source has no trustworthy page count to validate against
  // (should only be reachable for a non-PDF source or a PDF whose extraction never completed —
  // the options screen only offers this scope when a page count is already known).
  | "page-range-unavailable"
  // The requested range is reversed, out of bounds, zero/negative, or non-integer.
  | "invalid-range"
  // The range (or coverage subset) was itself valid, but resolves to zero actual chunks — e.g. a
  // page range that lands entirely on pages that produced no extractable text.
  | "empty-selection";

export type ResolvedSourceGenerationScope =
  // `chunkIds` omitted (undefined) means "no restriction" — every chunk in the normalized source
  // remains eligible, exactly like omitting `selectedChunkIds` from aiService.ts's
  // GenerateStudyDeckInput today. Automatic and a successfully-fitting Entire Source both resolve
  // this way; they differ only in the upfront feasibility check Entire Source performs.
  | { status: "ok"; chunkIds?: string[] }
  | { status: "error"; code: SourceScopeResolutionErrorCode };

function totalApproxChars(chunks: NormalizedChunk[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk.approxSize, 0);
}

/**
 * True exactly when `prepareGenerationContext` (contextPreparation.ts), run with the default
 * budget, would include every one of `chunks` with zero exclusions. Provably equivalent to
 * calling that function and checking `fullSourceIncluded` — without needing to call it or
 * fabricate a `NormalizedSourceContent` wrapper — because its selection loop is a single forward
 * pass with a monotonically non-decreasing running total and no backtracking: every chunk is
 * included iff the running total never exceeded the budget at any prefix, which (for a
 * non-negative sequence) holds for every prefix iff it holds for the final total. Used both for
 * "Entire source" eligibility and for warning the user when their own page/section range selects
 * more material than one generation can use.
 */
export function fitsContextBudget(chunks: NormalizedChunk[]): boolean {
  return chunks.length > 0 && totalApproxChars(chunks) <= DEFAULT_CONTEXT_CHAR_BUDGET;
}

/** "Section" = one normalized chunk, 1-based — the same vocabulary the existing coverage
 * disclosure already uses ("Using 19 of 193 source sections"), never exposed as a raw chunk id. */
export function getSectionCount(chunks: NormalizedChunk[]): number {
  return chunks.length;
}

function isValidRange(start: number, end: number, max: number): boolean {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start && end <= max && max > 0;
}

/**
 * The one pure resolution function every scope choice goes through. Deterministic, preserves the
 * chunks' own existing document order (never reorders or shuffles), and never invents a fallback
 * from one scope to another — every failure is an explicit, typed error rather than a silent
 * substitution. `chunks` must be the CURRENT normalized chunk list (callers re-normalize fresh at
 * generation time; see generateDeckFlow.ts) so stale ids can never leak into a request.
 */
export function resolveSourceGenerationScope(params: {
  chunks: NormalizedChunk[];
  scope: SourceGenerationScope;
  /** Only read for scope.type === "uncovered". Must have been computed against the same (or an
   * identically-normalized) chunk set as `chunks` — any chunk id it names that no longer exists
   * in `chunks` is safely ignored, never trusted blindly. */
  coverage?: SourceCoverage;
  /** Only read for scope.type === "pageRange" — NormalizedSourceContent.metadata.pageCount. */
  pageCount?: number;
}): ResolvedSourceGenerationScope {
  const { chunks, scope } = params;

  switch (scope.type) {
    case "automatic":
      return { status: "ok" };

    case "entireSource":
      if (!fitsContextBudget(chunks)) return { status: "error", code: "entire-source-too-large" };
      return { status: "ok" };

    case "uncovered": {
      const uncovered = new Set(params.coverage?.uncoveredChunkIds ?? []);
      // Filtering FROM `chunks` (never from `coverage.uncoveredChunkIds`) is what makes a stale
      // coverage id safe to ignore and what preserves `chunks`' own document order for free.
      const chunkIds = chunks.filter((chunk) => uncovered.has(chunk.id)).map((chunk) => chunk.id);
      if (chunkIds.length === 0) return { status: "error", code: "uncovered-unavailable" };
      return { status: "ok", chunkIds };
    }

    case "pageRange": {
      if (!params.pageCount || params.pageCount <= 0) return { status: "error", code: "page-range-unavailable" };
      if (!isValidRange(scope.startPage, scope.endPage, params.pageCount)) return { status: "error", code: "invalid-range" };
      const chunkIds = chunks
        .filter((chunk) => typeof chunk.provenance.page === "number" && chunk.provenance.page >= scope.startPage && chunk.provenance.page <= scope.endPage)
        .map((chunk) => chunk.id);
      if (chunkIds.length === 0) return { status: "error", code: "empty-selection" };
      return { status: "ok", chunkIds };
    }

    case "sectionRange": {
      const total = getSectionCount(chunks);
      if (!isValidRange(scope.startSection, scope.endSection, total)) return { status: "error", code: "invalid-range" };
      const chunkIds = chunks
        .filter((chunk) => chunk.index + 1 >= scope.startSection && chunk.index + 1 <= scope.endSection)
        .map((chunk) => chunk.id);
      if (chunkIds.length === 0) return { status: "error", code: "empty-selection" };
      return { status: "ok", chunkIds };
    }
  }
}
