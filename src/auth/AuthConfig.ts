import Constants from "expo-constants";

export type AuthConfig = {
  cognitoRegion: string;
  cognitoUserPoolId: string;
  cognitoAppClientId: string;
};

export function getAuthConfig(): AuthConfig {
  const extra = Constants.expoConfig?.extra as
    | {
        cognitoRegion?: string;
        cognitoUserPoolId?: string;
        cognitoAppClientId?: string;
      }
    | undefined;

  return {
    cognitoRegion: extra?.cognitoRegion ?? "",
    cognitoUserPoolId: extra?.cognitoUserPoolId ?? "",
    cognitoAppClientId: extra?.cognitoAppClientId ?? "",
  };
}
