import { getEnvironmentConfig } from "../config/environment";

export type AuthConfig = {
  cognitoRegion: string;
  cognitoUserPoolId: string;
  cognitoAppClientId: string;
};

export function getAuthConfig(): AuthConfig {
  const { cognitoRegion, cognitoUserPoolId, cognitoAppClientId } = getEnvironmentConfig();
  return { cognitoRegion, cognitoUserPoolId, cognitoAppClientId };
}
