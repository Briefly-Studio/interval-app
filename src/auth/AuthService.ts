import * as SecureStore from "expo-secure-store";

import { getAuthConfig } from "./AuthConfig";
import { emitAuthChanged } from "./authSignal";

const ACCESS_TOKEN_KEY = "auth.accessToken";
const ID_TOKEN_KEY = "auth.idToken";
const REFRESH_TOKEN_KEY = "auth.refreshToken";

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

function assertAuthConfigured() {
  const config = getAuthConfig();
  if (
    !config.cognitoRegion ||
    !config.cognitoUserPoolId ||
    !config.cognitoAppClientId
  ) {
    throw new Error("Missing Cognito auth configuration.");
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

async function storeTokens(result: CognitoAuthResult) {
  if (result.AccessToken) {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, result.AccessToken);
  }
  if (result.IdToken) {
    await SecureStore.setItemAsync(ID_TOKEN_KEY, result.IdToken);
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
  ]);
}

const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Reads only the `exp` claim from a JWT's payload segment. Returns null if the token is
// missing, malformed, or has no exp claim — callers treat that as "expired".
function getTokenExpiry(token: string): number | null {
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
    const payload = JSON.parse(binary) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    // Nothing to refresh with — there is no session to keep alive.
    await clearTokens();
    emitAuthChanged(false);
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
    emitAuthChanged(false);
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
    emitAuthChanged(true);
  },

  async signOut(): Promise<void> {
    await clearTokens();
    emitAuthChanged(false);
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
};
