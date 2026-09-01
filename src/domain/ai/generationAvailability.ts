import type { ExtractionStatus, NormalizationResult } from "../normalization/types";

// Maps a normalization outcome onto the small, honest set of user-facing states the Generate
// Study Deck entry point and options screen branch on. Deliberately a thin, pure mapping over
// the already-computed ExtractionStatus (src/domain/normalization/normalizeSource.ts does the
// real sourceType → status work) — this module never re-derives "is this a PDF" etc., it only
// decides what to TELL the user and whether generation may proceed.
//
// The state set is intentionally 1:1 with ExtractionStatus. It is restated as its own type here
// so the UI layer never imports normalization internals directly, and so a future divergence
// (e.g. splitting "failed" into retryable vs not) has one obvious place to happen.

export type GenerationAvailabilityState =
  | "ready"
  | "empty"
  | "too-large"
  | "pending-extraction"
  | "unsupported"
  | "failed";

export type GenerationAvailability = {
  state: GenerationAvailabilityState;
  /** True only for "ready" — the single gate the options screen checks before allowing a
   * generation request. */
  canGenerate: boolean;
};

const STATUS_TO_STATE: Record<ExtractionStatus, GenerationAvailabilityState> = {
  ready: "ready",
  empty: "empty",
  "too-large": "too-large",
  "pending-extraction": "pending-extraction",
  unsupported: "unsupported",
  failed: "failed",
};

export function deriveGenerationAvailability(result: NormalizationResult): GenerationAvailability {
  const state = STATUS_TO_STATE[result.status] ?? "failed";
  return { state, canGenerate: state === "ready" };
}

// i18n key pairs for each non-ready state — the UI renders these through an EmptyState. Kept
// here (not inline in the screen) so the copy contract for every state is visible in one place
// and stays in sync with GenerationAvailabilityState.
export const AVAILABILITY_COPY_KEYS: Record<
  Exclude<GenerationAvailabilityState, "ready">,
  { titleKey: string; bodyKey: string; icon: string }
> = {
  empty: {
    titleKey: "generateDeck.unavailable.emptyTitle",
    bodyKey: "generateDeck.unavailable.emptyBody",
    icon: "document-outline",
  },
  "too-large": {
    titleKey: "generateDeck.unavailable.tooLargeTitle",
    bodyKey: "generateDeck.unavailable.tooLargeBody",
    icon: "albums-outline",
  },
  "pending-extraction": {
    titleKey: "generateDeck.unavailable.pendingTitle",
    bodyKey: "generateDeck.unavailable.pendingBody",
    icon: "hourglass-outline",
  },
  unsupported: {
    titleKey: "generateDeck.unavailable.unsupportedTitle",
    bodyKey: "generateDeck.unavailable.unsupportedBody",
    icon: "ban-outline",
  },
  failed: {
    titleKey: "generateDeck.unavailable.failedTitle",
    bodyKey: "generateDeck.unavailable.failedBody",
    icon: "alert-circle-outline",
  },
};
