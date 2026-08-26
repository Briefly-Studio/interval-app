import type { NormalizedChunk } from "../normalization/types";

// AI Generation Foundation — the contract layer for the first AI product feature
// (Library Source → Generate → Study Deck → review → save). See
// docs/ai-generation-foundation.md for the full architecture record.
//
// NOTHING in this file (or anything else in src/domain/ai/) names, selects, or imports an AI
// provider SDK. Every type here is provider-neutral by construction — a future OpenAI/Anthropic/
// Bedrock/Gemini adapter satisfies `ModelProvider` (see aiService.ts) without any of these types
// changing shape.

// Bumped only when the request/response SCHEMA or validation rules change in a way that would
// make an old client/backend pairing incompatible — never for a prompt wording change or a
// provider swap (those live entirely behind ModelProvider, see aiService.ts). Distinct from
// NORMALIZATION_VERSION (src/domain/normalization/types.ts) — normalization and generation evolve
// independently.
export const GENERATION_CONTRACT_VERSION = 1;

// ---- Generation options (the ONLY choices a user makes — no prompt engineering exposed) ----

export type CardCountOption = "small" | "medium" | "large";
export type DifficultyOption = "basic" | "balanced" | "advanced";
export type CardStyleOption = "question-answer" | "concept-definition";

export type GenerationOptions = {
  /** A named preset OR an explicit bounded number — see generationOptions.ts's
   * `resolveRequestedCardCount` for how either resolves to an actual target count. */
  cardCount: CardCountOption | number;
  difficulty: DifficultyOption;
  cardStyle: CardStyleOption;
};

// ---- Generate Study Deck request (safe to log in full — never carries chunk TEXT) ----

export type GenerateStudyDeckRequest = {
  sourceId: string;
  sourceTitle: string;
  normalizationVersion: number;
  generationContractVersion: number;
  /** Which normalized chunks were actually selected as context — ids only. The chunks'
   * actual text travels separately as `GenerationContext.chunks` (see contextPreparation.ts) so
   * this request record itself is always safe to log/store without exposing source content. */
  selectedChunkIds: string[];
  requestedCardCount: number;
  options: GenerationOptions;
  language?: string;
};

// ---- Context payload (the ONLY thing that ever carries source text across a device/backend
// boundary — see docs/ai-generation-foundation.md's Privacy section) ----

export type GenerationContext = {
  /** In deterministic order — see contextPreparation.ts. Complete chunks only; a chunk is never
   * split mid-text to fit a budget. */
  chunks: NormalizedChunk[];
  totalChars: number;
  chunkCount: number;
  /** True only when EVERY chunk of the normalized source was included — false the moment even one
   * chunk had to be excluded for budget reasons. Never left ambiguous: a partial-context
   * generation must never be presented as if the full source was used. */
  fullSourceIncluded: boolean;
  excludedChunkIds: string[];
  excludedChunkCount: number;
};

// ---- Structured model response schema (what a provider adapter must produce, after doing its
// own provider-specific parsing — this shape is the ONLY thing responseValidation.ts trusts) ----

export type ModelGeneratedCard = {
  front: string;
  back: string;
  /** REQUIRED — every card must cite the normalized chunk(s) it was drawn from. Never optional:
   * a card with no provenance has no place in this contract (see responseValidation.ts). */
  sourceChunkIds: string[];
};

export type ModelGeneratedDeckResponse = {
  title: string;
  cards: ModelGeneratedCard[];
};

// ---- Validated draft output (never auto-saved — the user reviews before anything is committed
// to permanent deck storage) ----

export type GeneratedCardDraft = {
  /** Deterministic within a single validation pass (content-addressed over front/back/
   * sourceChunkIds/index) — see responseValidation.ts's `computeCardDraftId`. NOT a claim that
   * regenerating from the model would reproduce the same card; only that re-validating the exact
   * same raw response twice yields the exact same draft ids, which matters for tests and for a
   * future "diff this regeneration against the last one" feature. */
  id: string;
  front: string;
  back: string;
  sourceChunkIds: string[];
  /** Only ever set by a future provider adapter that receives a genuine model-reported confidence
   * value. Nothing in this batch (including the mock provider) ever invents one. */
  confidence?: number;
};

export type CardValidationIssueCode =
  | "empty-front"
  | "empty-back"
  | "front-too-long"
  | "back-too-long"
  | "missing-provenance"
  | "unknown-chunk-id"
  | "duplicate-card";

export type CardValidationIssue = { cardIndex: number; code: CardValidationIssueCode };

export type DeckValidationIssueCode = "malformed-response" | "invalid-title" | "no-valid-cards" | "too-many-cards";

export type DeckValidationIssue = { code: DeckValidationIssueCode; detail?: string };

export type GenerationMetadata = {
  generationContractVersion: number;
  normalizationVersion: number;
  sourceId: string;
  selectedChunkIds: string[];
  requestedCardCount: number;
  resultingCardCount: number;
  /** ISO 8601 — when validation produced this draft, not when the (as-yet-unimplemented)
   * production model call would have started. */
  generatedAt: string;
  /** Adapter identifier only (e.g. "mock-v1") — never a vendor name treated as a product
   * decision, never a credential, never a raw provider error string. */
  providerId: string;
  fullSourceIncluded: boolean;
  excludedChunkCount: number;
  /** Non-fatal issues found during validation (e.g. a duplicate card that was dropped) — recorded
   * for transparency/debugging, never hidden. Cards that caused these issues are NOT present in
   * `cards` below. */
  issues: CardValidationIssue[];
};

export type GeneratedDeckDraft = {
  title: string;
  cards: GeneratedCardDraft[];
  sourceId: string;
  generation: GenerationMetadata;
};

// ---- Errors (stable categories a client can branch on — never a raw provider error string) ----

export type GenerationErrorCode =
  | "normalization-not-ready"
  | "source-empty"
  | "source-too-large"
  | "unsupported-source"
  | "context-too-large"
  | "rate-limited"
  | "generation-timeout"
  | "provider-unavailable"
  | "malformed-model-output"
  | "unsafe-output"
  | "validation-failed";

export type GenerationError = {
  code: GenerationErrorCode;
  /** A short, generic, developer-facing message — never a raw provider error, stack trace, or
   * fragment of source/model content. */
  message: string;
  /** Present only for "validation-failed" — the specific rules that failed, for debugging. Never
   * includes card/source text, only issue codes/indices. */
  deckIssues?: DeckValidationIssue[];
  cardIssues?: CardValidationIssue[];
};

export type GenerateStudyDeckOutcome = { status: "ready"; draft: GeneratedDeckDraft } | { status: "error"; error: GenerationError };
