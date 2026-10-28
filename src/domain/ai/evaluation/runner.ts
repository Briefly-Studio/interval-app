import { generateStudyDeck, type ModelProvider } from "../aiService";
import { planGenerationBatches } from "../batchPlanning";
import { resolveRequestedCardCount, resolveTargetMinimumCardCount } from "../generationOptions";
import { runMultiBatchGeneration } from "../multiBatchGeneration";
import { resolveSourceGenerationScope } from "../sourceGenerationScope";
import type { GeneratedCardDraft, GenerationErrorCode, GenerationOptions } from "../types";
import { getEvaluationFixture } from "./fixtures";
import { deriveCountCheckStatus, scoreCards } from "./scoring";
import type { EvaluationCase, EvaluationFixture, EvaluationOutcomeCategory, GenerationEvaluationResult } from "./types";

// The evaluation runner — drives ONE EvaluationCase to a GenerationEvaluationResult against an
// injected ModelProvider (mock or real; see cli.ts). Mirrors generateDeckFlow.ts's own real
// scope/batch-planning logic for "bounded" vs "wholeSource" rather than reimplementing it
// separately, so this harness measures the exact same code path a real user's "Automatic" /
// "Entire source" choice would run.

function categorizeErrorCode(code: GenerationErrorCode): EvaluationOutcomeCategory {
  switch (code) {
    case "rate-limited":
      return "rate-limited";
    case "daily-limit-reached":
      return "daily-limit-reached";
    case "malformed-model-output":
    case "unsafe-output":
      return "malformed-model-response";
    case "validation-failed":
      return "validation-failure";
    case "provider-unavailable":
    case "generation-timeout":
    case "generation-in-progress":
    case "request-in-progress":
    case "request-outcome-unknown":
    case "idempotency-conflict":
    case "idempotency-storage-failure":
      return "provider-unavailable";
    default:
      // normalization-not-ready / source-empty / source-too-large / unsupported-source /
      // context-too-large — a fixture/harness configuration problem, never a provider failure.
      return "harness-config-error";
  }
}

function baseResult(fixture: EvaluationFixture, evalCase: EvaluationCase, requestedMaximum: number, targetMinimum: number): Omit<
  GenerationEvaluationResult,
  "outcomeCategory" | "generatedCount" | "countCheckStatus" | "countScore" | "groundingScore" | "provenanceValidity" | "exactDuplicateCount" | "latencyMs"
> {
  return {
    fixtureId: fixture.id,
    sourceType: fixture.sourceType,
    difficulty: evalCase.difficulty,
    tier: evalCase.tier,
    scope: evalCase.scope,
    requestedMaximum,
    targetMinimum,
  };
}

/**
 * Builds the result for an error outcome. `generatedCount`/`countCheckStatus`/`countScore`/
 * `groundingScore`/`provenanceValidity`/`exactDuplicateCount` are all placeholder/zero values —
 * report.ts's regression gate checks `outcomeCategory` FIRST and never attributes a non-ready
 * outcome's failure to a "count" or "grounding" problem, even though these fields happen to be
 * zero/false here too (see this file's own header comment / docs/ai-evaluation.md).
 */
function errorResult(
  fixture: EvaluationFixture,
  evalCase: EvaluationCase,
  requestedMaximum: number,
  targetMinimum: number,
  category: EvaluationOutcomeCategory,
  latencyMs: number,
  errorDetail: string
): GenerationEvaluationResult {
  return {
    ...baseResult(fixture, evalCase, requestedMaximum, targetMinimum),
    outcomeCategory: category,
    generatedCount: 0,
    countCheckStatus: "unexplained-under-target",
    countScore: 0,
    groundingScore: 0,
    provenanceValidity: false,
    exactDuplicateCount: 0,
    latencyMs,
    errorDetail,
  };
}

