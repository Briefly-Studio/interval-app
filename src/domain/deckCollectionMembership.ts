import type { DeckRecord } from "../models/deck";
import type { DeckCollectionRecord } from "../models/deckCollection";

// Pure, side-effect-free helpers shared by every screen that needs to know which decks are
// unfiled (Home, the Add Decks picker) — a single implementation rather than each screen
// re-deriving its own notion of "assigned." See docs/deck-collections.md.

/** Deck ids referenced by any active collection, intersected against the given active deck list.
 * A deckId can briefly linger in a collection's `deckIds` after its deck was deleted elsewhere
 * (see docs/deck-collections.md) — intersecting against the real active deck list keeps this
 * accurate without requiring that cleanup to have already run. */
export function getAssignedDeckIds(decks: DeckRecord[], collections: DeckCollectionRecord[]): Set<string> {
  const activeDeckIds = new Set(decks.map((deck) => deck.id));
  const assigned = new Set<string>();
  for (const collection of collections) {
    for (const deckId of collection.deckIds) {
      if (activeDeckIds.has(deckId)) assigned.add(deckId);
    }
  }
  return assigned;
}

/** An unfiled deck is an active deck currently belonging to no Deck Collection — the exact set
 * of decks the "Add decks" picker is allowed to offer (see docs/deck-collections.md's
 * "Add never implicitly moves a deck between collections" rule). */
export function getUnfiledDecks(decks: DeckRecord[], collections: DeckCollectionRecord[]): DeckRecord[] {
  const assigned = getAssignedDeckIds(decks, collections);
  return decks.filter((deck) => !assigned.has(deck.id));
}
