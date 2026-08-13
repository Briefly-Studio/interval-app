import * as FileSystem from "expo-file-system/legacy";

// App-owned persistent local copy of an original Library source file.
//
// WHY THIS EXISTS: every Library file-attach call site uses
// `DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })`. That option copies the picked
// file into `FileSystem.cacheDirectory` — which iOS and Android are both explicitly allowed to
// purge at any time while the app isn't running, especially under storage pressure. That is not a
// durable location for a file that may sit `cloudUploadState: "pending"` for hours or days before
// the user reconnects and retries (see docs/library-and-source-architecture.md's "Local source
// file durability" section). This module copies the picked file, once, into an Interval-owned
// subdirectory of `FileSystem.documentDirectory` — not purged by the OS the way Caches is — keyed
// deterministically by source id, so repeated attach/retry is idempotent and never accumulates
// duplicate copies. `src/storage/librarySourceLocalFiles.ts` stores the resulting durable URI
// (never the original picker/cache URI); this module is what makes that URI actually durable.

const SOURCE_FILES_DIR_NAME = "librarySourceFiles";

// Matches src/utils/id.ts's makeId() output shape (lowercase alnum + underscore). sourceId always
// originates from our own trusted makeId() today, never user input — this check is defense in
// depth, and it is also what keeps a source id from ever being able to smuggle a path-traversal
// segment ("../") into a filesystem path built from it.
const SAFE_SOURCE_ID = /^[a-z0-9_]{1,128}$/;

function sourceFilesDir(): string | null {
  return FileSystem.documentDirectory ? `${FileSystem.documentDirectory}${SOURCE_FILES_DIR_NAME}/` : null;
}

// Deterministic, extension-less destination path. No extension is embedded on purpose: a
// filename that varied by extension (e.g. re-attaching a .docx over a previous .pdf) would leave
// an orphaned copy under the old extension every time the file type changed on re-attach.
// MIME type / original filename are already tracked separately as ordinary metadata on
// LibrarySourceRecord and in the local file-map's `mimeType` field — never derived from this path.
function persistedFileUri(sourceId: string): string | null {
  const dir = sourceFilesDir();
  if (!dir || !SAFE_SOURCE_ID.test(sourceId)) return null;
  return `${dir}${sourceId}`;
}

/**
 * Copies a freshly-picked file (still sitting in DocumentPicker's cache-directory copy at the
 * time this is called) into Interval's own persistent directory, keyed by source id. Idempotent —
 * attaching or retrying for the same source id always overwrites the same destination path, never
 * creates a second copy. Never deletes, moves, or otherwise modifies `pickedUri` itself — this
 * only ever reads from it.
 *
 * Returns the new durable `file://` URI, or `null` if the copy could not be completed (e.g. the
 * picked file no longer exists by the time this runs, or this platform has no document directory
 * at all). Callers MUST treat a `null` return as "no durable local original exists" and must not
 * proceed as though an uploadable file is available — never mark cloudUploadState as "pending" in
 * that case.
 */
export async function persistPickedSourceFile(sourceId: string, pickedUri: string): Promise<string | null> {
  const dir = sourceFilesDir();
  const dest = persistedFileUri(sourceId);
  if (!dir || !dest) return null;

  try {
    const sourceInfo = await FileSystem.getInfoAsync(pickedUri);
    if (!sourceInfo.exists) return null;

    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    // Idempotent overwrite: clear any previous persisted copy for this source id first, so a
    // re-attach can never leave stale trailing bytes behind if the new file happens to be smaller
    // than the old one (copyAsync itself does not guarantee atomic truncate-then-write semantics).
    await FileSystem.deleteAsync(dest, { idempotent: true });
    await FileSystem.copyAsync({ from: pickedUri, to: dest });

    const destInfo = await FileSystem.getInfoAsync(dest);
    return destInfo.exists ? dest : null;
  } catch {
    return null;
  }
}

/**
 * True if this device currently has bytes at the source's expected persisted path. Used both to
 * decide whether a Retry action can work, and to detect the rare case where an app-owned
 * persisted copy has itself disappeared unexpectedly (e.g. the user cleared app storage some
 * other way) — see docs/library-and-source-architecture.md's "Failure semantics" for why this is
 * checked freshly rather than trusted from stale local-map state.
 */
export async function hasPersistedSourceFile(sourceId: string): Promise<boolean> {
  const dest = persistedFileUri(sourceId);
  if (!dest) return false;
  try {
    const info = await FileSystem.getInfoAsync(dest);
    return info.exists;
  } catch {
    return false;
  }
}

/** Removes this device's persisted copy, if any. Safe to call even if none exists. */
export async function removePersistedSourceFile(sourceId: string): Promise<void> {
  const dest = persistedFileUri(sourceId);
  if (!dest) return;
  try {
    await FileSystem.deleteAsync(dest, { idempotent: true });
  } catch {
    // Best-effort cleanup only — never let a failed delete surface as a user-facing error.
  }
}