function buildReadyResult(
  fixture: EvaluationFixture,
  evalCase: EvaluationCase,
  requestedMaximum: number,
  targetMinimum: number,
  cards: GeneratedCardDraft[],
  generationStatusIsComplete: boolean,
  allowedChunkIds: ReadonlySet<string>,
  latencyMs: number,
  usage: GenerationEvaluationResult["tokenUsage"],
  batchInfo: GenerationEvaluationResult["batchInfo"],
  providerExecutionCount?: number
): GenerationEvaluationResult {
  const generatedCount = cards.length;
  const countCheckStatus = deriveCountCheckStatus({ generatedCount, targetMinimum, requestedMaximum, generationStatusIsComplete });
  const scored = scoreCards(cards, fixture, allowedChunkIds);
  return {
    ...baseResult(fixture, evalCase, requestedMaximum, targetMinimum),
    outcomeCategory: generationStatusIsComplete ? "ready" : "insufficient-content",
    generatedCount,
    countCheckStatus,
    countScore: countCheckStatus === "within-range" || countCheckStatus === "valid-insufficiency" ? 1 : 0,
    ...scored,
    latencyMs,
    tokenUsage: usage,
    generationStatus: generationStatusIsComplete ? "complete" : "insufficient-distinct-content",
    batchInfo,
    providerExecutionCount,
  };
}

export type RunEvaluationCaseParams = {
  provider: ModelProvider;
  evalCase: EvaluationCase;
};

export async function runEvaluationCase({ provider, evalCase }: RunEvaluationCaseParams): Promise<GenerationEvaluationResult> {
  const fixture = getEvaluationFixture(evalCase.fixtureId);
  const requestedMaximum = resolveRequestedCardCount(evalCase.tier);
  const targetMinimum = resolveTargetMinimumCardCount(evalCase.tier);
  const options: GenerationOptions = { cardCount: evalCase.tier, difficulty: evalCase.difficulty, cardStyle: "question-answer" };

  const startedAt = Date.now();
  try {
    const content = fixture.buildNormalizedContent();

    if (evalCase.scope === "bounded") {
      // Mirrors the real app's "Automatic" scope exactly — no restriction, let
      // prepareGenerationContext's own default budget decide what fits.
      const outcome = await generateStudyDeck(provider, {
        sourceTitle: content.title,
        normalizedContent: content,
        options,
        language: content.language,
      });
      if (outcome.status === "error") {
        return errorResult(fixture, evalCase, requestedMaximum, targetMinimum, categorizeErrorCode(outcome.error.code), Date.now() - startedAt, outcome.error.code);
      }
      const allowed = new Set(outcome.draft.generation.selectedChunkIds);
      return buildReadyResult(
        fixture, evalCase, requestedMaximum, targetMinimum,
        outcome.draft.cards, outcome.draft.generation.generationStatus === "complete", allowed,
        outcome.durationMs ?? Date.now() - startedAt, outcome.usage, undefined, outcome.providerExecutionCount
      );
    }

    // wholeSource — mirrors generateDeckFlow.ts's own "entireSource" scope handling: resolve
    // candidate chunks, plan batches, and only go through multi-batch orchestration when the
    // plan actually needs more than one batch.
    const resolvedScope = resolveSourceGenerationScope({ chunks: content.chunks, scope: { type: "entireSource" } });
    if (resolvedScope.status === "error") {
      return errorResult(fixture, evalCase, requestedMaximum, targetMinimum, "harness-config-error", Date.now() - startedAt, resolvedScope.code);
    }
    const candidateChunks = resolvedScope.chunkIds
      ? content.chunks.filter((c) => resolvedScope.chunkIds!.includes(c.id))
      : content.chunks;
    const plan = planGenerationBatches(candidateChunks);
    if (plan.status === "error") {
      return errorResult(fixture, evalCase, requestedMaximum, targetMinimum, "harness-config-error", Date.now() - startedAt, plan.code);
    }

    if (plan.batches.length > 1) {
      const multiOutcome = await runMultiBatchGeneration({
        provider,
        normalizedContent: content,
        sourceTitle: content.title,
        language: content.language,
        options,
        plan,
      });
      if (multiOutcome.status === "canceled") {
        return errorResult(fixture, evalCase, requestedMaximum, targetMinimum, "canceled", multiOutcome.totalDurationMs, "canceled");
      }
      if (multiOutcome.status === "error") {
        const category = multiOutcome.completedBatchCount > 0 ? "multi-batch-partial-failure" : categorizeErrorCode(multiOutcome.error.code);
        return errorResult(fixture, evalCase, requestedMaximum, targetMinimum, category, multiOutcome.totalDurationMs, `${multiOutcome.error.code} at batch ${multiOutcome.failedAtBatchIndex}`);
      }
      const allowed = new Set(multiOutcome.draft.generation.selectedChunkIds);
      return buildReadyResult(
        fixture, evalCase, requestedMaximum, targetMinimum,
        multiOutcome.draft.cards, multiOutcome.draft.generation.generationStatus === "complete", allowed,
        multiOutcome.totalDurationMs, multiOutcome.usage,
        { plannedBatchCount: plan.batches.length, completedBatchCount: plan.batches.length }, multiOutcome.providerExecutionCount
      );
    }

    // Exactly one batch — single bounded call over the full candidate set, same as the real
    // app's own fallthrough for this case.
    const outcome = await generateStudyDeck(provider, {
      sourceTitle: content.title,
      normalizedContent: content,
      options,
      language: content.language,
      selectedChunkIds: candidateChunks.map((c) => c.id),
    });
    if (outcome.status === "error") {
      return errorResult(fixture, evalCase, requestedMaximum, targetMinimum, categorizeErrorCode(outcome.error.code), Date.now() - startedAt, outcome.error.code);
    }
    const allowed = new Set(outcome.draft.generation.selectedChunkIds);
    return buildReadyResult(
      fixture, evalCase, requestedMaximum, targetMinimum,
      outcome.draft.cards, outcome.draft.generation.generationStatus === "complete", allowed,
      outcome.durationMs ?? Date.now() - startedAt, outcome.usage,
      { plannedBatchCount: 1, completedBatchCount: 1 }, outcome.providerExecutionCount
    );
  } catch (e) {
    return errorResult(
      fixture, evalCase, requestedMaximum, targetMinimum, "harness-config-error", Date.now() - startedAt,
      e instanceof Error ? e.message : "UnknownError"
    );
  }
}

