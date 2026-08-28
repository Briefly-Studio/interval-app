import type { CardCountOption, CardStyleOption, DifficultyOption } from "./types";

// UI-facing presentation metadata for the generation options — the ordered lists and i18n label
// keys the options screen renders. The option VALUES themselves are the domain unions from
// types.ts (imported, never re-declared); this file only decides display order and which
// translation key labels each one, so the screen contains no hard-coded option strings.

export type GenerationOptionChoice<T extends string> = { value: T; labelKey: string; descriptionKey: string };

export const CARD_COUNT_CHOICES: GenerationOptionChoice<CardCountOption>[] = [
  { value: "small", labelKey: "generateDeck.options.cardCountSmall", descriptionKey: "generateDeck.options.cardCountSmallHint" },
  { value: "medium", labelKey: "generateDeck.options.cardCountMedium", descriptionKey: "generateDeck.options.cardCountMediumHint" },
  { value: "large", labelKey: "generateDeck.options.cardCountLarge", descriptionKey: "generateDeck.options.cardCountLargeHint" },
];

export const DIFFICULTY_CHOICES: GenerationOptionChoice<DifficultyOption>[] = [
  { value: "basic", labelKey: "generateDeck.options.difficultyBasic", descriptionKey: "generateDeck.options.difficultyBasicHint" },
  { value: "balanced", labelKey: "generateDeck.options.difficultyBalanced", descriptionKey: "generateDeck.options.difficultyBalancedHint" },
  { value: "advanced", labelKey: "generateDeck.options.difficultyAdvanced", descriptionKey: "generateDeck.options.difficultyAdvancedHint" },
];

export const CARD_STYLE_CHOICES: GenerationOptionChoice<CardStyleOption>[] = [
  { value: "question-answer", labelKey: "generateDeck.options.styleQa", descriptionKey: "generateDeck.options.styleQaHint" },
  { value: "concept-definition", labelKey: "generateDeck.options.styleConcept", descriptionKey: "generateDeck.options.styleConceptHint" },
];
