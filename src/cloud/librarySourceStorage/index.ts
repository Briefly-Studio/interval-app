import { Directory, File, Paths } from "expo-file-system";
// uploadAsync has no equivalent in the modern expo-file-system API (it only manages local
// files — see src/storage/librarySourceFileStorage.ts's header comment for the full split
// rationale) — the actual network PUT to the presigned S3 URL still goes through the legacy
// module for that reason specifically, not by oversight.
import * as FileSystem from "expo-file-system/legacy";

import { AuthService } from "../../auth/AuthService";
import { updateLibrarySourceCloudState } from "../../storage/librarySources";
import { hasPersistedSourceFile, persistPickedSourceFile } from "../../storage/librarySourceFileStorage";
import { getLocalSourceFile, setLocalSourceFile } from "../../storage/librarySourceLocalFiles";
import type { WorkspaceScope } from "../../storage/workspaceScope";
import { logLibraryFileAttach } from "../../utils/libraryFileAttachLog";
import { isLibrarySourceStorageEnabled } from "./capability";
import {
  getLibrarySourceStorageHttpStatus,
  isLibrarySourceStorageNetworkError,
  requestDownloadUrl,
  requestUploadUrl,
} from "./http";

export { isLibrarySourceStorageEnabled } from "./capability";

// Library UI screens call only these functions — never src/cloud/librarySourceStorage/http.ts or
// AWS/S3 details directly (see docs/library-and-source-architecture.md's "Client architecture"
// section: Library source storage service → authenticated API client → secure backend operation).

async function attemptUpload(
  scope: WorkspaceScope,
  sourceId: string,
  mimeTypeHint: string | undefined
): Promise<void> {
  logLibraryFileAttach("attemptUpload: start");

  if (!isLibrarySourceStorageEnabled()) {
    logLibraryFileAttach("attemptUpload: RETURN — source storage capability disabled for this environment");
    return; // stays "pending" — correct once enabled
  }

  const local = await getLocalSourceFile(scope, sourceId);
  if (!local) {
    logLibraryFileAttach("attemptUpload: RETURN — no local file reference for this source on this device");
    return; // this device never picked a file for this source — nothing to upload
  }

  const accessToken = await AuthService.getAccessToken();
  if (!accessToken) {
    logLibraryFileAttach("attemptUpload: RETURN — no access token (signed out or offline)");
    return; // signed out / offline — stays "pending", retried later
  }

  const mimeType = mimeTypeHint ?? local.mimeType;
  if (!mimeType) {
    logLibraryFileAttach("attemptUpload: MARK failed — no mime type available");
    await updateLibrarySourceCloudState(scope, sourceId, "failed");
    return;
  }

  // Modern File API for this local size check (matches src/storage/librarySourceFileStorage.ts's
  // choice and rationale) — local.uri is always Interval's own durable documentDirectory-based
  // path by this point, never the original picker/cache URI.
  let fileSize: number | undefined;
  try {
    const file = new File(local.uri);
    fileSize = file.exists ? file.size : undefined;
  } catch (error) {
    if (__DEV__) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.warn(`[librarySourceStorage] local file size check failed — ${detail}`);
    }
    fileSize = undefined;
  }
  if (fileSize === undefined) {
    logLibraryFileAttach("attemptUpload: MARK failed — local file missing or unreadable for size check");
    await updateLibrarySourceCloudState(scope, sourceId, "failed");
    return;
  }

  try {
    logLibraryFileAttach("attemptUpload: requesting presigned upload url");
    const { uploadUrl } = await requestUploadUrl(accessToken, sourceId, mimeType, fileSize);
    logLibraryFileAttach("attemptUpload: presigned url received, starting PUT");
    const result = await FileSystem.uploadAsync(uploadUrl, local.uri, {
      httpMethod: "PUT",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { "Content-Type": mimeType },
    });
    logLibraryFileAttach("attemptUpload: PUT completed", { status: result.status });

    if (result.status >= 200 && result.status < 300) {
      logLibraryFileAttach("attemptUpload: MARK uploaded");
      await updateLibrarySourceCloudState(scope, sourceId, "uploaded");
    } else {
      logLibraryFileAttach("attemptUpload: MARK failed — non-2xx PUT status");
      await updateLibrarySourceCloudState(scope, sourceId, "failed");
    }
  } catch (error) {
    if (isLibrarySourceStorageNetworkError(error)) {
      // Couldn't even reach the server — ordinary offline usage, not a real rejection (see
      // http.ts's network/HTTP error split). Left as "pending" for a later retry, never "failed".
      logLibraryFileAttach("attemptUpload: RETURN — network error, left pending for retry");
      return;
    }
    if (__DEV__) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.warn(`[LibraryFileAttach] attemptUpload: MARK failed — non-network error — ${detail}`);
    }
    await updateLibrarySourceCloudState(scope, sourceId, "failed");
  }
}

