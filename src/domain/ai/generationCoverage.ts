// Generic, format-agnostic UX-truthfulness layer for Generate Study Deck — decides what to tell
// the user about how much of a source will be (or was) used, and how to explain a resulting card
// count that falls short of what was requested. Nothing here branches on sourceType/PDF/TXT; a
// large TXT and a large PDF are described identically. See docs/generate-study-deck-ux.md's
// "Source coverage disclosure" section.
//
// This file performs NO independent source-size computation of its own — it only reshapes fields
// contextPreparation.ts (`GenerationContext.fullSourceIncluded` / `chunkCount` /
// `excludedChunkCount`) and aiService.ts's `GenerationMetadata` already compute, into the small
// shape the UI needs.

export type GenerationCoverage = {
  fullSourceIncluded: boolean;
  includedChunkCount: number;
  totalChunkCount: number;
};

/**
 * Builds a `GenerationCoverage` from the existing context-preparation fields — `totalChunkCount`
 * is simply `chunkCount + excludedChunkCount` (the chunks selected plus the chunks cut for
 * budget), never a separately measured source size.
 */
export function summarizeGenerationCoverage(context: {
  fullSourceIncluded: boolean;
  chunkCount: number;
  excludedChunkCount: number;
}): GenerationCoverage {
  return {
    fullSourceIncluded: context.fullSourceIncluded,
    includedChunkCount: context.chunkCount,
    totalChunkCount: context.chunkCount + context.excludedChunkCount,
  };
}

/**
 * True only when `coverage`'s numbers are internally consistent enough to show the user a
 * specific "using X of Y" figure. Guards the one edge case where they wouldn't be — a source that
 * somehow reports zero total chunks, or an included count outside [0, total] — rather than ever
 * inventing or guessing a number. When this returns false, the caller falls back to a plain,
 * non-numeric disclosure sentence (`generateDeck.coverage.partialSourceNote`).
 */
export function hasTrustworthyChunkScope(coverage: GenerationCoverage): boolean {
  return coverage.totalChunkCount > 0 && coverage.includedChunkCount >= 0 && coverage.includedChunkCount <= coverage.totalChunkCount;
}

// Which of the two honest "card count" hints the options screen should show. Both state the
// "maximum target, not a guarantee" truth (requirement: card counts are never promised exactly);
// "partial" additionally names the reason when the source itself is why fewer cards are likely.
export type CardCountHintKind = "full" | "partial";

export function deriveCardCountHintKind(fullSourceIncluded: boolean): CardCountHintKind {
  return fullSourceIncluded ? "full" : "partial";
}

// Which (if any) honest "fewer cards than requested" explanation applies. Never implies the
// model/provider failed, and never claims certainty about private model reasoning:
//   - "full-source": the whole source was used and the material simply didn't support more
//     useful cards — a legitimate, non-error outcome (see requirement 6).
//   - "partial-source": only part of the source was available, so incomplete coverage is an
//     additional, honest explanation for the shortfall.
// A zero-card result has its own distinct "no cards" messaging elsewhere and is deliberately
// "none" here, as is any result that met or exceeded the request.
export type FewerCardsExplanation = "none" | "full-source" | "partial-source";

export function deriveFewerCardsExplanation(params: {
  fullSourceIncluded: boolean;
  requestedCardCount: number;
  resultingCardCount: number;
}): FewerCardsExplanation {
  if (params.resultingCardCount <= 0) return "none";
  if (params.resultingCardCount >= params.requestedCardCount) return "none";
  return params.fullSourceIncluded ? "full-source" : "partial-source";
}
