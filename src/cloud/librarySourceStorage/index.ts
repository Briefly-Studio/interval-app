import { File } from "expo-file-system";
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
import { isLibrarySourceStorageEnabled } from "./capability";
import {
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
  if (!isLibrarySourceStorageEnabled()) return; // stays "pending" — correct once enabled

  const local = await getLocalSourceFile(scope, sourceId);
  if (!local) return; // this device never picked a file for this source — nothing to upload

  const accessToken = await AuthService.getAccessToken();
  if (!accessToken) return; // signed out / offline — stays "pending", retried later

  const mimeType = mimeTypeHint ?? local.mimeType;
  if (!mimeType) {
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
    await updateLibrarySourceCloudState(scope, sourceId, "failed");
    return;
  }

  try {
    const { uploadUrl } = await requestUploadUrl(accessToken, sourceId, mimeType, fileSize);
    const result = await FileSystem.uploadAsync(uploadUrl, local.uri, {
      httpMethod: "PUT",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { "Content-Type": mimeType },
    });

    if (result.status >= 200 && result.status < 300) {
      await updateLibrarySourceCloudState(scope, sourceId, "uploaded");
    } else {
      await updateLibrarySourceCloudState(scope, sourceId, "failed");
    }
  } catch (error) {
    if (isLibrarySourceStorageNetworkError(error)) {
      // Couldn't even reach the server — ordinary offline usage, not a real rejection (see
      // http.ts's network/HTTP error split). Left as "pending" for a later retry, never "failed".
      return;
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
  const durableUri = await persistPickedSourceFile(sourceId, file.uri);
  if (!durableUri) return false;

  await setLocalSourceFile(scope, sourceId, { uri: durableUri, mimeType: file.mimeType });
  await updateLibrarySourceCloudState(scope, sourceId, "pending");
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
