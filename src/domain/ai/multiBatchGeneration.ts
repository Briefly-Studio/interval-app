import type { NormalizedSourceContent } from "../normalization/types";
import { generateStudyDeck, type ModelProvider } from "./aiService";
import { allocateCardsAcrossBatches } from "./batchCardAllocation";
import { MAX_BATCHES_PER_GENERATION, type BatchPlan } from "./batchPlanning";
import { resolveRequestedCardCount, resolveTargetMinimumCardCount } from "./generationOptions";
import { dedupeCombinedCards } from "./multiBatchDedupe";
import { computeCardDraftId, deriveGenerationStatus } from "./responseValidation";
import { GENERATION_CONTRACT_VERSION } from "./types";
import type { GeneratedCardDraft, GeneratedDeckDraft, GenerationError, GenerationOptions, TokenUsage } from "./types";

// Sequential multi-batch orchestration — runs one bounded generateStudyDeck call per planned
// batch (never in parallel; see docs/whole-source-generation.md's "Sequential execution"
// section for why the backend's single-concurrency-slot lease makes this effectively mandatory,
// not just a stylistic choice), then combines every batch's accepted cards into ONE
// GeneratedDeckDraft with the exact same shape a single-call generation already produces — so
// startGenerateDeckSession/generateDeckSave.ts/review.tsx need no changes at all to consume it.
//
// Impure (calls a real provider) — the pure pieces this depends on (batchPlanning.ts,
// batchCardAllocation.ts, multiBatchDedupe.ts) are each independently tested; this file's own
// tests use a fake synchronous ModelProvider, same pattern as aiService.test.ts.

export type MultiBatchProgress =
  | { phase: "preparing" }
  | { phase: "batch"; batchIndex: number; batchCount: number }
  | { phase: "combining" }
  | { phase: "preparingReview" };

export type MultiBatchOutcome =
  // `usage`/`totalDurationMs` are evaluation/telemetry-only (see types.ts's TokenUsage doc
  // comment) — `usage` is the SUM of every batch's own reported usage, present only when EVERY
  // batch reported one (never a partial/misleading total); `totalDurationMs` is always present
  // (Date.now() wall-clock across the whole sequential run, same timing convention this file's
  // own logAggregateOutcome already used internally — now also returned to the caller).
  | { status: "ready"; draft: GeneratedDeckDraft; usage?: TokenUsage; totalDurationMs: number }
  // The underlying error from whichever batch failed first — reuses the EXISTING
  // GenerationErrorCode taxonomy/copy untouched; the user is never shown "batch" terminology.
  | { status: "error"; error: GenerationError; failedAtBatchIndex: number; completedBatchCount: number; totalDurationMs: number }
  | { status: "canceled"; completedBatchCount: number; totalDurationMs: number };

export type RunMultiBatchGenerationParams = {
  provider: ModelProvider;
  normalizedContent: NormalizedSourceContent;
  sourceTitle: string;
  language?: string;
  /** The ORIGINAL, user-facing tier (Small/Medium/Large or a numeric override) — never mutated;
   * each batch's own request derives a numeric per-batch override from this via
   * allocateCardsAcrossBatches, but the AGGREGATE status/target-minimum judgment at the end always
   * compares against this original tier's own requestedCardCount/targetMinimumCardCount. */
  options: GenerationOptions;
  /** Already resolved + planned — see batchPlanning.ts. Must be a `status: "ok"` plan; planning
   * failures are handled by the caller (generateDeckFlow.ts) before this function is ever called. */
  plan: BatchPlan & { status: "ok" };
  onProgress?: (progress: MultiBatchProgress) => void;
  /** Checked before dispatch, after await, and before publishing a combined result. This does
   * not abort an in-flight HTTP request; it discards its result and stops future requests. */
  isCanceled?: () => boolean;
};

function logAggregateOutcome(detail: Record<string, unknown>): void {
  // Dev-only, aggregate-only — never source text, questions/answers, filenames, or tokens beyond
  // counts (see docs/whole-source-generation.md's "Logging" section for the exact field list this
  // mirrors, and normalizeSource.ts's own logNormalization for the precedent this follows). Uses
  // the `typeof` guard (not a bare `__DEV__` reference) because, unlike normalizeSource.ts's own
  // check, this function IS exercised directly by plain `node --test` unit tests, where no bundler
  // ever defines the global — see i18n/translate.ts/theme/index.ts for the same established
  // pattern.
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  console.log("[MultiBatchGeneration] done", detail);
}

