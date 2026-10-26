import type { SourceGenerationScopeKind } from "./sourceGenerationScope";

// UI-facing presentation metadata for source scope selection — same pattern as
// generationOptionsUi.ts's CARD_COUNT_CHOICES, except the choice LIST is dynamic (which scopes
// are even offered depends on this source's own coverage/size/format), so this is a function
// rather than a static constant. The screen contains no hard-coded scope copy strings.

export type SourceScopeChoice = { value: SourceGenerationScopeKind; labelKey: string; descriptionKey: string };

/**
 * Decides which "Generate from" choices to offer for one source, in display order. Pure —
 * callers pass in already-computed availability facts rather than this function reaching for
 * chunks/coverage itself:
 *   - "Uncovered material" only when there is at least one actual uncovered chunk (never shown
 *     and immediately erroring — see resolveSourceGenerationScope's "uncovered-unavailable").
 *   - "Entire source" only when it would truthfully fit one generation's context budget (never
 *     shown and then silently truncated).
 *   - "Page range" only for a source with a known, trustworthy, multi-page count (PDF).
 *   - "Section range" (the generic ordinal fallback) only for a non-PDF source with more than one
 *     normalized section — a single-section source has nothing to range over.
 * A source offering none of the last three still always offers "Automatic" — this list is never
 * empty for any source Generate Study Deck considers available at all.
 */
export function buildSourceScopeChoices(params: {
  totalSectionCount: number;
  /** Only ever defined for PDF sources — see NormalizedSourceContent.metadata.pageCount. */
  pageCount?: number;
  hasUncoveredMaterial: boolean;
  entireSourceFits: boolean;
}): SourceScopeChoice[] {
  const choices: SourceScopeChoice[] = [
    { value: "automatic", labelKey: "generateDeck.scope.automaticLabel", descriptionKey: "generateDeck.scope.automaticDescription" },
  ];

  if (params.hasUncoveredMaterial) {
    choices.push({ value: "uncovered", labelKey: "generateDeck.scope.uncoveredLabel", descriptionKey: "generateDeck.scope.uncoveredDescription" });
  }

  if (params.entireSourceFits) {
    choices.push({ value: "entireSource", labelKey: "generateDeck.scope.entireSourceLabel", descriptionKey: "generateDeck.scope.entireSourceDescription" });
  }

  if (typeof params.pageCount === "number" && params.pageCount > 1) {
    choices.push({ value: "pageRange", labelKey: "generateDeck.scope.pageRangeLabel", descriptionKey: "generateDeck.scope.pageRangeDescription" });
  } else if (params.totalSectionCount > 1) {
    choices.push({ value: "sectionRange", labelKey: "generateDeck.scope.sectionRangeLabel", descriptionKey: "generateDeck.scope.sectionRangeDescription" });
  }

  return choices;
}

// i18n key for the plain-language pre-generation summary of each NON-range scope (section 13 —
// "before Generate, show a concise truthful scope summary"). Page/section range summaries need
// their own start/end params and are built inline on the screen instead.
export const SCOPE_SUMMARY_KEY: Record<"automatic" | "entireSource" | "uncovered", string> = {
  automatic: "generateDeck.scope.summaryAutomatic",
  entireSource: "generateDeck.scope.summaryEntireSource",
  uncovered: "generateDeck.scope.summaryUncovered",
};
