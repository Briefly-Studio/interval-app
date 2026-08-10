import "dotenv/config";

export default ({ config }: any) => {
  const intervalEnv = process.env.INTERVAL_ENV ?? "";
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
  const cognitoRegion = process.env.EXPO_PUBLIC_COGNITO_REGION ?? "";
  const cognitoUserPoolId = process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID ?? "";
  const cognitoAppClientId =
    process.env.EXPO_PUBLIC_COGNITO_APP_CLIENT_ID ?? "";

  return {
    ...config,
    extra: {
      ...(config.extra ?? {}),
      intervalEnv,
      apiBaseUrl,
      cognitoRegion,
      cognitoUserPoolId,
      cognitoAppClientId,
    },
  };
};