/**
 * Attaches a locally-picked file to a source. Always resolves without needing connectivity
 * (offline-first — see docs/library-and-source-architecture.md's "Upload flow" section): the
 * picked file (typically still sitting in DocumentPicker's cache-directory copy at this point) is
 * first copied into Interval's own durable, app-owned directory
 * (src/storage/librarySourceFileStorage.ts) — NOT the cache-directory URI the picker returned,
 * which the OS is free to purge at any time while the app isn't running. Only after that durable
 * copy is confirmed does this record cloudUploadState as "pending" and attempt an upload.
 *
 * Returns `false`, and leaves cloudUploadState untouched, if the durable local copy could not be
 * created — this must never be reported as "pending" when there is nothing durable to actually
 * upload. The source's metadata record itself is never touched or destroyed by a failed attach;
 * only the caller UI is expected to surface this via its own return-value check.
 */
export async function attachAndUploadSourceFile(
  scope: WorkspaceScope,
  sourceId: string,
  file: { uri: string; mimeType?: string }
): Promise<boolean> {
  logLibraryFileAttach("attachAndUploadSourceFile: start");

  // This return value is deliberately ONLY about local durable persistence, never about cloud
  // upload — attemptUpload below is fired-and-forgotten and cannot affect it. This was audited
  // specifically because the user-facing alert this return value drives
  // (app/library/add.tsx, app/library/[id]/index.tsx) says "the file couldn't be stored on this
  // device" — showing that alert for a cloud-upload failure after a successful local attach would
  // be actively wrong. Confirmed clean: nothing below this comment can turn a `true` back to
  // `false`.
  const durableUri = await persistPickedSourceFile(sourceId, file.uri);
  logLibraryFileAttach("attachAndUploadSourceFile: local persistence result", { persisted: !!durableUri });
  if (!durableUri) {
    logLibraryFileAttach("attachAndUploadSourceFile: RETURN false — local persistence failed");
    return false;
  }

  try {
    await setLocalSourceFile(scope, sourceId, { uri: durableUri, mimeType: file.mimeType });
    logLibraryFileAttach("attachAndUploadSourceFile: local reference saved");
  } catch (error) {
    // The filesystem copy itself already succeeded at this point — this is a DIFFERENT failure
    // (local bookkeeping, e.g. AsyncStorage), not "the file couldn't be stored on this device".
    // Still returns false (the attach as a whole did not complete — this device won't know where
    // its durable copy is without this reference), but logged distinctly so this is never confused
    // with a filesystem-copy failure when reading diagnostics.
    if (__DEV__) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.warn(`[LibraryFileAttach] attachAndUploadSourceFile: local reference save FAILED — ${detail}`);
    }
    return false;
  }

  try {
    await updateLibrarySourceCloudState(scope, sourceId, "pending");
    logLibraryFileAttach("attachAndUploadSourceFile: cloud state marked pending");
  } catch (error) {
    if (__DEV__) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.warn(`[LibraryFileAttach] attachAndUploadSourceFile: cloud state update FAILED — ${detail}`);
    }
    // The durable local copy and its reference are already saved successfully at this point — the
    // source is genuinely attached locally even though the pending-state write failed. Returning
    // false here would incorrectly tell the user "the file couldn't be stored on this device" for
    // a problem that has nothing to do with the file. Returning true is the accurate signal: local
    // attach succeeded; the cloud-state bookkeeping can catch up on the next sync/retry.
    return true;
  }

  logLibraryFileAttach("attachAndUploadSourceFile: persistence complete, upload attempt starting");
  // Not awaited beyond this function's own return: the durable local copy (the offline-first
  // guarantee) is already secured above, so the network attempt is free to run to completion in
  // the background without making attach/re-attach itself wait on connectivity. attemptUpload
  // never throws (every internal branch resolves), but .catch stays as defense in depth against
  // an unexpected rejection from one of its awaited calls becoming an unhandled rejection.
  attemptUpload(scope, sourceId, file.mimeType).catch(() => {});
  return true;
}

