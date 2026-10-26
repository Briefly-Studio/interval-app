import type { LibrarySourceRecord } from "../../models/librarySource";
import { loadSourceCoverage } from "../sourceCoverageService";
import type { WorkspaceScope } from "../../storage/workspaceScope";
import type { NormalizedChunk } from "../normalization/types";
import { normalizeSource } from "../normalization/normalizeSource";
import { generateStudyDeck } from "./aiService";
import { prepareGenerationContext } from "./contextPreparation";
import { deriveGenerationAvailability, type GenerationAvailabilityState } from "./generationAvailability";
import { type GenerationCoverage, summarizeGenerationCoverage } from "./generationCoverage";
import {
  startGenerateDeckSession,
  type DraftProvenanceEntry,
} from "./generateDeckSession";
import { selectModelProvider } from "./providerSelection";
import { resolveSourceGenerationScope, type SourceGenerationScope, type SourceScopeResolutionErrorCode } from "./sourceGenerationScope";
import type { GenerationErrorCode, GenerationOptions } from "./types";

// Orchestrates one end-to-end generation attempt for the UX shell:
//   normalizeSource → availability guard → generateStudyDeck(selected provider) → populate the
//   in-memory draft session for the review screen.
//
// This is the only place the screens touch the AI service boundary. UI components never import
// mockProvider / backendProvider / aiService directly — they call runGenerateDeckFlow and then
// read the session. Which provider actually runs is decided entirely by
// providerSelection.ts's selectModelProvider() — never hardcoded here.

export type GenerateDeckFlowOutcome =
  | { status: "ready" }
  | { status: "unavailable"; state: Exclude<GenerationAvailabilityState, "ready"> }
  | { status: "error"; code: GenerationErrorCode }
  // Scope resolution failed BEFORE any provider was ever called — distinct from GenerationError,
  // which only ever covers provider/validation failures. The options screen's own inline
  // validation (built from the same resolveSourceGenerationScope call) should normally prevent
  // this from ever being reached; this is a defensive backstop for source content changing
  // between screen-load and the Generate tap.
  | { status: "scope-error"; code: SourceScopeResolutionErrorCode };

/**
 * Pre-flight readiness check for the options screen — normalizes the source and maps the result
 * onto the user-facing availability state, without calling any provider. `runGenerateDeckFlow`
 * re-runs normalization when the user actually generates; normalization is deterministic and
 * cheap for the TXT sources this batch supports, so the small duplication is deliberate rather
 * than threading a large NormalizedSourceContent through screen state.
 *
 * `coverage` (only present when `canGenerate`) runs the SAME `prepareGenerationContext` call
 * `runGenerateDeckFlow`/`generateStudyDeck` will use for the actual generation, with the same
 * default budget — it is not a second, independent size computation, and it does not depend on
 * `options` (card count/difficulty/style never affect context selection). This lets the options
 * screen disclose up front whether the source will fit before the user taps Generate.
 *
 * `scopeChunks`/`pageCount` (also only present when `canGenerate`) are the raw ingredients the
 * options screen needs to offer/validate a source scope choice (Automatic/Entire source/
 * Uncovered/Page range/Section range) — see sourceGenerationScope.ts. Exposing the already-
 * computed chunk list here is strictly cheaper than having the screen normalize a second time.
 */
export async function checkGenerationAvailability(source: LibrarySourceRecord): Promise<{
  state: GenerationAvailabilityState;
  canGenerate: boolean;
  coverage: GenerationCoverage | null;
  scopeChunks: NormalizedChunk[] | null;
  pageCount?: number;
}> {
  const normalization = await normalizeSource(source);
  const availability = deriveGenerationAvailability(normalization);
  if (!availability.canGenerate) {
    return { ...availability, coverage: null, scopeChunks: null };
  }
  const context = prepareGenerationContext(normalization.content);
  return {
    ...availability,
    coverage: summarizeGenerationCoverage(context),
    scopeChunks: normalization.content.chunks,
    pageCount: normalization.content.metadata.pageCount,
  };
}

function buildProvenanceMap(chunks: { id: string; provenance: DraftProvenanceEntry }[]): Record<string, DraftProvenanceEntry> {
  const map: Record<string, DraftProvenanceEntry> = {};
  for (const chunk of chunks) {
    const { lineRange, page, heading } = chunk.provenance;
    // Only record entries that carry something worth citing — omit rather than store an empty
    // object, so the review screen's "does this card have provenance" check stays simple.
    if (lineRange || typeof page === "number" || heading) {
      map[chunk.id] = { lineRange, page, heading };
    }
  }
  return map;
}

