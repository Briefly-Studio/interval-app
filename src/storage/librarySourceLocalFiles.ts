import AsyncStorage from "@react-native-async-storage/async-storage";

import type { WorkspaceScope } from "./workspaceScope";
import { scopedKey } from "./workspaceScope";

// DEVICE-LOCAL ONLY — never add these fields to LibrarySourceRecord (src/models/librarySource.ts)
// or route them through src/cloud/sync/**. A file:// URI, an Expo document-picker cache URI, or
// any other on-device filesystem path is meaningless (or actively wrong) on any other device —
// and src/cloud/sync/SyncService.ts's collectDirty pushes a record's ENTIRE field set verbatim,
// so anything added to LibrarySourceRecord itself would leak straight into every push regardless
// of intent. This module exists specifically so that boundary can never be crossed by accident:
// it is a completely separate storage key, untouched by getLibrarySources/setLibrarySources and
// by every sync code path. See docs/library-and-source-architecture.md's "Local file URI rule".

const LOCAL_FILES_KEY = "interval.librarySourceLocalFiles.v1";

const localFilesKey = (scope: WorkspaceScope) => scopedKey(scope, LOCAL_FILES_KEY);

export type LocalSourceFile = {
  uri: string;
  mimeType?: string;
  recordedAt: string;
};

type LocalFileMap = Record<string, LocalSourceFile>;

async function readMap(scope: WorkspaceScope): Promise<LocalFileMap> {
  try {
    const raw = await AsyncStorage.getItem(localFilesKey(scope));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeMap(scope: WorkspaceScope, map: LocalFileMap): Promise<void> {
  await AsyncStorage.setItem(localFilesKey(scope), JSON.stringify(map));
}

// Recorded the moment a user picks a file for a source, before any network attempt — this is
// what lets source creation/attachment stay fully offline-first (see "Upload flow" in
// docs/library-and-source-architecture.md).
export async function setLocalSourceFile(
  scope: WorkspaceScope,
  sourceId: string,
  file: { uri: string; mimeType?: string }
): Promise<void> {
  const map = await readMap(scope);
  map[sourceId] = { uri: file.uri, mimeType: file.mimeType, recordedAt: new Date().toISOString() };
  await writeMap(scope, map);
}

// Null on any device that never picked a file for this source locally — including a second
// device that only knows about the source via metadata sync. Callers must treat that as "this
// device cannot upload/retry for this source", never as an error.
export async function getLocalSourceFile(scope: WorkspaceScope, sourceId: string): Promise<LocalSourceFile | null> {
  const map = await readMap(scope);
  return map[sourceId] ?? null;
}

export async function clearLocalSourceFile(scope: WorkspaceScope, sourceId: string): Promise<void> {
  const map = await readMap(scope);
  if (!(sourceId in map)) return;
  delete map[sourceId];
  await writeMap(scope, map);
}
