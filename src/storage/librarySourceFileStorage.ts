import { Directory, File, Paths } from "expo-file-system";

// App-owned persistent local copy of an original Library source file.
//
// WHY THIS EXISTS: every Library file-attach call site uses
// `DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })`. That option copies the picked
// file into the OS cache directory — which iOS and Android are both explicitly allowed to purge at
// any time while the app isn't running, especially under storage pressure. That is not a durable
// location for a file that may sit `cloudUploadState: "pending"` for hours or days before the user
// reconnects and retries (see docs/library-and-source-architecture.md's "Local source file
// durability" section). This module copies the picked file, once, into an Interval-owned
// subdirectory of the app's Documents directory — not purged by the OS the way Caches is — keyed
// deterministically by source id, so repeated attach/retry is idempotent and never accumulates
// duplicate copies. `src/storage/librarySourceLocalFiles.ts` stores the resulting durable URI
// (never the original picker/cache URI); this module is what makes that URI actually durable.
//
// API CHOICE — modern `expo-file-system` (NOT `expo-file-system/legacy`): this repo's installed
// expo-file-system (~19.0.21, Expo SDK ~54) ships two parallel APIs from two DIFFERENT native
// modules — the modern synchronous `Directory`/`File`/`Paths` classes (native module "FileSystem"),
// and the older Promise-based `getInfoAsync`/`copyAsync`/`makeDirectoryAsync`/`deleteAsync`
// functions (native module "ExponentFileSystem", imported from the `/legacy` subpath). A device
// runtime that doesn't fully support the legacy native module falls back to a JS shim
// (`ExponentFileSystemShim`) whose directory constants are `null` and whose file-manipulation
// methods don't exist at all — the exact class of failure this module was rewritten to avoid,
// after a founder-QA runtime failure was traced here. The modern File/Directory/Paths API fully
// and cleanly covers everything this module needs (directory creation, existence checks, copy,
// delete) with no functional gap, so it is used exclusively here. It has no equivalent for
// network upload, however — `src/cloud/librarySourceStorage/index.ts` still uses
// `expo-file-system/legacy`'s `uploadAsync` for the actual S3 PUT, which is a different concern
// (network transport, not local file management) with no modern replacement; that is a deliberate,
// documented split, not accidental mixing of the two APIs for the same job.

const SOURCE_FILES_DIR_NAME = "librarySourceFiles";

// Matches src/utils/id.ts's makeId() output shape (lowercase alnum + underscore). sourceId always
// originates from our own trusted makeId() today, never user input — this check is defense in
// depth, and it is also what keeps a source id from ever being able to smuggle a path-traversal
// segment ("../") into a filesystem path built from it.
const SAFE_SOURCE_ID = /^[a-z0-9_]{1,128}$/;

function sourceFilesDirectory(): Directory {
  return new Directory(Paths.document, SOURCE_FILES_DIR_NAME);
}

// Deterministic, extension-less destination file reference. No extension is embedded on purpose:
// a filename that varied by extension (e.g. re-attaching a .docx over a previous .pdf) would leave
// an orphaned copy under the old extension every time the file type changed on re-attach. MIME
// type / original filename are already tracked separately as ordinary metadata on
// LibrarySourceRecord and in the local file-map's `mimeType` field — never derived from this path.
// `new File(...)` never touches the filesystem or throws for a path that doesn't exist yet — safe
// to construct unconditionally.
function persistedFile(sourceId: string): File | null {
  if (!SAFE_SOURCE_ID.test(sourceId)) return null;
  return new File(sourceFilesDirectory(), sourceId);
}

// Dev-only, sanitized diagnostic. Logs which operation failed and the underlying error's
// name/message only — never a full filesystem path, the original picked filename, or any other
// value that could be considered a private local detail. Safe to leave enabled; never surfaced in
// any user-facing UI or Dev Tools screen (see CLAUDE.md's Dev Tools diagnostics guardrail).
function logPersistenceError(operation: string, error: unknown): void {
  if (!__DEV__) return;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.warn(`[librarySourceFileStorage] ${operation} failed — ${detail}`);
}

/**
 * Copies a freshly-picked file (still sitting in DocumentPicker's cache-directory copy at the
 * time this is called) into Interval's own persistent directory, keyed by source id. Idempotent —
 * attaching or retrying for the same source id always overwrites the same destination path, never
 * creates a second copy. Never deletes, moves, or otherwise modifies `pickedUri` itself — this
 * only ever reads from it.
 *
 * Returns the new durable `file://` URI, or `null` if the copy could not be completed (e.g. the
 * picked file no longer exists by the time this runs, or an unexpected filesystem error occurred
 * — see Metro/console in development for the sanitized diagnostic). Callers MUST treat a `null`
 * return as "no durable local original exists" and must not proceed as though an uploadable file
 * is available — never mark cloudUploadState as "pending" in that case.
 */
export async function persistPickedSourceFile(sourceId: string, pickedUri: string): Promise<string | null> {
  try {
    const dest = persistedFile(sourceId);
    if (!dest) return null;

    const source = new File(pickedUri);
    if (!source.exists) return null;

    const dir = sourceFilesDirectory();
    // idempotent: true — do not throw if this directory already exists (the common case for every
    // attach/retry after the first). intermediates: true — create the Documents directory itself
    // if it somehow doesn't exist yet.
    dir.create({ intermediates: true, idempotent: true });

    // Idempotent overwrite: clear any previous persisted copy for this source id first, so a
    // re-attach can never leave stale trailing bytes behind if the new file happens to be smaller
    // than the old one, and so File.copy never throws on an "already exists" destination.
    if (dest.exists) dest.delete();
    source.copy(dest);

    return dest.exists ? dest.uri : null;
  } catch (error) {
    logPersistenceError("persistPickedSourceFile", error);
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
  try {
    const dest = persistedFile(sourceId);
    return dest ? dest.exists : false;
  } catch (error) {
    logPersistenceError("hasPersistedSourceFile", error);
    return false;
  }
}

/** Removes this device's persisted copy, if any. Safe to call even if none exists. */
export async function removePersistedSourceFile(sourceId: string): Promise<void> {
  try {
    const dest = persistedFile(sourceId);
    if (dest?.exists) dest.delete();
  } catch (error) {
    logPersistenceError("removePersistedSourceFile", error);
    // Best-effort cleanup only — never let a failed delete surface as a user-facing error.
  }
}
