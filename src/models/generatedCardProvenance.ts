// Local-only, UNSYNCED link between a saved CardRecord and the normalized source chunk(s) it was
// generated from. This is the store docs/generate-study-deck-ux.md's "Source relationship &
// provenance persistence (deliberately deferred)" section sketched but never built — see
// docs/source-coverage.md for the full rationale.
//
// Deliberately NOT a field on CardRecord/DeckRecord (src/models/card.ts, src/models/deck.ts) —
// both are on the live Production sync path (src/cloud/sync/SyncService.ts pushes every dirty
// card/deck in every environment), and CLAUDE.md explicitly forbids adding a source-origin field
// to either. This record lives in its own storage key instead, exactly like
// src/models/deckCollection.ts keeps deck-collection membership off DeckRecord. Never read by
// src/cloud/sync/** — see src/storage/generatedCardProvenance.ts's header comment.

export type GeneratedCardProvenance = {
  /** The CardRecord.id this entry describes. At most one entry per cardId. */
  cardId: string;
  /** The deck the card was saved into — lets coverage computation fetch only the decks it
   * actually needs (src/storage/cards.ts stores cards per-deck) instead of scanning every deck a
   * workspace has. */
  deckId: string;
  /** The LibrarySourceRecord.id the card was generated from. */
  sourceId: string;
  /** Content-addressed normalized chunk ids (src/domain/normalization/chunking.ts's
   * computeChunkId) this card actually cited. Never fuzzy-matched or inferred — only ever the
   * ids generation itself produced for this card (DraftCard.sourceChunkIds). */
  sourceChunkIds: string[];
  /** ISO 8601 UTC — when the card was saved (not when it was generated/reviewed). */
  generatedAt: string;
};

function normalizeChunkIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return Array.from(new Set(cleaned));
}

/** Rejects (returns null for) anything that doesn't look like a real provenance entry — malformed
 * persisted state must be dropped, never guessed into a plausible-looking shape (same posture as
 * reviewEvent.ts's upgradeReviewEventRecord). */
export function upgradeGeneratedCardProvenance(raw: unknown): GeneratedCardProvenance | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.cardId !== "string" || !r.cardId) return null;
  if (typeof r.deckId !== "string" || !r.deckId) return null;
  if (typeof r.sourceId !== "string" || !r.sourceId) return null;
  if (typeof r.generatedAt !== "string" || !r.generatedAt) return null;

  const sourceChunkIds = normalizeChunkIds(r.sourceChunkIds);
  if (sourceChunkIds.length === 0) return null;

  return { cardId: r.cardId, deckId: r.deckId, sourceId: r.sourceId, sourceChunkIds, generatedAt: r.generatedAt };
}
