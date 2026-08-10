import AsyncStorage from "@react-native-async-storage/async-storage";

import type { DeckCollection, DeckCollectionRecord } from "../models/deckCollection";
import { upgradeDeckCollection } from "../models/deckCollection";
import { deckCollectionsKey } from "./deckCollectionKeys";
import type { WorkspaceScope } from "./workspaceScope";

// Local Deck Collection storage — see src/models/deckCollection.ts. No cloud sync in this
// batch (see docs/deck-collections.md's "Future cloud sync" section). Deliberately never reads
// or writes src/storage/decks.ts — membership lives entirely on the collection side
// (DeckCollectionRecord.deckIds), so DeckRecord and its existing sync wire format are untouched.

export async function getDeckCollections(scope: WorkspaceScope): Promise<DeckCollectionRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(deckCollectionsKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const upgraded = parsed.map((item) => upgradeDeckCollection(item)).filter((item) => item.id);
    try {
      await setDeckCollections(scope, upgraded);
    } catch {
      // ignore — best-effort write-back of normalized shape
    }
    return upgraded;
  } catch {
    return [];
  }
}

export async function setDeckCollections(
  scope: WorkspaceScope,
  collections: DeckCollectionRecord[]
): Promise<void> {
  await AsyncStorage.setItem(deckCollectionsKey(scope), JSON.stringify(collections));
}

export async function getActiveDeckCollections(scope: WorkspaceScope): Promise<DeckCollectionRecord[]> {
  const all = await getDeckCollections(scope);
  return all.filter((collection) => !collection.deletedAt);
}

export async function addDeckCollection(
  scope: WorkspaceScope,
  collection: DeckCollection
): Promise<DeckCollectionRecord[]> {
  const all = await getDeckCollections(scope);
  const now = new Date().toISOString();
  const record: DeckCollectionRecord = { ...collection, rev: 1, updatedAt: now, dirty: true };
  const updated = [record, ...all];
  await setDeckCollections(scope, updated);
  return updated;
}

export async function renameDeckCollection(
  scope: WorkspaceScope,
  id: string,
  name: string
): Promise<DeckCollectionRecord[]> {
  const all = await getDeckCollections(scope);
  const now = new Date().toISOString();
  const updated = all.map((collection) => {
    if (collection.id !== id || collection.name === name) return collection;
    return { ...collection, name, updatedAt: now, rev: collection.rev + 1, dirty: true };
  });
  await setDeckCollections(scope, updated);
  return updated;
}

// Deleting a collection must never delete its decks — this only tombstones the collection and
// clears its own deckIds. Unlike Library Source Collections (where membership lives on the
// source and must be swept from every source individually), no other record references a Deck
// Collection at all, so no cross-record cleanup is needed: clearing deletedAt-filtered visibility
// is by itself sufficient for every deck in it to read back as unassigned.
export async function softDeleteDeckCollection(
  scope: WorkspaceScope,
  id: string
): Promise<DeckCollectionRecord[]> {
  const all = await getDeckCollections(scope);
  const now = new Date().toISOString();
  const updated = all.map((collection) => {
    if (collection.id !== id || collection.deletedAt) return collection;
    return { ...collection, deckIds: [], deletedAt: now, updatedAt: now, rev: collection.rev + 1, dirty: true };
  });
  await setDeckCollections(scope, updated);
  return updated;
}

/** Which active collection (if any) currently contains this deck. */
export async function getCollectionIdForDeck(
  scope: WorkspaceScope,
  deckId: string
): Promise<string | null> {
  const active = await getActiveDeckCollections(scope);
  return active.find((collection) => collection.deckIds.includes(deckId))?.id ?? null;
}

/** Builds a full deckId -> collectionId map in one pass, for screens (Home) that need to bucket
 * every deck by collection at once rather than looking each one up individually. */
export async function getDeckCollectionMembershipMap(
  scope: WorkspaceScope
): Promise<Map<string, string>> {
  const active = await getActiveDeckCollections(scope);
  const map = new Map<string, string>();
  for (const collection of active) {
    for (const deckId of collection.deckIds) {
      map.set(deckId, collection.id);
    }
  }
  return map;
}

// Enforces single-collection-per-deck: removes deckId from every other active collection before
// adding it to the target. A no-op (still writes, but no observable change) if the deck is
// already the target collection's only membership.
export async function assignDeckToCollection(
  scope: WorkspaceScope,
  deckId: string,
  collectionId: string
): Promise<DeckCollectionRecord[]> {
  const all = await getDeckCollections(scope);
  const now = new Date().toISOString();
  const updated = all.map((collection) => {
    if (collection.deletedAt) return collection;

    if (collection.id === collectionId) {
      if (collection.deckIds.includes(deckId)) return collection;
      return {
        ...collection,
        deckIds: [...collection.deckIds, deckId],
        updatedAt: now,
        rev: collection.rev + 1,
        dirty: true,
      };
    }

    if (!collection.deckIds.includes(deckId)) return collection;
    return {
      ...collection,
      deckIds: collection.deckIds.filter((id) => id !== deckId),
      updatedAt: now,
      rev: collection.rev + 1,
      dirty: true,
    };
  });
  await setDeckCollections(scope, updated);
  return updated;
}

/** Removes a deck from whichever active collection currently holds it, if any. Safe to call for
 * an already-unassigned deck (no-op). */
export async function unassignDeckFromCollection(
  scope: WorkspaceScope,
  deckId: string
): Promise<DeckCollectionRecord[]> {
  const all = await getDeckCollections(scope);
  const now = new Date().toISOString();
  const updated = all.map((collection) => {
    if (collection.deletedAt || !collection.deckIds.includes(deckId)) return collection;
    return {
      ...collection,
      deckIds: collection.deckIds.filter((id) => id !== deckId),
      updatedAt: now,
      rev: collection.rev + 1,
      dirty: true,
    };
  });
  await setDeckCollections(scope, updated);
  return updated;
}

/**
 * Explicit "Move to collection" operation — see docs/deck-collections.md's interaction model
 * ("Add never implicitly moves a deck between collections"; moving is its own, separate,
 * explicit action). Semantically identical to `assignDeckToCollection` (single membership was
 * always enforced by removing the deck from every other active collection in the same write),
 * but named for, and reserved for, the explicit "Move to collection" UI flow — `assignDeckToCollection`
 * remains the one place that logic actually lives, so this is a thin, self-documenting alias, not
 * a second implementation.
 */
export async function moveDeckToCollection(
  scope: WorkspaceScope,
  deckId: string,
  targetCollectionId: string
): Promise<DeckCollectionRecord[]> {
  return assignDeckToCollection(scope, deckId, targetCollectionId);
}
