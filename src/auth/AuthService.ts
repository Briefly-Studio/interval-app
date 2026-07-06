import * as SecureStore from "expo-secure-store";

import { getAuthConfig } from "./AuthConfig";
import { emitAuthChanged } from "./authSignal";

const ACCESS_TOKEN_KEY = "auth.accessToken";
const ID_TOKEN_KEY = "auth.idToken";
const REFRESH_TOKEN_KEY = "auth.refreshToken";

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
  const res = await fetch(`https://cognito-idp.${cognitoRegion}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => ({}))) as CognitoResponse;
  if (!res.ok) {
    throw new Error(json.message ?? `${action} failed: ${res.status}`);
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
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(ID_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    ]);
    emitAuthChanged(false);
  },

  async getAccessToken(): Promise<string | null> {
    return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  },
};