export async function runMultiBatchGeneration(params: RunMultiBatchGenerationParams): Promise<MultiBatchOutcome> {
  const { provider, normalizedContent, sourceTitle, language, options, plan } = params;
  const startedAt = Date.now();
  const canceled = (completedBatchCount: number): MultiBatchOutcome => ({
    status: "canceled", completedBatchCount, totalDurationMs: Date.now() - startedAt,
  });
  const failure = (code: GenerationError["code"], index: number): MultiBatchOutcome => ({
    status: "error", error: { code, message: "Generation did not complete." }, failedAtBatchIndex: index, completedBatchCount: index,
    totalDurationMs: Date.now() - startedAt,
  });
  if (params.isCanceled?.()) return canceled(0);
  params.onProgress?.({ phase: "preparing" });
  const plannedIds = plan.batches.flatMap((batch) => batch.chunkIds);
  const sourceIds = new Set(normalizedContent.chunks.map((chunk) => chunk.id));
  if (!plan.batches.length || plan.batches.length > MAX_BATCHES_PER_GENERATION
    || plan.batches.some((batch, i) => !batch.chunkIds.length || batch.index !== i)
    || new Set(plannedIds).size !== plannedIds.length || plan.totalCandidateChunks !== plannedIds.length
    || plannedIds.some((id) => !sourceIds.has(id))) return failure("validation-failed", 0);

  const requestedCardCount = resolveRequestedCardCount(options.cardCount);
  const targetMinimumCardCount = resolveTargetMinimumCardCount(options.cardCount);
  const perBatchCeilings = allocateCardsAcrossBatches({ batchCount: plan.batches.length, requestedCardCount });

  const combinedCards: GeneratedCardDraft[] = [];
  let combinedTitle: string | null = null;
  let providerId = provider.id;
  const consideredChunkIds = new Set<string>();
  // Aggregate token usage across batches — present on the final outcome only if EVERY batch
  // reported one (never a partial/misleading sum; see MultiBatchOutcome's own doc comment).
  let usageSum = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let usageComplete = true;

  for (let i = 0; i < plan.batches.length; i++) {
    if (params.isCanceled?.()) {
      logAggregateOutcome({
        multiBatch: true,
        plannedBatchCount: plan.batches.length,
        completedBatchCount: i,
        outcome: "canceled",
        totalDurationMs: Date.now() - startedAt,
      });
      return { status: "canceled", completedBatchCount: i, totalDurationMs: Date.now() - startedAt };
    }

    const batch = plan.batches[i];
    params.onProgress?.({ phase: "batch", batchIndex: i + 1, batchCount: plan.batches.length });

    const batchOptions: GenerationOptions = { ...options, cardCount: perBatchCeilings[i] };
    // A progress callback can synchronously cancel before this request is dispatched.
    if (params.isCanceled?.()) return canceled(i);
    let outcome;
    try {
      outcome = await generateStudyDeck(provider, {
        sourceTitle,
        normalizedContent,
        options: batchOptions,
        language,
        selectedChunkIds: batch.chunkIds,
      });
    } catch {
      // Intentional cancellation wins over a simultaneous network/provider exception.
      if (params.isCanceled?.()) return canceled(i);
      return failure("provider-unavailable", i);
    }
    if (params.isCanceled?.()) return canceled(i + (outcome.status === "ready" ? 1 : 0));

    if (outcome.status === "error") {
      logAggregateOutcome({
        multiBatch: true,
        plannedBatchCount: plan.batches.length,
        completedBatchCount: i,
        outcome: "error",
        errorCode: outcome.error.code,
        totalDurationMs: Date.now() - startedAt,
      });
      return { status: "error", error: outcome.error, failedAtBatchIndex: i, completedBatchCount: i, totalDurationMs: Date.now() - startedAt };
    }

    if (outcome.usage) {
      usageSum = {
        inputTokens: usageSum.inputTokens + outcome.usage.inputTokens,
        outputTokens: usageSum.outputTokens + outcome.usage.outputTokens,
        totalTokens: usageSum.totalTokens + outcome.usage.totalTokens,
      };
    } else {
      usageComplete = false;
    }

    if (combinedTitle === null) combinedTitle = outcome.draft.title;
    providerId = outcome.draft.generation.providerId;
    combinedCards.push(...outcome.draft.cards);
    const submitted = outcome.draft.generation.selectedChunkIds;
    // Planning alone does not prove processing: the existing context budget can still exclude
    // a chunk (e.g. an oversized batch). Never turn that into a whole-selection success claim.
    if (batch.chunkIds.some((id) => !submitted.includes(id))) return failure("context-too-large", i);
    for (const chunkId of submitted) consideredChunkIds.add(chunkId);
  }

  if (params.isCanceled?.()) return canceled(plan.batches.length);
  params.onProgress?.({ phase: "combining" });
  if (params.isCanceled?.()) return canceled(plan.batches.length);

  const { cards: dedupedCards, duplicatesRemoved } = dedupeCombinedCards(combinedCards);
  // Re-stamp a fresh, globally-unique, content-addressed id now that cards from independent
  // batch validation passes are combined into one deck — see computeCardDraftId's own doc
  // comment (responseValidation.ts) for why this is safe/expected (ids are deterministic within
  // ONE validation-shaped pass, never a cross-call identity guarantee on their own).
  const finalCards: GeneratedCardDraft[] = dedupedCards.map((card, index) => ({
    ...card,
    id: computeCardDraftId(index, card.front, card.back, card.sourceChunkIds),
  }));

  const resultingCardCount = finalCards.length;
  // AUTHORITATIVE aggregate status — derived exactly like a single-batch draft's own status
  // (deriveGenerationStatus, responseValidation.ts), just over the combined total vs. the
  // ORIGINAL (never batch-inflated) target minimum. A model claiming "complete" in every
  // individual batch while the combined total still falls short of the user's actual tier floor
  // is never trusted — see that function's own doc comment for the full fail-safe rationale,
  // which applies identically here.
  const generationStatus = deriveGenerationStatus(resultingCardCount, targetMinimumCardCount);

  const excludedChunkIds = normalizedContent.chunks.filter((chunk) => !consideredChunkIds.has(chunk.id)).map((chunk) => chunk.id);

  const draft: GeneratedDeckDraft = {
    title: combinedTitle ?? sourceTitle,
    cards: finalCards,
    sourceId: normalizedContent.sourceId,
    generation: {
      generationContractVersion: GENERATION_CONTRACT_VERSION,
      normalizationVersion: normalizedContent.normalizationVersion,
      sourceId: normalizedContent.sourceId,
      selectedChunkIds: Array.from(consideredChunkIds),
      requestedCardCount,
      targetMinimumCardCount,
      resultingCardCount,
      generationStatus,
      generatedAt: new Date().toISOString(),
      providerId,
      // Relative to the TRUE full normalized source — identical meaning to a single-call draft's
      // own fullSourceIncluded (aiService.ts's reconcileFullSourceReporting), just aggregated
      // across every batch instead of one. A scope that only ever asked for PART of the source
      // (e.g. a page range) still correctly reports false here if that range wasn't the whole
      // source — this field has never claimed "the user's selected scope", only "the source".
      fullSourceIncluded: excludedChunkIds.length === 0 && normalizedContent.chunks.length > 0,
      excludedChunkCount: excludedChunkIds.length,
      issues: [],
    },
  };

  params.onProgress?.({ phase: "preparingReview" });
  if (params.isCanceled?.()) return canceled(plan.batches.length);

  const totalDurationMs = Date.now() - startedAt;
  logAggregateOutcome({
    multiBatch: true,
    plannedBatchCount: plan.batches.length,
    completedBatchCount: plan.batches.length,
    selectedChunkCount: consideredChunkIds.size,
    requestedMaxCards: requestedCardCount,
    finalCardCount: resultingCardCount,
    duplicateCardsRemoved: duplicatesRemoved,
    outcome: "ready",
    totalDurationMs,
  });

  return { status: "ready", draft, usage: usageComplete ? usageSum : undefined, totalDurationMs };
}
