import { getEnvironmentConfig } from "../../config/environment";

function getBaseUrl(): string {
  return getEnvironmentConfig().apiBaseUrl;
}

// Mirrors src/cloud/sync/http.ts's SyncNetworkError/SyncHttpError split exactly, for the same
// reason: callers need to tell "couldn't reach the server" apart from "the server rejected this"
// so a transient offline moment can leave a source's cloudUploadState as "pending" (retry later)
// rather than incorrectly "failed" (a real, explicit rejection).
export class LibrarySourceStorageNetworkError extends Error {}

export class LibrarySourceStorageHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type UploadUrlResponse = { objectKey: string; uploadUrl: string; expiresInSeconds: number };
export type DownloadUrlResponse = { downloadUrl: string; expiresInSeconds: number };

export async function requestUploadUrl(
  accessToken: string,
  sourceId: string,
  mimeType: string,
  fileSize: number
): Promise<UploadUrlResponse> {
  let res: Response;
  try {
    res = await fetch(`${getBaseUrl()}/library/sources/${encodeURIComponent(sourceId)}/upload-url`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ mimeType, fileSize }),
    });
  } catch (error) {
    throw new LibrarySourceStorageNetworkError(error instanceof Error ? error.message : "Network request failed");
  }

  if (!res.ok) {
    throw new LibrarySourceStorageHttpError(res.status, `upload-url failed: ${res.status}`);
  }

  return (await res.json()) as UploadUrlResponse;
}

export async function requestDownloadUrl(accessToken: string, sourceId: string): Promise<DownloadUrlResponse> {
  let res: Response;
  try {
    res = await fetch(`${getBaseUrl()}/library/sources/${encodeURIComponent(sourceId)}/download-url`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (error) {
    throw new LibrarySourceStorageNetworkError(error instanceof Error ? error.message : "Network request failed");
  }

  if (!res.ok) {
    throw new LibrarySourceStorageHttpError(res.status, `download-url failed: ${res.status}`);
  }

  return (await res.json()) as DownloadUrlResponse;
}

/** True when the error represents "couldn't reach the server at all" rather than a server-side rejection. */
export function isLibrarySourceStorageNetworkError(error: unknown): boolean {
  return error instanceof LibrarySourceStorageNetworkError;
}