/**
 * How many actual provider requests a case will make — 1 for "bounded" and for any "wholeSource"
 * case whose content fits one batch; the real planned batch count otherwise. Used by the CLI
 * (scripts/eval-ai.mjs) to print the planned request count BEFORE a real-provider run ever
 * starts (see the mission's own "Real provider safety" requirement) — never after the fact.
 * Pure w.r.t. the provider (builds the fixture's content and plans batches, but calls no
 * ModelProvider), so this can run freely even in `--real` mode without consuming any quota.
 */
export function estimatePlannedRequestCount(evalCase: EvaluationCase): number {
  if (evalCase.scope === "bounded") return 1;
  const fixture = getEvaluationFixture(evalCase.fixtureId);
  const content = fixture.buildNormalizedContent();
  const resolvedScope = resolveSourceGenerationScope({ chunks: content.chunks, scope: { type: "entireSource" } });
  if (resolvedScope.status === "error") return 0;
  const candidateChunks = resolvedScope.chunkIds
    ? content.chunks.filter((c) => resolvedScope.chunkIds!.includes(c.id))
    : content.chunks;
  const plan = planGenerationBatches(candidateChunks);
  return plan.status === "ok" ? plan.batches.length : 0;
}

export async function runEvaluationMatrix(provider: ModelProvider, cases: EvaluationCase[]): Promise<GenerationEvaluationResult[]> {
  const results: GenerationEvaluationResult[] = [];
  // Sequential, never parallel — matches this repository's own established precedent
  // (multiBatchGeneration.ts's own sequential-only design) and keeps a real-provider run's
  // request count predictable/bounded rather than bursting many concurrent Bedrock calls.
  for (const evalCase of cases) {
    results.push(await runEvaluationCase({ provider, evalCase }));
  }
  return results;
}