export async function runGenerateDeckFlow(
  source: LibrarySourceRecord,
  options: GenerationOptions,
  /** The active workspace scope at generation time — bound onto the draft session and used as the
   * sole source of truth at save time (audit CRITICAL-1). */
  sourceScope: WorkspaceScope,
  /** Which part of the source to draw from — defaults to Automatic (today's unchanged behavior)
   * when omitted, so this stays source-compatible with any other future caller. */
  scope: SourceGenerationScope = { type: "automatic" }
): Promise<GenerateDeckFlowOutcome> {
  const normalization = await normalizeSource(source);
  const availability = deriveGenerationAvailability(normalization);
  if (!availability.canGenerate) {
    return { status: "unavailable", state: availability.state as Exclude<GenerationAvailabilityState, "ready"> };
  }

  // Coverage is only ever needed for the "uncovered" scope — loaded fresh here (never trusting
  // whatever the options screen computed earlier) so the resolver always sees the SAME chunk set
  // it's about to restrict, exactly like `normalization` itself being re-derived fresh above.
  const coverage = scope.type === "uncovered" ? await loadSourceCoverage(sourceScope, source) : undefined;

  const resolvedScope = resolveSourceGenerationScope({
    chunks: normalization.content.chunks,
    scope,
    coverage,
    pageCount: normalization.content.metadata.pageCount,
  });
  if (resolvedScope.status === "error") {
    return { status: "scope-error", code: resolvedScope.code };
  }

  const outcome = await generateStudyDeck(selectModelProvider(), {
    sourceTitle: source.displayTitle,
    normalizedContent: normalization.content,
    options,
    language: source.sourceLanguage,
    selectedChunkIds: resolvedScope.chunkIds,
  });

  if (outcome.status === "error") {
    return { status: "error", code: outcome.error.code };
  }

  startGenerateDeckSession({
    sourceId: source.id,
    sourceScope,
    sourceTitle: source.displayTitle,
    draft: outcome.draft,
    provenanceByChunkId: buildProvenanceMap(normalization.content.chunks),
    options,
    coverage: summarizeGenerationCoverage({
      fullSourceIncluded: outcome.draft.generation.fullSourceIncluded,
      chunkCount: outcome.draft.generation.selectedChunkIds.length,
      excludedChunkCount: outcome.draft.generation.excludedChunkCount,
    }),
  });

  return { status: "ready" };
}

// GenerationErrorCode → i18n key for a friendly, non-technical message. Internal codes are never
// shown; this table is the single translation point. Grouped so a reviewer can see every code is
// handled.
export const GENERATION_ERROR_COPY_KEYS: Record<GenerationErrorCode, string> = {
  "normalization-not-ready": "generateDeck.error.notReady",
  "source-empty": "generateDeck.error.empty",
  "source-too-large": "generateDeck.error.tooLarge",
  "unsupported-source": "generateDeck.error.unsupported",
  "context-too-large": "generateDeck.error.tooLarge",
  "rate-limited": "generateDeck.error.rateLimited",
  "daily-limit-reached": "generateDeck.error.dailyLimitReached",
  "generation-in-progress": "generateDeck.error.generationInProgress",
  "generation-timeout": "generateDeck.error.timeout",
  "provider-unavailable": "generateDeck.error.providerUnavailable",
  "malformed-model-output": "generateDeck.error.badOutput",
  "unsafe-output": "generateDeck.error.badOutput",
  "validation-failed": "generateDeck.error.badOutput",
};

// Same purpose as GENERATION_ERROR_COPY_KEYS above, for source-scope resolution failures — kept
// as its own table since SourceScopeResolutionErrorCode is a disjoint error family (resolved
// before any provider is ever called; see sourceGenerationScope.ts).
export const SOURCE_SCOPE_ERROR_COPY_KEYS: Record<SourceScopeResolutionErrorCode, string> = {
  "entire-source-too-large": "generateDeck.scope.error.entireSourceTooLarge",
  "uncovered-unavailable": "generateDeck.scope.error.uncoveredUnavailable",
  "page-range-unavailable": "generateDeck.scope.error.pageRangeUnavailable",
  "invalid-range": "generateDeck.scope.error.invalidRange",
  "empty-selection": "generateDeck.scope.error.emptySelection",
};
