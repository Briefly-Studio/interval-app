import type { NormalizedChunk, NormalizedSourceContent } from "../normalization/types";
import type { SourceCoverage } from "../sourceCoverage";
import { resolveStructureNodeChunks, type SourceStructure } from "../sourceStructure";
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
  | { type: "sectionRange"; startSection: number; endSection: number }
  // A real structural region — a DOCX heading section or an XLSX worksheet — never a heuristic
  // PDF/TXT chapter (see docs/source-generation-scope.md's "Structure breadcrumbs" section and
  // src/domain/sourceStructure.ts's own "no heuristic inference" principle). `structureSnapshot`
  // is the SourceStructure the user actually picked `nodeId` from (captured once by the options
  // screen from checkGenerationAvailability, carried unchanged ever since) — never recomputed by
  // this file — so resolution below can tell "this node no longer exists/changed since selection"
  // apart from "this node currently has no content," exactly like every other scope variant
  // carries its own user-selected values (startPage/endPage, startSection/endSection) inline.
  | { type: "structureNode"; nodeId: string; structureSnapshot: SourceStructure };

export type SourceGenerationScopeKind = SourceGenerationScope["type"];

export type SourceScopeResolutionErrorCode =
  // "Entire source" was selected but the source has zero chunks to generate from. (A source
  // too large to even PLAN into batches is a separate, later failure — see batchPlanning.ts's
  // "plan-too-large" — surfaced by the caller after this function returns "ok", never here:
  // scope resolution only ever decides WHICH chunks are eligible, never whether they're
  // processable in one or many requests.)
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
  | "empty-selection"
  // A structureNode scope was selected but the source changed (different normalization, or the
  // referenced node's own derived shape no longer matches `structureSnapshot`) since the user
  // picked it — mirrors resolveStructureNodeChunks's "stale-structure". Distinct from
  // "structure-node-not-found" so the UI can say "this document changed" rather than "this
  // section is gone" when it genuinely knows which happened.
  | "structure-node-stale"
  // A structureNode scope referenced a nodeId that does not exist in `structureSnapshot` itself,
  // or (the defensive-backstop case) no snapshot/content was supplied at all — mirrors
  // resolveStructureNodeChunks's "node-not-found". The options screen's own picker should never
  // let this happen in practice; this is a backstop, same posture as every other scope's own
  // "-unavailable" codes above.
  | "structure-node-not-found"
  // The referenced node resolves cleanly but currently has zero chunks — in practice only ever
  // reachable for an empty worksheet (a DOCX heading's own interval always includes at least its
  // own heading-text chunk, so a "body-less" heading never actually hits this) — mirrors
  // resolveStructureNodeChunks's "empty-node".
  | "structure-node-empty";

export type ResolvedSourceGenerationScope =
  // `chunkIds` omitted (undefined) means "no restriction" — every chunk in the normalized source
  // remains eligible, exactly like omitting `selectedChunkIds` from aiService.ts's
  // GenerateStudyDeckInput today. Automatic and a successfully-fitting Entire Source both resolve
  // this way; they differ only in the upfront feasibility check Entire Source performs.
  // `sharedWithOtherNodes` is only ever set (and only ever true) for a structureNode scope whose
  // resolved chunks also belong to another node — the known XLSX "a chunk can span worksheet
  // boundaries" limitation (sourceStructure.ts) — surfaced here rather than recomputed by a
  // caller, since resolveStructureNodeChunks already knows it for free.
  | { status: "ok"; chunkIds?: string[]; sharedWithOtherNodes?: boolean }
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
  /** Only read for scope.type === "structureNode". Must be the CURRENT normalized content for
   * this same source (re-normalized fresh at generation time, same convention as `chunks` —
   * see generateDeckFlow.ts). Never the stale structureSnapshot itself: resolveStructureNodeChunks
   * (sourceStructure.ts) re-derives a fresh SourceStructure from this and does its own
   * comparison against `scope.structureSnapshot` — not duplicated here. */
  normalizedContent?: NormalizedSourceContent;
}): ResolvedSourceGenerationScope {
  const { chunks, scope } = params;

  switch (scope.type) {
    case "automatic":
      return { status: "ok" };

    case "entireSource":
      // Explicit chunk ids (never the bare "no restriction" `{status:"ok"}` automatic uses) —
      // this is what lets the caller (generateDeckFlow.ts) tell "automatic, single bounded call,
      // may legitimately leave material out" apart from "entire source, every chunk must be
      // considered, batching into as many bounded calls as that takes." Multi-batch generation
      // (see batchPlanning.ts/multiBatchGeneration.ts) is what actually makes good on this scope's
      // own promise for a source larger than one context budget — this function's only job is
      // deciding WHICH chunks are eligible, never whether a single request or several will be
      // needed to process them.
      if (chunks.length === 0) return { status: "error", code: "entire-source-too-large" };
      return { status: "ok", chunkIds: chunks.map((chunk) => chunk.id) };

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

    case "structureNode": {
      // Missing prerequisite content is the same defensive-backstop posture every other scope's
      // own "-unavailable" case uses — the options screen's live structure picker should never
      // reach this in practice.
      if (!params.normalizedContent) return { status: "error", code: "structure-node-not-found" };
      const resolved = resolveStructureNodeChunks(params.normalizedContent, scope.structureSnapshot, scope.nodeId);
      if (resolved.status === "error") {
        const code: SourceScopeResolutionErrorCode =
          resolved.code === "stale-structure" ? "structure-node-stale"
          : resolved.code === "node-not-found" ? "structure-node-not-found"
          : "structure-node-empty";
        return { status: "error", code };
      }
      return { status: "ok", chunkIds: resolved.chunkIds, sharedWithOtherNodes: resolved.sharedWithOtherNodes };
    }
  }
}
