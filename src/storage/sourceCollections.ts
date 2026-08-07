import AsyncStorage from "@react-native-async-storage/async-storage";

import type { SourceCollection, SourceCollectionRecord } from "../models/sourceCollection";
import { upgradeSourceCollection } from "../models/sourceCollection";
import { sourceCollectionsKey } from "./libraryKeys";
import { unassignCollectionFromAllSources } from "./librarySources";
import type { WorkspaceScope } from "./workspaceScope";

// Local collection storage — see src/models/sourceCollection.ts. No cloud sync, no automatic
// Canvas/course collections (see docs/library-and-source-architecture.md §16 — that remains
// future work).

export async function getSourceCollections(scope: WorkspaceScope): Promise<SourceCollectionRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(sourceCollectionsKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const upgraded = parsed.map((item) => upgradeSourceCollection(item)).filter((item) => item.id);
    try {
      await setSourceCollections(scope, upgraded);
    } catch {
      // ignore — best-effort write-back of normalized shape
    }
    return upgraded;
  } catch {
    return [];
  }
}

export async function setSourceCollections(
  scope: WorkspaceScope,
  collections: SourceCollectionRecord[]
): Promise<void> {
  await AsyncStorage.setItem(sourceCollectionsKey(scope), JSON.stringify(collections));
}

export async function getActiveSourceCollections(scope: WorkspaceScope): Promise<SourceCollectionRecord[]> {
  const all = await getSourceCollections(scope);
  return all.filter((collection) => !collection.deletedAt);
}

export async function addSourceCollection(
  scope: WorkspaceScope,
  collection: SourceCollection
): Promise<SourceCollectionRecord[]> {
  const all = await getSourceCollections(scope);
  const now = new Date().toISOString();
  const record: SourceCollectionRecord = { ...collection, rev: 1, updatedAt: now, dirty: true };
  const updated = [record, ...all];
  await setSourceCollections(scope, updated);
  return updated;
}

export async function updateSourceCollection(
  scope: WorkspaceScope,
  id: string,
  name: string
): Promise<SourceCollectionRecord[]> {
  const all = await getSourceCollections(scope);
  const now = new Date().toISOString();
  const updated = all.map((collection) => {
    if (collection.id !== id || collection.name === name) return collection;
    return { ...collection, name, updatedAt: now, rev: collection.rev + 1, dirty: true };
  });
  await setSourceCollections(scope, updated);
  return updated;
}

// Deleting a collection must never delete the sources assigned to it — this unassigns the
// collection from every source that referenced it (see
// src/storage/librarySources.ts#unassignCollectionFromAllSources) and only then tombstones the
// collection itself.
export async function softDeleteSourceCollection(
  scope: WorkspaceScope,
  id: string
): Promise<SourceCollectionRecord[]> {
  await unassignCollectionFromAllSources(scope, id);
  const all = await getSourceCollections(scope);
  const now = new Date().toISOString();
  const updated = all.map((collection) => {
    if (collection.id !== id || collection.deletedAt) return collection;
    return { ...collection, deletedAt: now, updatedAt: now, rev: collection.rev + 1, dirty: true };
  });
  await setSourceCollections(scope, updated);
  return updated;
}
