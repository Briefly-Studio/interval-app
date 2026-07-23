import * as SecureStore from "expo-secure-store";

import { getAuthConfig, type AuthConfig } from "./AuthConfig";
import { emitWorkspaceChanged } from "./authSignal";
import type { WorkspaceScope } from "../storage/workspaceScope";

const ACCESS_TOKEN_KEY = "auth.accessToken";
const ID_TOKEN_KEY = "auth.idToken";
const REFRESH_TOKEN_KEY = "auth.refreshToken";
const SUB_KEY = "auth.sub";

// Treat a token as expired slightly before its real expiry to avoid racing the server clock.
const EXPIRY_SAFETY_MARGIN_SECONDS = 30;

// Thrown when the Cognito request never got a response (offline/unreachable), as opposed to
// Cognito responding with an explicit rejection. Callers use this to decide whether a failed
// refresh should sign the user out or just be retried later.
class CognitoNetworkError extends Error {}

// Thrown when Cognito responded with a non-2xx status. Carries the status so callers can
// distinguish a definitive client-side rejection (4xx — e.g. an expired/revoked refresh token)
// from a transient server-side failure (5xx), which should not sign the user out.
class CognitoHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type CognitoAuthResult = {
  AccessToken?: string;
  IdToken?: string;
  RefreshToken?: string;
};

type CognitoResponse = {
  AuthenticationResult?: CognitoAuthResult;
  message?: string;
  __type?: string;
};

// Catches unfilled-in template values from .env.example (e.g. "us-east-2_XXXXXXXXX",
// "xxxxxxxxxxxxxxxxxxxxxxxxxx", "https://api.example.com/prod") as well as the literal
// "PASTE_..._HERE" markers used as placeholders — none of these are valid Cognito config,
// but a plain empty-string check doesn't catch them since they're non-empty.
function isPlaceholderValue(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return true;
  if (/paste|your_|example\.com/i.test(normalized)) return true;
  if (/[xX]{6,}/.test(normalized)) return true;
  return false;
}

const REQUIRED_CONFIG_FIELDS: [key: keyof AuthConfig, envVar: string][] = [
  ["cognitoRegion", "EXPO_PUBLIC_COGNITO_REGION"],
  ["cognitoUserPoolId", "EXPO_PUBLIC_COGNITO_USER_POOL_ID"],
  ["cognitoAppClientId", "EXPO_PUBLIC_COGNITO_APP_CLIENT_ID"],
];

function assertAuthConfigured(): AuthConfig {
  const config = getAuthConfig();
  for (const [key, envVar] of REQUIRED_CONFIG_FIELDS) {
    if (isPlaceholderValue(config[key])) {
      throw new Error(
        `Cognito auth is not configured: ${envVar} is missing or still set to a placeholder ` +
          `value. Set a real value in your local .env (see .env.example) and restart Expo with ` +
          `cache cleared: npx expo start -c.`
      );
    }
  }
  return config;
}

