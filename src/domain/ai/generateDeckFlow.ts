import type { LibrarySourceRecord } from "../../models/librarySource";
import type { WorkspaceScope } from "../../storage/workspaceScope";
import { normalizeSource } from "../normalization/normalizeSource";
import { generateStudyDeck } from "./aiService";
import { deriveGenerationAvailability, type GenerationAvailabilityState } from "./generationAvailability";
import {
  startGenerateDeckSession,
  type DraftProvenanceEntry,
} from "./generateDeckSession";
import { createMockProvider } from "./mockProvider";
import type { GenerationErrorCode, GenerationOptions } from "./types";

// Orchestrates one end-to-end generation attempt for the UX shell:
//   normalizeSource → availability guard → generateStudyDeck(mock provider) → populate the
//   in-memory draft session for the review screen.
//
// This is the only place the screens touch the AI service boundary. UI components never import
// mockProvider / aiService directly — they call runGenerateDeckFlow and then read the session.
// Swapping the mock for a real (backend-calling) provider later is a one-line change here.

export type GenerateDeckFlowOutcome =
  | { status: "ready" }
  | { status: "unavailable"; state: Exclude<GenerationAvailabilityState, "ready"> }
  | { status: "error"; code: GenerationErrorCode };

/**
 * Pre-flight readiness check for the options screen — normalizes the source and maps the result
 * onto the user-facing availability state, without calling any provider. `runGenerateDeckFlow`
 * re-runs normalization when the user actually generates; normalization is deterministic and
 * cheap for the TXT sources this batch supports, so the small duplication is deliberate rather
 * than threading a large NormalizedSourceContent through screen state.
 */
export async function checkGenerationAvailability(source: LibrarySourceRecord): Promise<{
  state: GenerationAvailabilityState;
  canGenerate: boolean;
}> {
  const normalization = await normalizeSource(source);
  return deriveGenerationAvailability(normalization);
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
  sourceScope: WorkspaceScope
): Promise<GenerateDeckFlowOutcome> {
  const normalization = await normalizeSource(source);
  const availability = deriveGenerationAvailability(normalization);
  if (!availability.canGenerate) {
    return { status: "unavailable", state: availability.state as Exclude<GenerationAvailabilityState, "ready"> };
  }

  const outcome = await generateStudyDeck(createMockProvider(), {
    sourceTitle: source.displayTitle,
    normalizedContent: normalization.content,
    options,
    language: source.sourceLanguage,
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
  "generation-timeout": "generateDeck.error.timeout",
  "provider-unavailable": "generateDeck.error.providerUnavailable",
  "malformed-model-output": "generateDeck.error.badOutput",
  "unsafe-output": "generateDeck.error.badOutput",
  "validation-failed": "generateDeck.error.badOutput",
};