/**
 * Whether THIS device currently has a durable, app-owned local copy of a source's original file —
 * the accurate signal for whether a Retry action can work right now, and for detecting the rare
 * case where a previously-persisted copy has since disappeared unexpectedly. Deliberately checks
 * real disk state (src/storage/librarySourceFileStorage.ts) rather than trusting the presence of
 * an entry in src/storage/librarySourceLocalFiles.ts's map, which only records that a file was
 * once persisted, not that it still is.
 */
export async function isSourceFileAvailableOnThisDevice(sourceId: string): Promise<boolean> {
  return hasPersistedSourceFile(sourceId);
}

/**
 * Retries an upload using whatever local file bytes this device still has cached for this source.
 * Returns false without changing any state if this device never picked a file for this source —
 * only the originating device can (re)upload; a second device only ever sees the resulting
 * cloudUploadState via metadata sync (see src/storage/librarySourceLocalFiles.ts).
 */
export async function retryUploadSourceFile(scope: WorkspaceScope, sourceId: string): Promise<boolean> {
  const local = await getLocalSourceFile(scope, sourceId);
  if (!local) return false;
  await updateLibrarySourceCloudState(scope, sourceId, "pending");
  await attemptUpload(scope, sourceId, local.mimeType);
  return true;
}

/**
 * Confirms (without downloading or persisting anything) that this account's cloud original for a
 * source is currently accessible — used by Source Detail on a device that doesn't have the local
 * file itself. Never persists the returned URL: presigned URLs are temporary transport
 * credentials, not durable identifiers (see docs/library-and-source-architecture.md).
 */
export async function verifyCloudSourceAccessible(sourceId: string): Promise<boolean> {
  if (!isLibrarySourceStorageEnabled()) return false;
  const accessToken = await AuthService.getAccessToken();
  if (!accessToken) return false;
  try {
    await requestDownloadUrl(accessToken, sourceId);
    return true;
  } catch {
    return false;
  }
}

const DOWNLOAD_STAGING_DIR_NAME = "librarySourceDownloads";

function downloadStagingDirectory(): Directory {
  return new Directory(Paths.cache, DOWNLOAD_STAGING_DIR_NAME);
}

// Dev-only, sanitized diagnostic for the source open/download path — deliberately a SEPARATE tag
// from src/utils/libraryFileAttachLog.ts's `[LibraryFileAttach]`, which is temporary
// instrumentation scoped to the earlier attach-failure investigation. This one documents an
// ongoing feature (open/preview) and is fine to remain long-term. Never logs a URL, path, or
// filename — stage names and small booleans/numbers only.
function logSourceOpen(stage: string, detail?: Record<string, unknown>): void {
  if (!__DEV__) return;
  if (detail && Object.keys(detail).length > 0) {
    console.log(`[LibrarySourceOpen] ${stage}`, detail);
  } else {
    console.log(`[LibrarySourceOpen] ${stage}`);
  }
}

export type DownloadSourceOriginalResult =
  | { ok: true; uri: string }
  | { ok: false; reason: "disabled" | "network-error" | "access-denied" | "not-found" | "download-failed" };

