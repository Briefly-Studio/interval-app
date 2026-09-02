import type { NormalizedChunk, NormalizedSourceContent } from "../normalization/types";
import type { GenerationContext } from "./types";

// Provider-neutral context selection — the ONLY thing this module measures is JS string
// character count, exactly like src/domain/normalization/chunking.ts. No tokenizer, no
// provider-specific budget, named anywhere in this file. A future provider adapter is free to
// perform its own exact token accounting on top of whatever this module selects; that accounting
// never needs to leak back into this domain layer.
//
// v1 strategy is deliberately simple — sequential, in the chunks' own existing (deterministic)
// order, greedily including whole chunks until the budget would be exceeded. No embeddings, no
// relevance ranking. The `rankChunks` parameter below is the seam a future smarter-selection
// batch hooks into without changing this function's signature or any caller.

export const DEFAULT_CONTEXT_CHAR_BUDGET = 24_000;
export const MAX_CONTEXT_CHAR_BUDGET = 60_000;

export type PrepareContextOptions = {
  /** Caller-requested budget, clamped to `MAX_CONTEXT_CHAR_BUDGET` — never removed, only capped.
   * Defaults to `DEFAULT_CONTEXT_CHAR_BUDGET`. */
  charBudget?: number;
  /**
   * Reserved extension point for a future relevance-ranking pass (e.g. once embeddings/semantic
   * search exist) — receives the full chunk list and must return them in the order selection
   * should consider them (NOT necessarily the order they end up in the final context; see
   * `preserveOriginalOrder`). Defaults to identity (chunks' own existing deterministic order).
   * Nothing in this batch implements a non-identity ranking.
   */
  rankChunks?: (chunks: NormalizedChunk[]) => NormalizedChunk[];
  /**
   * When true (the default), the FINAL selected chunks are re-sorted back into the source's own
   * original `index` order before being returned, even if `rankChunks` reordered them for
   * selection purposes — so provenance always reads in natural document order regardless of how
   * chunks were chosen. A future feature that genuinely wants ranked (not document) order can
   * opt out.
   */
  preserveOriginalOrder?: boolean;
};

/**
 * Selects a bounded, ordered subset of `content.chunks` for generation. Never splits a chunk's
 * text to fit the budget — a chunk is either fully included or fully excluded ("select complete
 * chunks when possible; avoid cutting chunks arbitrarily"). `fullSourceIncluded` is `false` the
 * moment even one chunk had to be excluded, so a caller can never present a partial-context
 * generation as if the whole source was used.
 */
export function prepareGenerationContext(content: NormalizedSourceContent, options: PrepareContextOptions = {}): GenerationContext {
  const budget = Math.max(0, Math.min(options.charBudget ?? DEFAULT_CONTEXT_CHAR_BUDGET, MAX_CONTEXT_CHAR_BUDGET));
  const rank = options.rankChunks ?? ((chunks: NormalizedChunk[]) => chunks);
  const preserveOrder = options.preserveOriginalOrder ?? true;

  const candidates = rank(content.chunks);

  const included: NormalizedChunk[] = [];
  const excluded: string[] = [];
  let totalChars = 0;

  for (const chunk of candidates) {
    if (totalChars + chunk.approxSize <= budget) {
      included.push(chunk);
      totalChars += chunk.approxSize;
    } else {
      excluded.push(chunk.id);
    }
  }

  const finalChunks = preserveOrder ? [...included].sort((a, b) => a.index - b.index) : included;

  return {
    chunks: finalChunks,
    totalChars,
    chunkCount: finalChunks.length,
    fullSourceIncluded: excluded.length === 0 && content.chunks.length > 0,
    excludedChunkIds: excluded,
    excludedChunkCount: excluded.length,
  };
}
