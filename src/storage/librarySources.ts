import AsyncStorage from "@react-native-async-storage/async-storage";

import type { LibrarySource, LibrarySourceRecord } from "../models/librarySource";
import { upgradeLibrarySource } from "../models/librarySource";
import { librarySourcesKey } from "./libraryKeys";
import type { WorkspaceScope } from "./workspaceScope";

// Local Library source metadata storage — see src/models/librarySource.ts for what a record is
// (and is not). No AWS calls, no cloud Library sync, no file content anywhere in this module.
// Never log a source's title, filename, tags, course, or semester — only counts/ids where
// diagnostics are genuinely needed (matching the existing "never log study content" convention
// in src/storage/decks.ts and docs/accessibility-foundation.md).

export async function getLibrarySources(scope: WorkspaceScope): Promise<LibrarySourceRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(librarySourcesKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const upgraded = parsed.map((item) => upgradeLibrarySource(item)).filter((item) => item.id);
    try {
      await setLibrarySources(scope, upgraded);
    } catch {
      // ignore — best-effort write-back of normalized shape, same convention as getDecksAll
    }
    return upgraded;
  } catch {
    return [];
  }
}

export async function setLibrarySources(scope: WorkspaceScope, sources: LibrarySourceRecord[]): Promise<void> {
  await AsyncStorage.setItem(librarySourcesKey(scope), JSON.stringify(sources));
}

export async function getActiveLibrarySources(scope: WorkspaceScope): Promise<LibrarySourceRecord[]> {
  const all = await getLibrarySources(scope);
  return all.filter((source) => !source.archivedAt && !source.deletedAt);
}

export async function getArchivedLibrarySources(scope: WorkspaceScope): Promise<LibrarySourceRecord[]> {
  const all = await getLibrarySources(scope);
  return all.filter((source) => !!source.archivedAt && !source.deletedAt);
}

export async function getDeletedLibrarySources(scope: WorkspaceScope): Promise<LibrarySourceRecord[]> {
  const all = await getLibrarySources(scope);
  return all.filter((source) => !!source.deletedAt);
}

export async function addLibrarySource(
  scope: WorkspaceScope,
  source: LibrarySource
): Promise<LibrarySourceRecord[]> {
  const all = await getLibrarySources(scope);
  const now = new Date().toISOString();
  const record: LibrarySourceRecord = {
    ...source,
    rev: 1,
    updatedAt: now,
    dirty: true,
  };
  const updated = [record, ...all];
  await setLibrarySources(scope, updated);
  return updated;
}

// Applies a partial edit to an existing source, bumping rev/updatedAt/dirty and refreshing
// lastUsedAt — editing a source's own metadata is treated as the one real "use" signal this
// foundation has (there is no study/generation integration yet to derive it from honestly; see
// docs/library-ui-foundation.md's known limitations). Viewing source detail does NOT update
// lastUsedAt — only an actual saved edit does.
export async function updateLibrarySource(
  scope: WorkspaceScope,
  id: string,
  patch: Partial<LibrarySource>
): Promise<LibrarySourceRecord[]> {
  const all = await getLibrarySources(scope);
  const now = new Date().toISOString();
  const updated = all.map((source) => {
    if (source.id !== id) return source;
    return {
      ...source,
      ...patch,
      updatedAt: now,
      lastUsedAt: now,
      rev: source.rev + 1,
      dirty: true,
    };
  });
  await setLibrarySources(scope, updated);
  return updated;
}

export async function archiveLibrarySource(scope: WorkspaceScope, id: string): Promise<LibrarySourceRecord[]> {
  const all = await getLibrarySources(scope);
  const now = new Date().toISOString();
  const updated = all.map((source) => {
    if (source.id !== id || source.archivedAt) return source;
    return {
      ...source,
      archivedAt: now,
      processingStatus: "archived" as const,
      updatedAt: now,
      rev: source.rev + 1,
      dirty: true,
    };
  });
  await setLibrarySources(scope, updated);
  return updated;
}

// Restores a source from either archived or (soft-)deleted state — whichever applies. A single
// restore entry point is enough for this foundation: "Restore" in Source Detail (un-archive) and
// "Restore" in the Library Recently Deleted screen (undo a delete) both call this.
//
// A source can be both archived AND deleted at once (Source Detail's Delete action is reachable
// from an archived source too — there is no UI path back the other way, so `deletedAt` is always
// the more recent state when both are set). Restoring must therefore undo only the most recent
// transition: if `deletedAt` is set, clear only that (returning the source to whatever it was
// before deletion — active or archived); only when `deletedAt` is already clear does restoring
// mean un-archiving. Clearing both unconditionally would silently drop an archived source's
// archived state the moment it was also deleted-then-restored.
export async function restoreLibrarySource(scope: WorkspaceScope, id: string): Promise<LibrarySourceRecord[]> {
  const all = await getLibrarySources(scope);
  const now = new Date().toISOString();
  const updated = all.map((source) => {
    if (source.id !== id) return source;
    if (!source.archivedAt && !source.deletedAt) return source;

    if (source.deletedAt) {
      return { ...source, deletedAt: undefined, updatedAt: now, rev: source.rev + 1, dirty: true };
    }
    return {
      ...source,
      archivedAt: undefined,
      processingStatus: source.processingStatus === "archived" ? ("ready" as const) : source.processingStatus,
      updatedAt: now,
      rev: source.rev + 1,
      dirty: true,
    };
  });
  await setLibrarySources(scope, updated);
  return updated;
}