async function cognitoRequest<TPayload extends Record<string, unknown>>(
  action: "SignUp" | "ConfirmSignUp" | "InitiateAuth",
  payload: TPayload
): Promise<CognitoResponse> {
  const { cognitoRegion } = assertAuthConfigured();
  let res: Response;
  try {
    res = await fetch(`https://cognito-idp.${cognitoRegion}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new CognitoNetworkError(
      error instanceof Error ? error.message : "Network request failed"
    );
  }

  const json = (await res.json().catch(() => ({}))) as CognitoResponse;
  if (!res.ok) {
    throw new CognitoHttpError(res.status, json.message ?? `${action} failed: ${res.status}`);
  }
  return json;
}

const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Decodes a JWT's payload segment into a plain object. Returns null if the token is missing,
// malformed, or not valid JSON — callers treat that as "no usable claims".
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payloadSegment = token.split(".")[1];
    if (!payloadSegment) return null;
    const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    let binary = "";
    let buffer = 0;
    let bits = 0;
    for (const char of padded) {
      if (char === "=") break;
      const value = BASE64_CHARS.indexOf(char);
      if (value === -1) continue;
      buffer = (buffer << 6) | value;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        binary += String.fromCharCode((buffer >> bits) & 0xff);
      }
    }
    return JSON.parse(binary) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getTokenExpiry(token: string): number | null {
  const payload = decodeJwtPayload(token);
  return payload && typeof payload.exp === "number" ? payload.exp : null;
}

// Reads the Cognito sub (stable per-user identifier) from an ID token's claims. This is the
// only trusted source of user identity on the client — never derived from email or username.
function getSubClaim(token: string): string | null {
  const payload = decodeJwtPayload(token);
  return payload && typeof payload.sub === "string" ? payload.sub : null;
}

async function storeTokens(result: CognitoAuthResult) {
  if (result.AccessToken) {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, result.AccessToken);
  }
  if (result.IdToken) {
    await SecureStore.setItemAsync(ID_TOKEN_KEY, result.IdToken);
    const sub = getSubClaim(result.IdToken);
    if (sub) {
      await SecureStore.setItemAsync(SUB_KEY, sub);
    }
  }
  if (result.RefreshToken) {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, result.RefreshToken);
  }
}

async function clearTokens() {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(ID_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(SUB_KEY),
  ]);
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    // Nothing to refresh with — there is no session to keep alive.
    await clearTokens();
    emitWorkspaceChanged({ kind: "guest" });
    return null;
  }

  const { cognitoAppClientId } = assertAuthConfigured();
  let json: CognitoResponse;
  try {
    json = await cognitoRequest("InitiateAuth", {
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: cognitoAppClientId,
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    });
  } catch (error) {
    if (error instanceof CognitoNetworkError) {
      // Offline or unreachable — keep the existing tokens, let this call no-op, retry later.
      return null;
    }
    if (error instanceof CognitoHttpError && error.status >= 500) {
      // Cognito service-side failure (5xx) — transient, not a statement about the refresh
      // token's validity. Keep the existing tokens and retry on the next sync attempt.
      return null;
    }
    // Cognito was reached and explicitly rejected the request client-side (4xx — e.g.
    // NotAuthorizedException for an expired/revoked refresh token).
    await clearTokens();
    emitWorkspaceChanged({ kind: "guest" });
    return null;
  }

  if (!json.AuthenticationResult?.AccessToken) {
    // Cognito responded 2xx but with an unexpected/empty body — not a confirmed rejection of
    // the refresh token, so don't sign the user out. Keep tokens and retry later.
    return null;
  }

  // storeTokens only overwrites fields that are present. Refresh responses normally don't
  // include a new RefreshToken, so the existing one on disk is preserved automatically.
  await storeTokens(json.AuthenticationResult);
  return json.AuthenticationResult.AccessToken;
}

export const AuthService = {
  async signUp(email: string, password: string): Promise<void> {
    const { cognitoAppClientId } = assertAuthConfigured();
    await cognitoRequest("SignUp", {
      ClientId: cognitoAppClientId,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: "email", Value: email }],
    });
  },

  async confirmSignUp(email: string, code: string): Promise<void> {
    const { cognitoAppClientId } = assertAuthConfigured();
    await cognitoRequest("ConfirmSignUp", {
      ClientId: cognitoAppClientId,
      Username: email,
      ConfirmationCode: code,
    });
  },

  async signIn(email: string, password: string): Promise<void> {
    const { cognitoAppClientId } = assertAuthConfigured();
    const json = await cognitoRequest("InitiateAuth", {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: cognitoAppClientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });

    if (!json.AuthenticationResult?.AccessToken) {
      throw new Error("Sign in did not return an access token.");
    }

    await storeTokens(json.AuthenticationResult);
    const scope = await AuthService.getActiveScope();
    emitWorkspaceChanged(scope);
  },

  async signOut(): Promise<void> {
    await clearTokens();
    emitWorkspaceChanged({ kind: "guest" });
  },

  async getAccessToken(): Promise<string | null> {
    const stored = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
    if (!stored) return null;

    const exp = getTokenExpiry(stored);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const isFresh = exp !== null && exp - nowSeconds > EXPIRY_SAFETY_MARGIN_SECONDS;
    if (isFresh) return stored;

    if (!refreshPromise) {
      refreshPromise = refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  },

  // The single source of truth for "which Cognito user, if any, is currently signed in."
  // Always re-derives the sub from the current ID token rather than trusting the persisted
  // auth.sub cache — that cache is written for fast access but never treated as authoritative,
  // and is self-healed here if it's stale or missing.
  async getActiveSub(): Promise<string | null> {
    const idToken = await SecureStore.getItemAsync(ID_TOKEN_KEY);
    if (!idToken) {
      // No token set at all — there is no valid identity, regardless of what's persisted.
      await SecureStore.deleteItemAsync(SUB_KEY);
      return null;
    }

    const sub = getSubClaim(idToken);
    if (!sub) return null;

    const persisted = await SecureStore.getItemAsync(SUB_KEY);
    if (persisted !== sub) {
      await SecureStore.setItemAsync(SUB_KEY, sub);
    }
    return sub;
  },

  async getActiveScope(): Promise<WorkspaceScope> {
    const sub = await AuthService.getActiveSub();
    return sub ? { kind: "user", sub } : { kind: "guest" };
  },
};
