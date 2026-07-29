import Constants from "expo-constants";
import type { PullRequest, PullResponse, PushRequest, PushResponse } from "./types";

function getBaseUrl(): string {
  const apiBaseUrl = (Constants.expoConfig?.extra as any)?.apiBaseUrl as
    | string
    | undefined;

  if (!apiBaseUrl) throw new Error("Missing EXPO_PUBLIC_API_BASE_URL");
  return apiBaseUrl;
}

// Thrown when the sync request never got a response at all — offline, DNS failure, timeout,
// etc. — as opposed to the server responding with an explicit rejection. Mirrors
// src/auth/AuthService.ts's CognitoNetworkError/CognitoHttpError split so callers (SyncService,
// and ultimately src/cloud/sync/syncState.ts) can tell "couldn't reach the server" apart from
// "the server rejected this" — the same distinction the product spec draws between the
// "offline" and "needsAttention" sync states.
export class SyncNetworkError extends Error {}

// Thrown when the server responded with a non-2xx status. Carries the numeric status so callers
// can classify the failure (and report a safe diagnostic code) without ever parsing or
// surfacing the raw response body/message to the user.
export class SyncHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function pushChanges(
  accessToken: string,
  req: PushRequest
): Promise<PushResponse> {
  let res: Response;
  try {
    res = await fetch(`${getBaseUrl()}/sync/push`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(req),
    });
  } catch (error) {
    throw new SyncNetworkError(error instanceof Error ? error.message : "Network request failed");
  }

  if (!res.ok) {
    throw new SyncHttpError(res.status, `push failed: ${res.status}`);
  }

  return (await res.json()) as PushResponse;
}

export async function pullChanges(
  accessToken: string,
  req: PullRequest
): Promise<PullResponse> {
  const url = new URL(`${getBaseUrl()}/sync/pull`);
  url.searchParams.set("deviceId", req.deviceId);
  if (req.cursor) url.searchParams.set("cursor", req.cursor);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (error) {
    throw new SyncNetworkError(error instanceof Error ? error.message : "Network request failed");
  }

  if (!res.ok) {
    throw new SyncHttpError(res.status, `pull failed: ${res.status}`);
  }

  return (await res.json()) as PullResponse;
}

/** True when the error represents "couldn't reach the server at all" rather than a server-side rejection. */
export function isSyncNetworkError(error: unknown): boolean {
  return error instanceof SyncNetworkError;
}

/** The server's numeric HTTP status, if this error came from a non-ok response. */
export function getSyncHttpStatus(error: unknown): number | undefined {
  return error instanceof SyncHttpError ? error.status : undefined;
}

/**
 * Safe to log or store as sync state's diagnosticCode: "NetworkError", an "Http###" status
 * code, or a generic error class name — never the raw error message/stack, which could embed
 * response bodies, URLs, or other details we don't want surfaced.
 */
export function getSyncDiagnosticCode(error: unknown): string {
  if (isSyncNetworkError(error)) return "NetworkError";
  const status = getSyncHttpStatus(error);
  if (status !== undefined) return `Http${status}`;
  return error instanceof Error ? error.constructor.name : "UnknownError";
}
