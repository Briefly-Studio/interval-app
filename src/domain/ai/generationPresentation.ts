import type { TranslationKey } from "../../i18n/translate";
import type { NormalizedChunk } from "../normalization/types";
import type { BatchPlan } from "./batchPlanning";
import type { MultiBatchProgress } from "./multiBatchGeneration";
import type { SourceGenerationScopeKind } from "./sourceGenerationScope";
import type { GenerationErrorCode } from "./types";

// Three requests warrant an explicit check; one/two keep their low-friction existing path.
export const GENERATION_CONFIRMATION_STEPS = 3;
export type GenerationPlanSummary = { stepCount: number; sectionCount: number; pagesWithText?: number };
export function summarizeGenerationPlan(chunks: NormalizedChunk[], plan?: BatchPlan | null): GenerationPlanSummary {
  if (plan?.status === "error") return { stepCount: 0, sectionCount: 0 };
  const ids = plan?.status === "ok" ? new Set(plan.batches.flatMap((b) => b.chunkIds)) : null;
  const selected = ids ? chunks.filter((c) => ids.has(c.id)) : chunks;
  const pageAware = selected.length > 0 && selected.every((c) => Number.isInteger(c.provenance.page) && c.provenance.page! > 0);
  return { stepCount: plan?.status === "ok" ? plan.batches.length : 1, sectionCount: selected.length,
    ...(pageAware ? { pagesWithText: new Set(selected.map((c) => c.provenance.page)).size } : {}) };
}
export function needsGenerationConfirmation(stepCount: number): boolean {
  return stepCount >= GENERATION_CONFIRMATION_STEPS;
}
export function generationProgressCopy(progress: MultiBatchProgress | undefined, canceling: boolean): { key: TranslationKey; params?: { current: number; total: number } } {
  if (canceling) return { key: "generateDeck.multi.cancelingBody" };
  switch (progress?.phase) {
    case "preparing": return { key: "generateDeck.multi.preparing" };
    case "batch": return { key: "generateDeck.generatingBatchBody", params: { current: progress.batchIndex, total: progress.batchCount } };
    case "combining": return { key: "generateDeck.generatingCombiningBody" };
    case "preparingReview": return { key: "generateDeck.multi.preparingReview" };
    default: return { key: "generateDeck.generatingBody" };
  }
}
export function multiBatchFailureCopy(code: GenerationErrorCode): TranslationKey {
  return code === "daily-limit-reached" ? "generateDeck.multi.dailyLimit" : "generateDeck.multi.failed";
}
export function planTooLargeCopy(scope: SourceGenerationScopeKind): TranslationKey {
  return scope === "uncovered" ? "generateDeck.multi.tooMuchUncovered" : "generateDeck.scope.error.planTooLarge";
}
/** No quota counters: this is a plan, not an assertion about the user's remaining allowance. */
export function plannedDailyRequests(summary: GenerationPlanSummary, realProvider: boolean): number | null {
  return realProvider && summary.stepCount > 1 ? summary.stepCount : null;
}
/** Shared order used by the screen and tested without native Alert/storage dependencies. */
export async function approveGenerationPlan(params: {
  needsConsent: boolean; consent: () => Promise<boolean>; confirm: () => Promise<boolean>;
  stepCount: number; isCanceled: () => boolean;
}): Promise<boolean> {
  if (params.isCanceled()) return false;
  if (params.needsConsent && !await params.consent()) return false;
  if (params.isCanceled()) return false;
  if (needsGenerationConfirmation(params.stepCount) && !await params.confirm()) return false;
  return !params.isCanceled();
}
