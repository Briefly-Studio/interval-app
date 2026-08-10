import Constants from "expo-constants";

import type { PublicClientConfig, RawPublicConfigInput } from "./environmentValidation";
import { validatePublicClientConfig } from "./environmentValidation";

export type { IntervalEnvironment, PublicClientConfig } from "./environmentValidation";
export { InvalidEnvironmentConfigError } from "./environmentValidation";

export interface EnvironmentConfig extends PublicClientConfig {
  isDevelopment: boolean;
  isStaging: boolean;
  isProduction: boolean;
}

type ExpoExtraShape = {
  intervalEnv?: unknown;
  apiBaseUrl?: unknown;
  cognitoRegion?: unknown;
  cognitoUserPoolId?: unknown;
  cognitoAppClientId?: unknown;
};

function readRawExtra(): RawPublicConfigInput {
  const extra = Constants.expoConfig?.extra as ExpoExtraShape | undefined;
  return {
    intervalEnv: extra?.intervalEnv,
    apiBaseUrl: extra?.apiBaseUrl,
    cognitoRegion: extra?.cognitoRegion,
    cognitoUserPoolId: extra?.cognitoUserPoolId,
    cognitoAppClientId: extra?.cognitoAppClientId,
  };
}

let cached: EnvironmentConfig | undefined;

/**
 * The single source of truth for environment-aware public client config. Validated once, on
 * first access, and cached — every call site (auth config, sync HTTP client, Dev Tools) reads
 * through here rather than touching Constants.expoConfig.extra or process.env directly.
 *
 * Deliberately lazy rather than validated at module import time: this preserves offline guest
 * behavior (a guest who never signs in or syncs never needs cloud config, so an invalid/missing
 * INTERVAL_ENV must not crash the whole app for them) while still satisfying "no silent fallback"
 * for every code path that does need it. See docs/environment-config-contract.md.
 */
export function getEnvironmentConfig(): EnvironmentConfig {
  if (!cached) {
    const validated = validatePublicClientConfig(readRawExtra());
    cached = Object.freeze({
      ...validated,
      isDevelopment: validated.environment === "development",
      isStaging: validated.environment === "staging",
      isProduction: validated.environment === "production",
    });
  }
  return cached;
}
