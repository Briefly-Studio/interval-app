import type { NormalizedSourceContent, ExtractionStatus } from "../normalization/types";
import { prepareGenerationContext } from "./contextPreparation";
import type { PrepareContextOptions } from "./contextPreparation";
import { validateGeneratedDeckResponse } from "./responseValidation";
import { resolveRequestedCardCount } from "./generationOptions";
import { GENERATION_CONTRACT_VERSION } from "./types";
import type {
  GenerateStudyDeckOutcome,
  GenerateStudyDeckRequest,
  GenerationContext,
  GenerationError,
  GenerationErrorCode,
  GenerationOptions,
} from "./types";

/**
 * `prepareGenerationContext` only knows about the candidate chunks it was handed — it has no way
 * to see chunks a caller already excluded via `selectedChunkIds` before context prep ever ran. So
 * its `fullSourceIncluded`/`excludedChunkIds`/`excludedChunkCount` are only correct relative to
 * that pre-filtered candidate set, not the original source. This reconciles them against the
 * FULL `normalizedContent` so "full source" reporting stays honest regardless of which layer did
 * the excluding — a caller-selected subset must never be reported as `fullSourceIncluded: true`
 * just because everything it asked for happened to fit the budget.
 */
function reconcileFullSourceReporting(normalizedContent: NormalizedSourceContent, context: GenerationContext): GenerationContext {
  const includedIds = new Set(context.chunks.map((chunk) => chunk.id));
  const excludedChunkIds = normalizedContent.chunks.filter((chunk) => !includedIds.has(chunk.id)).map((chunk) => chunk.id);
  return {
    ...context,
    fullSourceIncluded: excludedChunkIds.length === 0 && normalizedContent.chunks.length > 0,
    excludedChunkIds,
    excludedChunkCount: excludedChunkIds.length,
  };
}

// The one place a mobile-side (or future backend-side) caller drives the full
// Source -> Generate Study Deck pipeline: extraction-status guard -> context preparation ->
// provider call -> structured-response validation -> draft. Nothing outside this file (and
// responseValidation.ts, which it delegates to) is allowed to turn provider output into a
// GeneratedDeckDraft. See docs/ai-generation-foundation.md's "Data flow" section.

/**
 * What a provider adapter receives. `context` — not the full `NormalizedSourceContent` — is
 * deliberately the only source-bearing thing a provider ever sees: exactly the bounded,
 * budget-selected chunk set `prepareGenerationContext` already decided on, never the entire
 * source. `request` is always safe to log (see types.ts); it carries no chunk text itself.
 */
export type ModelProviderInput = {
  request: GenerateStudyDeckRequest;
  context: GenerationContext;
};

export type ModelProviderOutcome =
  | { status: "ok"; raw: unknown }
  | { status: "error"; error: { code: GenerationErrorCode; message: string } };

/**
 * The one seam a real provider (OpenAI/Anthropic/etc., always via a trusted backend — never
 * called directly from the mobile app with an embedded credential) implements. `raw` is
 * intentionally untyped — `validateGeneratedDeckResponse` is the only code allowed to give it
 * structure, so a provider can never bypass validation by claiming a stronger return type.
 */
export interface ModelProvider {
  id: string;
  generate(input: ModelProviderInput): Promise<ModelProviderOutcome>;
}

export type GenerateStudyDeckInput = {
  sourceTitle: string;
  normalizedContent: NormalizedSourceContent;
  options: GenerationOptions;
  language?: string;
  /** Restricts context preparation to this subset of chunk ids (e.g. a user-selected page range
   * in a future UI). When omitted, every chunk in `normalizedContent` is eligible. */
  selectedChunkIds?: string[];
  contextOptions?: PrepareContextOptions;
};

