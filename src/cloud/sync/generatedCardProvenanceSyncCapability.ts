import { getEnvironmentConfig } from "../../config/environment";

/** Metadata sync only; independent of provider/UI rollout. Fail closed in Production or when
 * environment configuration is unavailable. Both collect and apply must use this gate. */
export function isGeneratedCardProvenanceSyncEnabled(): boolean {
  try {
    return isGeneratedCardProvenanceSyncEnvironment(getEnvironmentConfig().environment);
  } catch {
    return false;
  }
}

export function isGeneratedCardProvenanceSyncEnvironment(environment: string): boolean {
  return environment === "development" || environment === "staging";
}
