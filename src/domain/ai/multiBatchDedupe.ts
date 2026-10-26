import { normalizeForDuplicateCheck } from "./responseValidation";
import type { GeneratedCardDraft } from "./types";

// Cross-batch exact-duplicate control for combined multi-batch generation results. See
// docs/whole-source-generation.md's "Duplicate handling" section.
//
// Deliberately reuses responseValidation.ts's EXACT within-batch duplicate definition
// (`normalizeForDuplicateCheck`: trimmed, lowercased, whitespace-collapsed, exact string equality
// on front+back) rather than a second, independently-coded notion of "duplicate" — a card that
// wouldn't have survived within one batch must not survive across batches either, and vice
// versa. Deliberately does NOT do fuzzy/similarity/semantic/embedding-based matching — only two
// cards whose normalized front+back are byte-for-byte identical are ever merged. A card that is
// merely SIMILAR in wording to another (e.g. the same fact asked two different ways) is left
// alone; that is a quality judgment for the user reviewing the draft, not something this layer
// silently decides for them.

export type DedupeCombinedCardsResult = {
  /** In first-seen order — i.e. source order, since batches run sequentially in source order and
   * dedupe never reorders. */
  cards: GeneratedCardDraft[];
  duplicatesRemoved: number;
};

/**
 * Collapses exact duplicates (by `normalizeForDuplicateCheck(front, back)`) across the combined
 * card list from every batch, keeping the FIRST occurrence's position but unioning the retained
 * card's `sourceChunkIds` with the duplicate's — so if two batches independently produced the
 * "same" card from different chunks, provenance from the one that gets dropped is never silently
 * lost. Deterministic for the same input order. Never drops a card's content, only a byte-for-byte
 * repeat of one already kept.
 */
export function dedupeCombinedCards(cards: GeneratedCardDraft[]): DedupeCombinedCardsResult {
  const indexByKey = new Map<string, number>();
  const result: GeneratedCardDraft[] = [];
  let duplicatesRemoved = 0;

  for (const card of cards) {
    const key = normalizeForDuplicateCheck(card.front, card.back);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, result.length);
      result.push(card);
      continue;
    }
    const existing = result[existingIndex];
    const unionedSourceChunkIds = Array.from(new Set([...existing.sourceChunkIds, ...card.sourceChunkIds]));
    result[existingIndex] = { ...existing, sourceChunkIds: unionedSourceChunkIds };
    duplicatesRemoved++;
  }

  return { cards: result, duplicatesRemoved };
}
