import type { DeckCollectionRecord } from "../models/deckCollection";

// Deck Collections are stable, named containers a user creates deliberately (e.g. "University",
// "AWS", "Personal") — unlike decks, where recency-of-study/edit is the meaningful signal,
// there's no equivalent activity-based ordering that makes sense here. Alphabetical-by-name is
// the more predictable, scannable mental model for a short list of folder-like groups (matching
// how most file browsers order folders), so it's the primary key, not updatedAt.

// Same accent/case-folding technique as src/domain/deckOrder.ts's normalizedTitle — duplicated
// locally rather than shared, matching that file's own stated reasoning for why.
function normalizedName(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Deliberately NOT localeCompare() — see src/domain/deckOrder.ts's compareNormalizedTitle for
// why (cross-engine collation determinism).
function compareNormalized(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Canonical Deck Collection comparator: normalized name ascending, id ascending as the
 * deterministic tie-breaker (e.g. two collections named identically, or both empty-named from a
 * malformed record).
 */
export function compareDeckCollectionsCanonical(a: DeckCollectionRecord, b: DeckCollectionRecord): number {
  const nameDiff = compareNormalized(normalizedName(a.name), normalizedName(b.name));
  if (nameDiff !== 0) return nameDiff;
  return compareNormalized(a.id, b.id);
}

/** Returns a new, canonically-ordered array — never mutates the input array. */
export function sortDeckCollectionsCanonical(collections: DeckCollectionRecord[]): DeckCollectionRecord[] {
  return [...collections].sort(compareDeckCollectionsCanonical);
}
