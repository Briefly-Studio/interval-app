import { Directory, File, Paths } from "expo-file-system";

import { logLibraryFileAttach } from "../utils/libraryFileAttachLog";

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
// API CHOICE — modern `expo-file-system` (NOT `expo-file-system/legacy`): see
// docs/library-and-source-architecture.md's "Local file URI rule and local source file
// durability" for the full history of why. Short version: the legacy Promise-based API depends on
// a native module that isn't guaranteed present on every runtime; the modern synchronous
// Directory/File/Paths classes fully cover everything this module needs with no functional gap.

const SOURCE_FILES_DIR_NAME = "librarySourceFiles";

// Matches the REAL canonical id shape this app actually generates — `src/models/deck.ts`'s
// `makeId()` (the one every id-generating call site in this repo imports, Library sources
// included: `app/library/add.tsx` creates a source with `id: makeId()` from that exact module),
// which produces `<base36 timestamp>-<base36 random>` (lowercase alphanumeric plus exactly one
// hyphen — e.g. "mst3f9k2-8h2p1qte"). A previous version of this pattern
// (`^[a-z0-9_]{1,128}$`, no hyphen) was copied from an assumption about a *different*,
// underscore-based `makeId()` in src/utils/id.ts that is not actually used anywhere in this app —
// it rejected every real Library source id outright, which was the actual root cause of a
// founder-QA "Couldn't attach file" failure traced here. Still deliberately narrow: lowercase
// alphanumeric and hyphen only, still exactly what keeps a source id from ever being able to
// smuggle a path-traversal segment ("../") or arbitrary characters into a filesystem path built
// from it.
const SAFE_SOURCE_ID = /^[a-z0-9-]{1,128}$/;

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
 * Copies a local file (still sitting at `pickedUri`) into Interval's own persistent directory,
 * keyed by source id. Idempotent — calling this again for the same source id always overwrites
 * the same destination path, never creates a second copy. Never deletes, moves, or otherwise
 * modifies `pickedUri` itself — this only ever reads from it.
 *
 * Two callers, same underlying operation: `src/cloud/librarySourceStorage/index.ts`'s
 * `attachAndUploadSourceFile` (`pickedUri` is DocumentPicker's cache-directory copy) and
 * `downloadSourceOriginal` (`pickedUri` is a just-downloaded cloud original sitting in a
 * temporary staging location — see that function for why re-using this exact commit step,
 * instead of a second copy of the idempotent-copy logic, was the deliberate choice).
 *
 * Returns the new durable `file://` URI, or `null` if the copy could not be completed (e.g. the
 * source file no longer exists by the time this runs, or an unexpected filesystem error occurred
 * — see Metro/console in development for the sanitized diagnostic, which always states exactly
 * why `null` was returned). Callers MUST treat a `null` return as "no durable local original
 * exists" and must not proceed as though a usable file is available — never mark
 * cloudUploadState as "pending" in that case.
 */
export async function persistPickedSourceFile(sourceId: string, pickedUri: string): Promise<string | null> {
  logLibraryFileAttach("persistPickedSourceFile: start");

  try {
    const idValid = SAFE_SOURCE_ID.test(sourceId);
    logLibraryFileAttach("persistPickedSourceFile: source id validation", { valid: idValid });
    if (!idValid) {
      logLibraryFileAttach("persistPickedSourceFile: REJECTED — source id failed SAFE_SOURCE_ID pattern");
      return null;
    }

    const documentPathAvailable = !!Paths.document;
    logLibraryFileAttach("persistPickedSourceFile: document path available", { available: documentPathAvailable });

    const dest = new File(sourceFilesDirectory(), sourceId);
    logLibraryFileAttach("persistPickedSourceFile: destination file object created");

    const source = new File(pickedUri);
    logLibraryFileAttach("persistPickedSourceFile: source file object created");

    const sourceExists = source.exists;
    logLibraryFileAttach("persistPickedSourceFile: source exists check", { exists: sourceExists });
    if (!sourceExists) {
      logLibraryFileAttach("persistPickedSourceFile: REJECTED — picked source file does not exist");
      return null;
    }

    const dir = sourceFilesDirectory();
    logLibraryFileAttach("persistPickedSourceFile: directory object created");
    // idempotent: true — do not throw if this directory already exists (the common case for every
    // attach/retry after the first). intermediates: true — create the Documents directory itself
    // if it somehow doesn't exist yet.
    dir.create({ intermediates: true, idempotent: true });
    logLibraryFileAttach("persistPickedSourceFile: directory ensured");

    // Idempotent overwrite: clear any previous persisted copy for this source id first, so a
    // re-attach can never leave stale trailing bytes behind if the new file happens to be smaller
    // than the old one, and so File.copy never throws on an "already exists" destination.
    if (dest.exists) {
      dest.delete();
      logLibraryFileAttach("persistPickedSourceFile: prior destination handled (deleted)");
    } else {
      logLibraryFileAttach("persistPickedSourceFile: prior destination handled (none existed)");
    }

    logLibraryFileAttach("persistPickedSourceFile: copy started");
    source.copy(dest);
    logLibraryFileAttach("persistPickedSourceFile: copy completed");

    const destExists = dest.exists;
    logLibraryFileAttach("persistPickedSourceFile: destination exists", { exists: destExists });
    if (!destExists) {
      logLibraryFileAttach("persistPickedSourceFile: REJECTED — destination missing after copy");
      return null;
    }

    logLibraryFileAttach("persistPickedSourceFile: persistence complete");
    return dest.uri;
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

/**
 * The durable `file://` URI for this source, or `null` if this device doesn't have a persisted
 * copy. Used by the "open original" flow to resolve a local file before ever considering a cloud
 * download — see src/cloud/librarySourceStorage/openSource.ts.
 */
export async function getPersistedSourceFileUri(sourceId: string): Promise<string | null> {
  try {
    const dest = persistedFile(sourceId);
    if (!dest || !dest.exists) return null;
    return dest.uri;
  } catch (error) {
    logPersistenceError("getPersistedSourceFileUri", error);
    return null;
  }
}

const VIEWER_COPY_DIR_NAME = "librarySourceViewerCopies";

// Extension charset kept intentionally tiny. This is only ever called with a value from
// src/domain/sourceViewer.ts's own small, hardcoded SourceType/MIME → extension table — never
// from an original filename or other user-controlled input (see that file for why: OS viewers key
// off the file extension, but blindly trusting an arbitrary original filename's extension would
// let unvalidated text reach a filesystem path). Still validated here too, defensively, matching
// SAFE_SOURCE_ID's own "defense in depth" reasoning — this function must never be usable to
// construct an arbitrary path even if a future caller passes something unexpected.
const SAFE_EXTENSION = /^[a-z0-9]{1,10}$/;

function viewerCopyDirectory(): Directory {
  return new Directory(Paths.cache, VIEWER_COPY_DIR_NAME);
}

/**
 * Creates (or refreshes) a viewer-only staging copy of this source's durable original, named
 * `<sourceId>.<extension>` inside a Cache-based directory — never the canonical durable storage,
 * never synced, safe to let the OS purge. Exists purely because OS-native viewers (iOS Quick
 * Look/share sheet, Android's viewer chooser) determine file type primarily from the file
 * extension on the URL itself, not just the MIME/UTI hints passed alongside it — see
 * src/domain/sourceViewer.ts for the full incident record (founder QA proved the extensionless
 * canonical path alone was insufficient) and how `extension` is chosen safely.
 *
 * Idempotent and non-duplicating: any other file already staged for this exact source id (under
 * any extension, e.g. left over from a re-attach that changed file type) is removed first, so at
 * most one viewer copy ever exists per source id. Never modifies the canonical durable file —
 * this only ever reads from it. Returns `null` if there is no durable original to copy from, the
 * id/extension fail validation, or the copy fails for any reason (see Metro/console in
 * development for the sanitized diagnostic).
 */
export async function prepareViewerCopy(sourceId: string, extension: string): Promise<string | null> {
  try {
    if (!SAFE_SOURCE_ID.test(sourceId) || !SAFE_EXTENSION.test(extension)) return null;

    const source = persistedFile(sourceId);
    if (!source || !source.exists) return null;

    const dir = viewerCopyDirectory();
    dir.create({ intermediates: true, idempotent: true });

    try {
      for (const entry of dir.list()) {
        if ("name" in entry && entry.name.startsWith(`${sourceId}.`)) {
          entry.delete();
        }
      }
    } catch {
      // Best-effort cleanup of stale viewer copies under a different extension — never block the
      // actual copy below over this.
    }

    const dest = new File(dir, `${sourceId}.${extension}`);
    if (dest.exists) dest.delete();
    source.copy(dest);

    return dest.exists ? dest.uri : null;
  } catch (error) {
    logPersistenceError("prepareViewerCopy", error);
    return null;
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
