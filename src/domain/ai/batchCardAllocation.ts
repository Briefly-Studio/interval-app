// Deterministic per-batch card-count allocation for multi-batch generation. See
// docs/whole-source-generation.md's "Card allocation" section for the full product reasoning.
//
// Deliberately pure arithmetic — no chunk/content inspection. This is a conscious choice, not an
// oversight: raw character count does not reliably predict how many genuinely distinct,
// study-worthy facts a chunk holds (that is the model's job to judge, not this allocator's), so
// an even POSITIONAL split across batches is used instead of a size-weighted one. This keeps the
// policy simple, deterministic, and — critically — fair to later batches, rather than fabricating
// false precision from a signal (char count) that was never meant to measure content richness.

/**
 * Splits `total` into `count` non-negative integers that sum to exactly `total`, as evenly as
 * possible, using the standard cumulative-rounding ("largest remainder", applied incrementally)
 * method: entry i = floor(total*(i+1)/count) - floor(total*i/count). This spreads any remainder
 * across the SEQUENCE rather than piling it onto the first (or last) buckets, and — the property
 * this allocator actually depends on — guarantees every entry is >= floor(total/count), so when
 * `total >= count` every entry is at least 1. Deterministic for the same inputs.
 */
export function distributeEvenly(total: number, count: number): number[] {
  if (count <= 0) return [];
  const safeTotal = Math.max(0, total);
  const result: number[] = [];
  let previousCumulative = 0;
  for (let i = 1; i <= count; i++) {
    const cumulative = Math.floor((safeTotal * i) / count);
    result.push(cumulative - previousCumulative);
    previousCumulative = cumulative;
  }
  return result;
}

/**
 * Computes each batch's own `requestedCardCount` ceiling for a multi-batch generation. The
 * result is used directly as a NUMERIC `GenerationOptions.cardCount` override per batch (see
 * multiBatchGeneration.ts) — this is deliberately the "clean internal batch request contract"
 * the product brief calls for, rather than reusing the user-facing Small/Medium/Large presets
 * (whose OWN target minimums — 5, 10, 18 — would be nonsensical instructions for a batch that
 * only receives 2-4 allocated cards). A numeric override's existing minimum-equals-ceiling
 * semantics (`resolveTargetMinimumCardCount`, generationOptions.ts) already give each batch an
 * honest, proportionate "try to reach exactly this many, quality permitting" instruction with no
 * further change needed anywhere else in the pipeline.
 *
 * Every batch gets AT LEAST one card's worth of real opportunity — this is what makes the "every
 * eligible chunk was actually considered" claim for a multi-batch "Entire source"/oversized
 * scope generation true in practice, not just in the chunk-assignment plan. When
 * `batchCount > requestedCardCount` (only reachable via a raw numeric `cardCount` override below
 * `MAX_BATCHES_PER_GENERATION`, not through the shipped Small/Medium/Large UI — see
 * batchPlanning.ts's own doc comment on why 8 was chosen), the EFFECTIVE total this function
 * distributes rises to `batchCount` so no batch is skipped — bounded, since
 * `MAX_BATCHES_PER_GENERATION` itself is a hard structural cap, never unbounded. The user-facing
 * aggregate "insufficient-distinct-content" judgment (see multiBatchGeneration.ts) always compares
 * against the ORIGINAL, unmodified `targetMinimumCardCount` — this internal effective-ceiling
 * bump never changes what counts as "enough" from the user's point of view.
 */
export function allocateCardsAcrossBatches(params: { batchCount: number; requestedCardCount: number }): number[] {
  const { batchCount, requestedCardCount } = params;
  if (batchCount <= 0) return [];
  const effectiveTotal = Math.max(requestedCardCount, batchCount);
  return distributeEvenly(effectiveTotal, batchCount);
}