// No dedicated GenerationErrorCode exists for a genuine extraction FAILURE (as opposed to a
// format simply having no normalization path) — the mission-specified error-code list has no
// "extraction-failed" entry. "failed" is deliberately folded into "unsupported-source": either
// way there is no usable source content to generate from, and treating a failure as
// unsupported is the conservative choice (reject, never guess at partial content).
const EXTRACTION_STATUS_TO_ERROR: Partial<Record<ExtractionStatus, GenerationErrorCode>> = {
  empty: "source-empty",
  unsupported: "unsupported-source",
  failed: "unsupported-source",
  "pending-extraction": "normalization-not-ready",
  "too-large": "source-too-large",
};

const EXTRACTION_STATUS_MESSAGE: Partial<Record<ExtractionStatus, string>> = {
  empty: "This source has no extractable text to generate a deck from.",
  unsupported: "This source's format cannot be normalized into text yet.",
  failed: "This source could not be read for generation.",
  "pending-extraction": "This source hasn't finished processing yet — try again shortly.",
  "too-large": "This source is too large to generate a deck from.",
};

function selectChunks(content: NormalizedSourceContent, selectedChunkIds?: string[]): NormalizedSourceContent {
  if (!selectedChunkIds) return content;
  const allowed = new Set(selectedChunkIds);
  return { ...content, chunks: content.chunks.filter((chunk) => allowed.has(chunk.id)) };
}

function buildRequest(
  content: NormalizedSourceContent,
  input: GenerateStudyDeckInput,
  selectedChunkIds: string[]
): GenerateStudyDeckRequest {
  return {
    sourceId: content.sourceId,
    sourceTitle: input.sourceTitle,
    normalizationVersion: content.normalizationVersion,
    generationContractVersion: GENERATION_CONTRACT_VERSION,
    selectedChunkIds,
    requestedCardCount: resolveRequestedCardCount(input.options.cardCount),
    options: input.options,
    language: input.language,
  };
}

function errorOutcome(code: GenerationErrorCode, message: string): GenerateStudyDeckOutcome {
  const error: GenerationError = { code, message };
  return { status: "error", error };
}

/**
 * Orchestrates one generation attempt end to end. Pure aside from the injected `provider` — the
 * caller supplies the provider (mockProvider.ts today; a real backend-call adapter later) so this
 * function never itself decides which provider is active.
 */
export async function generateStudyDeck(
  provider: ModelProvider,
  input: GenerateStudyDeckInput
): Promise<GenerateStudyDeckOutcome> {
  const { normalizedContent } = input;

  const mappedErrorCode = EXTRACTION_STATUS_TO_ERROR[normalizedContent.extraction.status];
  if (mappedErrorCode) {
    return errorOutcome(mappedErrorCode, EXTRACTION_STATUS_MESSAGE[normalizedContent.extraction.status] ?? "This source is not ready for generation.");
  }
  // Only "ready" falls through — ExtractionStatus is exhaustively "ready" | every key above.

  const scoped = selectChunks(normalizedContent, input.selectedChunkIds);
  const preparedContext = prepareGenerationContext(scoped, input.contextOptions);

  if (preparedContext.chunkCount === 0) {
    return errorOutcome("source-empty", "No usable content was available to generate a deck from.");
  }

  const context = reconcileFullSourceReporting(normalizedContent, preparedContext);

  const request = buildRequest(normalizedContent, input, context.chunks.map((chunk) => chunk.id));

  const providerOutcome = await provider.generate({ request, context });
  if (providerOutcome.status === "error") {
    return errorOutcome(providerOutcome.error.code, providerOutcome.error.message);
  }

  const validation = validateGeneratedDeckResponse(providerOutcome.raw, context, request, provider.id);
  if (validation.status === "invalid") {
    return {
      status: "error",
      error: {
        code: "validation-failed",
        message: "The generated response did not pass validation.",
        deckIssues: validation.deckIssues,
        cardIssues: validation.cardIssues,
      },
    };
  }

  return { status: "ready", draft: validation.draft };
}