// Soft-delete tombstone — mirrors the DeckRecord/CardRecord `deletedAt` pattern
// (docs/sync-invariants.md). This is LOCAL-ONLY: there is no cloud Library record to purge, and
// this must never be described in UI copy as deleting an original file, because no file has ever
// been imported by this foundation.
export async function softDeleteLibrarySource(scope: WorkspaceScope, id: string): Promise<LibrarySourceRecord[]> {
  const all = await getLibrarySources(scope);
  const now = new Date().toISOString();
  const updated = all.map((source) => {
    if (source.id !== id || source.deletedAt) return source;
    return {
      ...source,
      deletedAt: now,
      updatedAt: now,
      rev: source.rev + 1,
      dirty: true,
    };
  });
  await setLibrarySources(scope, updated);
  return updated;
}

// Metadata-only cleanup: permanently removes a source record from local storage (no trash, no
// restore). Used only by the dev-only Library fixture reset (see src/domain/librarySeed.ts) —
// production UI in this foundation always goes through softDeleteLibrarySource instead, so a
// user's deletion is always restorable via the Library Recently Deleted screen.
export async function permanentlyRemoveLocalLibrarySource(
  scope: WorkspaceScope,
  id: string
): Promise<LibrarySourceRecord[]> {
  const all = await getLibrarySources(scope);
  const updated = all.filter((source) => source.id !== id);
  await setLibrarySources(scope, updated);
  return updated;
}

// Removes a source from a single collection's assignment without affecting the source's other
// collection memberships or the collection's other sources. Used by Collection Detail's "Remove
// from collection" action.
export async function removeLibrarySourceFromCollection(
  scope: WorkspaceScope,
  sourceId: string,
  collectionId: string
): Promise<LibrarySourceRecord[]> {
  const all = await getLibrarySources(scope);
  const now = new Date().toISOString();
  const updated = all.map((source) => {
    if (source.id !== sourceId || !source.collectionIds.includes(collectionId)) return source;
    return {
      ...source,
      collectionIds: source.collectionIds.filter((id) => id !== collectionId),
      updatedAt: now,
      rev: source.rev + 1,
      dirty: true,
    };
  });
  await setLibrarySources(scope, updated);
  return updated;
}

// Cloud upload-state transition — see src/cloud/librarySourceStorage/index.ts, the only intended
// caller. Deliberately does NOT touch lastUsedAt the way updateLibrarySource does: this is a
// background, system-driven state change (an upload attempt succeeding/failing), not a user edit,
// so it should not count as "using" the source the way an intentional metadata edit does. Still
// bumps rev/dirty like every other mutation here — this state is durable, cross-device shared
// state (see LibrarySourceRecord's cloudUploadState field comment) and must sync like any other
// change.
export async function updateLibrarySourceCloudState(
  scope: WorkspaceScope,
  id: string,
  state: NonNullable<LibrarySourceRecord["cloudUploadState"]>
): Promise<LibrarySourceRecord[]> {
  const all = await getLibrarySources(scope);
  const now = new Date().toISOString();
  const updated = all.map((source) => {
    if (source.id !== id) return source;
    return {
      ...source,
      cloudUploadState: state,
      cloudUploadedAt: state === "uploaded" ? now : source.cloudUploadedAt,
      updatedAt: now,
      rev: source.rev + 1,
      dirty: true,
    };
  });
  await setLibrarySources(scope, updated);
  return updated;
}

// Unassigns a deleted collection from every source that referenced it, without touching the
// sources themselves otherwise. Used by deleteSourceCollection — see src/storage/sourceCollections.ts.
export async function unassignCollectionFromAllSources(
  scope: WorkspaceScope,
  collectionId: string
): Promise<LibrarySourceRecord[]> {
  const all = await getLibrarySources(scope);
  const now = new Date().toISOString();
  const updated = all.map((source) => {
    if (!source.collectionIds.includes(collectionId)) return source;
    return {
      ...source,
      collectionIds: source.collectionIds.filter((id) => id !== collectionId),
      updatedAt: now,
      rev: source.rev + 1,
      dirty: true,
    };
  });
  await setLibrarySources(scope, updated);
  return updated;
}
