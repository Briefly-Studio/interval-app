import type { CardCountOption, GenerationOptions } from "./types";

// MVP option surface — deliberately small. A user picks a size/difficulty/style, never a prompt.
// See docs/ai-generation-foundation.md's "Initial generation options" section for the product
// reasoning behind keeping this short.

export const CARD_COUNT_PRESETS: Record<CardCountOption, { min: number; max: number; target: number }> = {
  small: { min: 5, max: 10, target: 8 },
  medium: { min: 10, max: 20, target: 15 },
  large: { min: 20, max: 30, target: 25 },
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
 * unreasonable count, whether it came from a preset or a user-typed number.
 */
export function resolveRequestedCardCount(cardCount: CardCountOption | number): number {
  const raw = typeof cardCount === "number" ? cardCount : CARD_COUNT_PRESETS[cardCount].target;
  return Math.max(MIN_CARDS_PER_DECK, Math.min(ABSOLUTE_MAX_CARDS_PER_DECK, Math.round(raw)));
}

export const DEFAULT_GENERATION_OPTIONS: GenerationOptions = {
  cardCount: "medium",
  difficulty: "balanced",
  cardStyle: "question-answer",
};
