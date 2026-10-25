import type { CardCountOption, GenerationOptions } from "./types";

// MVP option surface — deliberately small. A user picks a size/difficulty/style, never a prompt.
// See docs/ai-generation-foundation.md's "Initial generation options" section for the product
// reasoning behind keeping this short.
//
// Each preset is a RANGE, not a single number — `targetMinimum` is a genuine quality floor (the
// tier should normally satisfy it when the supplied material has enough distinct content),
// `target` is the ceiling shown to the user as "Up to N cards" and sent downstream as
// `requestedCardCount` (unchanged meaning/value from before this range concept existed). The
// lower bound is a target for the MODEL to aim for, never permission for the app itself to
// fabricate/duplicate cards to reach it — see docs/ai-generation-foundation.md's "Count contract
// and insufficient-distinct-content" section. The previous `min`/`max` fields on this type (5–10/
// 10–20/20–30) were dead code (grepped: never read anywhere) and, worse, allowed a resolved count
// ABOVE the UI's own advertised ceiling ("Up to 8/15/25 cards") — replaced outright rather than
// kept alongside the new, correct range.
export const CARD_COUNT_PRESETS: Record<CardCountOption, { targetMinimum: number; target: number }> = {
  small: { targetMinimum: 5, target: 8 },
  medium: { targetMinimum: 10, target: 15 },
  large: { targetMinimum: 18, target: 25 },
};

// Hard ceiling regardless of preset or an explicit numeric request — this is also the number
// responseValidation.ts uses to reject a response as structurally unsafe ("too-many-cards"), and
// what GENERATION_LIMITS.maxCardsPerRequest (limits.ts) exists to keep a request from ever
// requesting past in the first place.
export const MIN_CARDS_PER_DECK = 1;
export const ABSOLUTE_MAX_CARDS_PER_DECK = 40;

/**
 * Resolves a `GenerationOptions.cardCount` (a named preset or an explicit number) to the actual
 * target count a request will ask for — always clamped to `[MIN_CARDS_PER_DECK,
 * ABSOLUTE_MAX_CARDS_PER_DECK]` so a caller can never construct a request asking for an
 * unreasonable count, whether it came from a preset or a user-typed number. This is the CEILING
 * ("up to N") — see `resolveTargetMinimumCardCount` for the companion quality floor.
 */
export function resolveRequestedCardCount(cardCount: CardCountOption | number): number {
  const raw = typeof cardCount === "number" ? cardCount : CARD_COUNT_PRESETS[cardCount].target;
  return Math.max(MIN_CARDS_PER_DECK, Math.min(ABSOLUTE_MAX_CARDS_PER_DECK, Math.round(raw)));
}

/**
 * The quality-floor companion to `resolveRequestedCardCount` — the count a tier should normally
 * satisfy when the supplied material has enough distinct content (see `CARD_COUNT_PRESETS`).
 * For an explicit numeric override (no named tier, so no preset range exists), the minimum is the
 * exact requested number itself — a caller bypassing the presets gets no implicit slack; anything
 * less than what it asked for is a shortfall. Always clamped to be no greater than the resolved
 * ceiling, so a caller can never end up with an inverted (minimum > maximum) range.
 */
export function resolveTargetMinimumCardCount(cardCount: CardCountOption | number): number {
  const ceiling = resolveRequestedCardCount(cardCount);
  const raw = typeof cardCount === "number" ? ceiling : CARD_COUNT_PRESETS[cardCount].targetMinimum;
  return Math.max(MIN_CARDS_PER_DECK, Math.min(ceiling, Math.round(raw)));
}

export const DEFAULT_GENERATION_OPTIONS: GenerationOptions = {
  cardCount: "medium",
  difficulty: "balanced",
  cardStyle: "question-answer",
};
