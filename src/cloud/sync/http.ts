import Constants from "expo-constants";
import { AuthService } from "../../auth/AuthService";
import type { PullRequest, PullResponse, PushRequest, PushResponse } from "./types";

function getBaseUrl(): string {
  const apiBaseUrl = (Constants.expoConfig?.extra as any)?.apiBaseUrl as
    | string
    | undefined;

  if (!apiBaseUrl) throw new Error("Missing EXPO_PUBLIC_API_BASE_URL");
  return apiBaseUrl;
}

export async function pushChanges(req: PushRequest): Promise<PushResponse> {
  const accessToken = await AuthService.getAccessToken();
  if (!accessToken) {
    return { accepted: [], rejected: [] };
  }

  const res = await fetch(`${getBaseUrl()}/sync/push`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    throw new Error(`push failed: ${res.status}`);
  }

  return (await res.json()) as PushResponse;
}

export async function pullChanges(req: PullRequest): Promise<PullResponse> {
  const accessToken = await AuthService.getAccessToken();
  if (!accessToken) {
    return { cursor: req.cursor ?? "", changes: [] };
  }

  const url = new URL(`${getBaseUrl()}/sync/pull`);
  url.searchParams.set("deviceId", req.deviceId);
  if (req.cursor) url.searchParams.set("cursor", req.cursor);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`pull failed: ${res.status}`);
  }

  return (await res.json()) as PullResponse;
}
