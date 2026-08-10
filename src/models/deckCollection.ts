// Local-only Deck Collection model. NOT the same thing as a Library Source Collection
// (src/models/sourceCollection.ts) — that groups Library sources; this groups decks. See
// docs/deck-collections.md for the full product/architecture rationale, including why this uses
// single-collection-per-deck membership (deckIds lives on the collection) rather than the
// multi-membership model Library Source Collections use.
//
// Deliberately does NOT touch DeckRecord (src/models/deck.ts) in any way — membership is tracked
// here, on the collection, specifically so a deck's own record shape (and therefore its existing
// cloud sync wire format — see src/cloud/sync/SyncService.ts's collectDirty, which pushes the
// entire deck record whenever `dirty`) is completely unaffected by this local-only feature. See
// docs/deck-collections.md's "Why collection-owned membership, not a DeckRecord field" section.

export type DeckCollection = {
  id: string;
  name: string;
  createdAt: string;
  /** Deck IDs currently assigned to this collection. A deck appears in at most one collection's
   * deckIds at a time — see assignDeckToCollection in src/storage/deckCollections.ts. */
  deckIds: string[];
};

export type DeckCollectionRecord = DeckCollection & {
  // rev/updatedAt/dirty exist for future-sync shape-parity only (matching LibrarySourceRecord's
  // own documented convention) — nothing in this batch reads or pushes `dirty` for this entity.
  // See docs/deck-collections.md's "Future cloud sync" section.
  rev: number;
  updatedAt: string;
  deletedAt?: string;
  dirty?: boolean;
};

function normalizeDeckIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return Array.from(new Set(cleaned));
}

// Same defensive-normalization convention as upgradeSourceCollection/upgradeLibrarySource —
// malformed stored records must never crash the app.
export function upgradeDeckCollection(raw: any): DeckCollectionRecord {
  const now = new Date().toISOString();
  const createdAt = typeof raw?.createdAt === "string" && raw.createdAt ? raw.createdAt : now;
  const updatedAt = typeof raw?.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : createdAt;

  return {
    id: typeof raw?.id === "string" && raw.id ? raw.id : "",
    name: typeof raw?.name === "string" ? raw.name : "",
    createdAt,
    deckIds: normalizeDeckIds(raw?.deckIds),
    rev: typeof raw?.rev === "number" ? raw.rev : 0,
    updatedAt,
    deletedAt: typeof raw?.deletedAt === "string" && raw.deletedAt ? raw.deletedAt : undefined,
    dirty: raw?.dirty === true,
  };
}
