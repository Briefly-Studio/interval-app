// Hands a pre-computed card-id queue from deck-detail to the review screen, in memory only — the
// same "module-scope single-slot store" pattern already used by
// src/domain/ai/generateDeckSession.ts, not a new idea introduced here. Deliberately NOT a route
// param: this keeps every scheduling decision ("which cards are due, in what order") made in ONE
// place (deck-detail, via dueSelection.ts) and never re-derived inside review.tsx — see
// docs/spaced-repetition-foundation.md's "Review queue behavior" section.
//
// "Consume once" semantics: reading clears the pending queue immediately, so a stale queue can
// never be silently reused by a later, unrelated navigation into review.tsx for the same deck —
// each "Study Due Cards" tap sets exactly one queue for exactly one subsequent review.tsx mount.

let pendingQueue: { deckId: string; cardIds: string[] } | null = null;

export function setPendingReviewQueue(deckId: string, cardIds: string[]): void {
  pendingQueue = { deckId, cardIds };
}

/** Returns the pending queue's card ids for this deck, or `null` if none is pending (e.g. a
 * plain "Study All Cards" entry, or the app was restarted and the in-memory queue was lost —
 * review.tsx treats `null` as "fall back to the normal all-cards flow", never as an error). */
export function consumePendingReviewQueue(deckId: string): string[] | null {
  if (!pendingQueue || pendingQueue.deckId !== deckId) return null;
  const { cardIds } = pendingQueue;
  pendingQueue = null;
  return cardIds;
}
