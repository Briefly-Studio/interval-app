import type { NormalizedChunk } from "../normalization/types";
import { DEFAULT_CONTEXT_CHAR_BUDGET } from "./contextPreparation";

// Deterministic partitioning of a RESOLVED source-scope candidate chunk set into bounded
// "batches" — each independently fitting the existing, unchanged GenerationContext character
// budget — so Generate Study Deck can process a selected scope larger than one bounded AI
// request without pretending a single call saw all of it. See docs/whole-source-generation.md.
//
// Deliberately PURE — no storage, no provider call, no React Native import, same split as
// src/domain/ai/sourceGenerationScope.ts. The orchestration that actually CALLS a provider once
// per planned batch lives in multiBatchGeneration.ts instead.
//
// This module reuses contextPreparation.ts's own budget constant and char-count model rather
// than inventing a second, incompatible size measurement — see fitsWithinOneBatch's doc comment.

// A Development safety cap, not a hard product promise. Chosen so that even in the worst case
// (exactly MAX_BATCHES_PER_GENERATION batches), the smallest named card-count tier (Small,
// ceiling 8) can still give every batch at least one real card opportunity without having to
// raise the effective ceiling above 8 — see batchCardAllocation.ts's own doc comment for why that
// matters. Also deliberately well under the backend's 20/day per-user quota (see
// docs/ai-generation-foundation.md's "Rate limits and cost controls") — one multi-batch
// generation can consume at most 8 of a user's 20 daily AI requests, never an unbounded fraction
// of it. Not centrally re-derived from either number — a deliberate, documented product choice,
// not a formula.
export const MAX_BATCHES_PER_GENERATION = 8;

export type GenerationBatch = {
  /** 0-based, stable — matches the batch's position in source order. */
  index: number;
  /** In source order, deduplicated by construction (built from an already-deduplicated chunk
   * list) — every chunk in the resolved candidate scope is assigned to EXACTLY one batch. */
  chunkIds: string[];
  /** Sum of this batch's own chunks' approxSize — always <= the budget this plan was built with,
   * except for the one documented edge case of a single chunk whose own approxSize alone exceeds
   * the budget (see planGenerationBatches's doc comment). */
  approxChars: number;
};

export type BatchPlanErrorCode =
  // The candidate chunk list was empty — nothing to plan.
  | "no-content"
  // Partitioning needed more than MAX_BATCHES_PER_GENERATION batches — refused before any
  // provider call, never silently processed as a 50-batch marathon.
  | "plan-too-large";

export type BatchPlan =
  | { status: "ok"; batches: GenerationBatch[]; totalCandidateChunks: number }
  | { status: "error"; code: BatchPlanErrorCode };

/**
 * Partitions `chunks` (already resolved to one source-generation scope's candidate set, in their
 * own stable document order) into the minimum number of batches such that each batch's own total
 * `approxSize` stays within `charBudget` (default: `DEFAULT_CONTEXT_CHAR_BUDGET`, the exact same
 * budget `prepareGenerationContext` already uses for a single bounded request — never a second,
 * incompatible size model). Greedy, single forward pass — deterministic, no backtracking, no
 * possibility of an infinite loop:
 *   - Every chunk is assigned to EXACTLY one batch — nothing is ever dropped from the plan.
 *   - No batch is ever empty.
 *   - Source order is preserved both within each batch and across batches.
 *   - A single chunk whose OWN `approxSize` alone exceeds `charBudget` still gets its own
 *     one-chunk batch (never silently excluded the way a single bounded
 *     `prepareGenerationContext` call would) — the plan never drops it. Whether that one
 *     oversized batch can actually be PROCESSED by a real generation call is a separate,
 *     later concern (see multiBatchGeneration.ts and docs/whole-source-generation.md's "Known
 *     limitations" — this is an extreme edge case not reachable through any adapter's current
 *     chunk-size behavior).
 * Returns a typed error — never throws, never silently truncates — for an empty candidate set or
 * a plan that would exceed `maxBatches` (default: `MAX_BATCHES_PER_GENERATION`).
 */
export function planGenerationBatches(
  chunks: NormalizedChunk[],
  options: { charBudget?: number; maxBatches?: number } = {}
): BatchPlan {
  if (chunks.length === 0) return { status: "error", code: "no-content" };

  const budget = options.charBudget ?? DEFAULT_CONTEXT_CHAR_BUDGET;
  const maxBatches = options.maxBatches ?? MAX_BATCHES_PER_GENERATION;

  const batches: GenerationBatch[] = [];
  let currentIds: string[] = [];
  let currentChars = 0;

  for (const chunk of chunks) {
    const fitsCurrentBatch = currentIds.length === 0 || currentChars + chunk.approxSize <= budget;
    if (fitsCurrentBatch) {
      currentIds.push(chunk.id);
      currentChars += chunk.approxSize;
    } else {
      batches.push({ index: batches.length, chunkIds: currentIds, approxChars: currentChars });
      currentIds = [chunk.id];
      currentChars = chunk.approxSize;
    }
  }
  if (currentIds.length > 0) {
    batches.push({ index: batches.length, chunkIds: currentIds, approxChars: currentChars });
  }

  if (batches.length > maxBatches) return { status: "error", code: "plan-too-large" };
  return { status: "ok", batches, totalCandidateChunks: chunks.length };
}

/** True when `chunks` can be planned at all (fits within `maxBatches`) — the pure eligibility
 * check `sourceGenerationScopeUi.ts` uses to decide whether to even offer "Entire source" for an
 * oversized source. Never fabricates a plan just to answer this; it's the same
 * `planGenerationBatches` call the real orchestration will make. */
export function canPlanBatchesFor(chunks: NormalizedChunk[], options: { charBudget?: number; maxBatches?: number } = {}): boolean {
  return planGenerationBatches(chunks, options).status === "ok";
}
