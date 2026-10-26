import type { GeneratedCardProvenance } from "../models/generatedCardProvenance";
import { computeSourceCoverage, deriveCoveredChunkIds } from "./sourceCoverage";

type Card = { id: string; deckId: string; rev: number; updatedAt: string; deletedAt?: string };
type Deck = { id: string; deletedAt?: string };

/** Card/deck truth dominates provenance, independent of arrival order. Resolve duplicate card
 * locations by revision/time (restore-to-recovery can move a card), with deleted winning ties. */
export function sourceCoverageWithLiveRecords(chunkIds: string[], provenance: GeneratedCardProvenance[], decks: Deck[], cards: Card[]) {
  const liveDecks = new Set(decks.filter((d) => !d.deletedAt).map((d) => d.id));
  const byId = new Map<string, Card>();
  for (const card of cards) {
    const current = byId.get(card.id);
    const tied = current && card.rev === current.rev && card.updatedAt === current.updatedAt;
    const lifecycleWins = tied && (card.deletedAt ?? "") > (current.deletedAt ?? "");
    const locationWins = tied && card.deletedAt === current.deletedAt && card.deckId > current.deckId;
    if (!current || card.rev > current.rev || (card.rev === current.rev && card.updatedAt > current.updatedAt)
      || lifecycleWins || locationWins) byId.set(card.id, card);
  }
  const live = new Set(Array.from(byId.values()).filter((c) => !c.deletedAt && liveDecks.has(c.deckId)).map((c) => c.id));
  return computeSourceCoverage(chunkIds, deriveCoveredChunkIds(provenance, live));
}
