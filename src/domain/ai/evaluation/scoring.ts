import { normalizeForDuplicateCheck } from "../responseValidation";
import type { GeneratedCardDraft } from "../types";
import type { CountCheckStatus, EvaluationFixture, GenerationEvaluationResult } from "./types";

// Pure scoring functions — every metric here is either a deterministic structural check
// (grounding/provenance/exact-duplicates — should always pass given responseValidation.ts's own
// guarantees, so these are confirmatory invariants, not new rules) or a simple, honestly-labeled
// keyword/substring match (expected/forbidden concepts). See docs/ai-evaluation.md's "Objective
// metrics" section for why this harness deliberately does NOT attempt a numeric "pedagogical
// quality" score, fuzzy/semantic concept matching, or automated difficulty grading — none of
// those have a reliable, honest method available, so none are faked here. Difficulty comparison
// and genuine quality judgment are explicitly left to the human-review rubric
// (docs/ai-evaluation.md's "Human review" section), never approximated numerically.

/**
 * The authoritative count-check classification for one evaluation result — mirrors
 * responseValidation.ts's own `deriveGenerationStatus` reasoning but at the EVALUATION level,
 * cross-checking the draft's own authoritative `generationStatus` against the raw count rather
 * than trusting either number alone. ANY honest shortfall (count below target AND the
 * authoritative status correctly says so) is "valid-insufficiency" — never flagged as a
 * failure, REGARDLESS of whether the fixture happens to be `designedForInsufficiency` — see the
 * mission's own framing: a below-target result is only ever a problem when it's UNEXPLAINED
 * (status claims "complete" anyway) or INVERTED (status claims incomplete despite meeting the
 * target). `EvaluationFixture.designedForInsufficiency` is reporting/display context only (a
 * fixture a human reading results should expect to often fall short), never a scoring input —
 * note there is no parameter for it here; an earlier draft of this function had one, but by the
 * time code reaches the final branch below, `generationStatusIsComplete` is PROVABLY already
 * false (the two branches above it already exhaust every case where it's true), so the flag
 * could never actually change the result — removed rather than kept as dead/misleading code.
 */
export function deriveCountCheckStatus(params: {
  generatedCount: number;
  targetMinimum: number;
  requestedMaximum: number;
  generationStatusIsComplete: boolean;
}): CountCheckStatus {
  const { generatedCount, targetMinimum, requestedMaximum, generationStatusIsComplete } = params;
  if (generatedCount > requestedMaximum) return "exceeded-maximum";
  const metTarget = generatedCount >= targetMinimum;
  if (metTarget && !generationStatusIsComplete) return "insufficiency-despite-target-met";
  if (!metTarget && generationStatusIsComplete) return "unexplained-under-target";
  if (metTarget) return "within-range";
  return "valid-insufficiency";
}

export function countCheckPassed(status: CountCheckStatus): boolean {
  return status === "within-range" || status === "valid-insufficiency";
}

/** Fraction of cards whose EVERY `sourceChunkIds` entry is in `allowedChunkIds` — 1 for an empty
 * card list (vacuously true; the caller separately flags zero cards as its own failure mode). */
export function computeGroundingScore(cards: GeneratedCardDraft[], allowedChunkIds: ReadonlySet<string>): number {
  if (cards.length === 0) return 1;
  const validCount = cards.filter((card) => card.sourceChunkIds.every((id) => allowedChunkIds.has(id))).length;
  return validCount / cards.length;
}

export function computeProvenanceValidity(cards: GeneratedCardDraft[], allowedChunkIds: ReadonlySet<string>): boolean {
  if (cards.length === 0) return false;
  return cards.every((card) => card.sourceChunkIds.length > 0 && card.sourceChunkIds.every((id) => allowedChunkIds.has(id)));
}

/** Case-insensitive substring match against each card's front+back — deliberately NOT semantic/
 * NLP matching (see this file's header comment). Returns undefined when `expectedConcepts` is
 * undefined/empty, never a fabricated 0 or 1. */
export function computeExpectedConceptCoverage(cards: GeneratedCardDraft[], expectedConcepts: EvaluationFixture["expectedConcepts"]): number | undefined {
  if (!expectedConcepts || expectedConcepts.length === 0) return undefined;
  const haystack = cards.map((card) => `${card.front}\n${card.back}`.toLowerCase());
  const matched = expectedConcepts.filter((concept) => haystack.some((text) => text.includes(concept.toLowerCase())));
  return matched.length / expectedConcepts.length;
}

export function computeUnsupportedClaimCount(cards: GeneratedCardDraft[], forbiddenConcepts: EvaluationFixture["forbiddenConcepts"]): number | undefined {
  if (!forbiddenConcepts || forbiddenConcepts.length === 0) return undefined;
  const haystack = cards.map((card) => `${card.front}\n${card.back}`.toLowerCase());
  return haystack.filter((text) => forbiddenConcepts.some((concept) => text.includes(concept.toLowerCase()))).length;
}

/** Exact-duplicate pair count in the FINAL card list — should always be 0 (see this file's own
 * header comment); a confirmatory invariant, not a new rule. O(n^2) is fine at this harness's
 * scale (at most ABSOLUTE_MAX_CARDS_PER_DECK = 40 cards per result). */
export function computeExactDuplicateCount(cards: GeneratedCardDraft[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const card of cards) {
    const key = normalizeForDuplicateCheck(card.front, card.back);
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return duplicates;
}

/** Convenience: builds the 6 score-ish fields of a GenerationEvaluationResult that only depend
 * on the final card list + fixture + allowed chunk set — shared by both the bounded and
 * multi-batch result builders in runner.ts, so the two never compute these differently. */
export function scoreCards(
  cards: GeneratedCardDraft[],
  fixture: EvaluationFixture,
  allowedChunkIds: ReadonlySet<string>
): Pick<GenerationEvaluationResult, "groundingScore" | "provenanceValidity" | "expectedConceptCoverage" | "exactDuplicateCount" | "unsupportedClaimCount"> {
  return {
    groundingScore: computeGroundingScore(cards, allowedChunkIds),
    provenanceValidity: computeProvenanceValidity(cards, allowedChunkIds),
    expectedConceptCoverage: computeExpectedConceptCoverage(cards, fixture.expectedConcepts),
    exactDuplicateCount: computeExactDuplicateCount(cards),
    unsupportedClaimCount: computeUnsupportedClaimCount(cards, fixture.forbiddenConcepts),
  };
}