/**
 * Downloads this account's cloud original for a source and commits it into Interval's durable,
 * app-owned local directory — the SAME canonical source-id-derived path
 * `attachAndUploadSourceFile` writes to (see src/storage/librarySourceFileStorage.ts), so a
 * cloud-downloaded original becomes indistinguishable from a locally-attached one for every other
 * purpose (Retry, re-attach detection, this function's own future calls). Used by
 * src/cloud/librarySourceStorage/openSource.ts's local-first "open original" resolution — never
 * called automatically by sync; downloading an original only ever happens on an explicit user
 * open action (see docs/library-and-source-architecture.md's "Cloud-downloaded originals" section
 * for the full retention decision).
 *
 * The download is staged in a temporary cache location first and only committed to the durable
 * path via the same idempotent `persistPickedSourceFile` used for local attach — a failed or
 * partial download is never committed, so this can never overwrite a known-good existing durable
 * copy with corrupt/incomplete bytes. The staging copy is removed afterward either way.
 */
export async function downloadSourceOriginal(sourceId: string): Promise<DownloadSourceOriginalResult> {
  logSourceOpen("downloadSourceOriginal: start");

  if (!isLibrarySourceStorageEnabled()) {
    logSourceOpen("downloadSourceOriginal: RETURN — capability disabled");
    return { ok: false, reason: "disabled" };
  }

  const accessToken = await AuthService.getAccessToken();
  if (!accessToken) {
    logSourceOpen("downloadSourceOriginal: RETURN — no access token");
    return { ok: false, reason: "network-error" };
  }

  let downloadUrl: string;
  try {
    logSourceOpen("downloadSourceOriginal: requesting presigned download url");
    const result = await requestDownloadUrl(accessToken, sourceId);
    downloadUrl = result.downloadUrl;
  } catch (error) {
    if (isLibrarySourceStorageNetworkError(error)) {
      logSourceOpen("downloadSourceOriginal: RETURN — network error requesting download url");
      return { ok: false, reason: "network-error" };
    }
    const status = getLibrarySourceStorageHttpStatus(error);
    logSourceOpen("downloadSourceOriginal: download-url request rejected", { status });
    if (status === 401 || status === 403) return { ok: false, reason: "access-denied" };
    if (status === 404) return { ok: false, reason: "not-found" };
    return { ok: false, reason: "download-failed" };
  }

  const stagingDir = downloadStagingDirectory();
  const stagingFile = new File(stagingDir, sourceId);
  try {
    stagingDir.create({ intermediates: true, idempotent: true });
    logSourceOpen("downloadSourceOriginal: staging download started");
    // idempotent: true — overwrite any leftover staging file from a previous interrupted attempt
    // rather than throwing "already exists".
    await File.downloadFileAsync(downloadUrl, stagingFile, { idempotent: true });
    logSourceOpen("downloadSourceOriginal: staging download completed");
  } catch (error) {
    if (__DEV__) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.warn(`[LibrarySourceOpen] downloadSourceOriginal: staging download FAILED — ${detail}`);
    }
    return { ok: false, reason: "download-failed" };
  }

  // Commit through the exact same idempotent local-persistence path local attach uses — a failed
  // commit here (e.g. destination write error) leaves whatever durable copy already existed
  // untouched, never partially overwritten (see persistPickedSourceFile's own delete-then-copy
  // ordering: the destination is only ever deleted once the new copy is confirmed present at the
  // staging path above).
  const committedUri = await persistPickedSourceFile(sourceId, stagingFile.uri);

  try {
    if (stagingFile.exists) stagingFile.delete();
  } catch {
    // Best-effort cleanup only — a leftover staging file is harmless (next download overwrites it
    // via idempotent: true above) and must never surface as a user-facing error.
  }

  if (!committedUri) {
    logSourceOpen("downloadSourceOriginal: RETURN — commit to durable storage failed");
    return { ok: false, reason: "download-failed" };
  }

  logSourceOpen("downloadSourceOriginal: complete");
  return { ok: true, uri: committedUri };
}
