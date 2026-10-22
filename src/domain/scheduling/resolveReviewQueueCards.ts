// Pure join between "every live card in this deck" and "an optional pre-computed queue of card
// ids" — the ONLY scheduling-adjacent decision review.tsx itself is allowed to make. It never
// decides WHICH cards are due (that's dueSelection.ts, run by deck-detail before the queue is
// handed off — see reviewQueueSession.ts) — it only resolves a given id list against the cards
// it actually has, safely.

/**
 * - `pendingCardIds === null` (no due queue was handed off, e.g. a plain "Study All Cards" entry,
 *   or the queue was lost/already consumed) → every live card, in the caller's own existing
 *   order, completely unchanged from pre-scheduling behavior.
 * - `pendingCardIds` present → exactly those cards, in the QUEUE's order (not the deck's own
 *   storage order) — any id no longer present among the live cards (e.g. deleted between the
 *   queue being built and this screen mounting) is silently dropped, never substituted or
 *   invented.
 */
export function resolveReviewQueueCards<T extends { id: string }>(liveCards: T[], pendingCardIds: string[] | null): T[] {
  if (pendingCardIds === null) return liveCards;
  const byId = new Map(liveCards.map((card) => [card.id, card]));
  const resolved: T[] = [];
  for (const id of pendingCardIds) {
    const card = byId.get(id);
    if (card) resolved.push(card);
  }
  return resolved;
}
