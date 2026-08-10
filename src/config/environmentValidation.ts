/**
 * Pure environment/config validation — no React Native or Expo imports, so this file can be
 * exercised deterministically outside the app (see the environment-config-contract mission's
 * deterministic checks). All values here are public build configuration, never secrets — see
 * docs/environment-config-contract.md for the public-vs-secret classification.
 */

export type IntervalEnvironment = "development" | "staging" | "production";

const VALID_ENVIRONMENTS: readonly IntervalEnvironment[] = ["development", "staging", "production"];

export interface PublicClientConfig {
  environment: IntervalEnvironment;
  apiBaseUrl: string;
  cognitoRegion: string;
  cognitoUserPoolId: string;
  cognitoAppClientId: string;
}

export interface RawPublicConfigInput {
  intervalEnv?: unknown;
  apiBaseUrl?: unknown;
  cognitoRegion?: unknown;
  cognitoUserPoolId?: unknown;
  cognitoAppClientId?: unknown;
}

/** Thrown for any invalid/missing/malformed config value. Never includes the raw offending
 * value in its message — these fields are public, not secret, but validation errors can end up
 * in crash reports, and the field name plus reason is always enough to fix the problem. */
export class InvalidEnvironmentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEnvironmentConfigError";
  }
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Parses INTERVAL_ENV. Deliberately strict: only the exact canonical values are accepted.
 * There is no mapping from shorthand values like "dev"/"prod"/"test" — an ambiguous value is
 * treated the same as a missing one (rejected), never guessed at.
 */
export function parseIntervalEnvironment(raw: unknown): IntervalEnvironment {
  const trimmed = asTrimmedString(raw);
  if (!trimmed) {
    throw new InvalidEnvironmentConfigError(
      "INTERVAL_ENV is missing. It must be set explicitly to one of: development, staging, production."
    );
  }
  if (!(VALID_ENVIRONMENTS as readonly string[]).includes(trimmed)) {
    throw new InvalidEnvironmentConfigError(
      "INTERVAL_ENV is invalid. It must be exactly one of: development, staging, production " +
        '(shorthand values like "dev"/"prod"/"test" are not accepted).'
    );
  }
  return trimmed as IntervalEnvironment;
}

function isPlausibleHttpsUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.hostname.length > 0;
}

/** AWS region shape, e.g. "us-east-2" — generic structural check, not tied to any one region. */
function isPlausibleAwsRegion(value: string): boolean {
  return /^[a-z]{2}-[a-z]+-\d$/.test(value);
}

/** Cognito user pool ID shape, e.g. "us-east-2_AbCdEfGhI" — generic structural check. */
function isPlausibleCognitoUserPoolId(value: string): boolean {
  return /^[a-z0-9-]+_[A-Za-z0-9]+$/.test(value);
}

/** Cognito app client ID shape — generic alphanumeric check, no fixed real ID involved. */
function isPlausibleCognitoAppClientId(value: string): boolean {
  return /^[A-Za-z0-9]{10,64}$/.test(value);
}

/**
 * Generic placeholder/example-value detector. Deliberately pattern-based, not a hardcoded list
 * of real identifiers — see docs/environment-config-contract.md's "Safety validation" section
 * for why known real Production identifiers are kept out of this general-purpose path. Patterns
 * cover both this file's original `.env.example` placeholders and the ones the pre-consolidation
 * `src/auth/AuthService.ts` validator used to check independently (`"paste"`, `"your_"`) — see
 * that document's "Safety validation" section for the consolidation history.
 */
function isPlaceholderLike(value: string): boolean {
  const lower = value.toLowerCase();
  if (lower.includes("example")) return true;
  if (/x{6,}/i.test(value)) return true;
  if (lower.includes("changeme") || lower.includes("your_") || lower.includes("todo")) return true;
  if (lower.includes("paste")) return true;
  return false;
}

function requireField(raw: unknown, fieldName: string): string {
  const trimmed = asTrimmedString(raw);
  if (!trimmed) {
    throw new InvalidEnvironmentConfigError(`${fieldName} is missing or empty.`);
  }
  return trimmed;
}

/**
 * Validates the full public client config. Fails closed: any missing, empty, malformed, or
 * placeholder-shaped value throws — in every environment — rather than silently substituting a
 * default or falling back to another environment's shape. This is the single authoritative
 * parser/validator for environment-dependent cloud configuration; consumers (AuthConfig,
 * AuthService, sync HTTP) must not duplicate this logic — see
 * docs/environment-config-contract.md.
 */
export function validatePublicClientConfig(raw: RawPublicConfigInput): PublicClientConfig {
  const environment = parseIntervalEnvironment(raw.intervalEnv);

  const apiBaseUrl = requireField(raw.apiBaseUrl, "EXPO_PUBLIC_API_BASE_URL");
  if (!isPlausibleHttpsUrl(apiBaseUrl)) {
    throw new InvalidEnvironmentConfigError(
      "EXPO_PUBLIC_API_BASE_URL is malformed — it must be a valid https:// URL."
    );
  }

  const cognitoRegion = requireField(raw.cognitoRegion, "EXPO_PUBLIC_COGNITO_REGION");
  if (!isPlausibleAwsRegion(cognitoRegion)) {
    throw new InvalidEnvironmentConfigError(
      'EXPO_PUBLIC_COGNITO_REGION is not a structurally plausible AWS region (expected a shape like "us-east-2").'
    );
  }

  const cognitoUserPoolId = requireField(raw.cognitoUserPoolId, "EXPO_PUBLIC_COGNITO_USER_POOL_ID");
  if (!isPlausibleCognitoUserPoolId(cognitoUserPoolId)) {
    throw new InvalidEnvironmentConfigError(
      "EXPO_PUBLIC_COGNITO_USER_POOL_ID is not a structurally plausible Cognito user pool ID."
    );
  }

  const cognitoAppClientId = requireField(raw.cognitoAppClientId, "EXPO_PUBLIC_COGNITO_APP_CLIENT_ID");
  if (!isPlausibleCognitoAppClientId(cognitoAppClientId)) {
    throw new InvalidEnvironmentConfigError(
      "EXPO_PUBLIC_COGNITO_APP_CLIENT_ID is not a structurally plausible Cognito app client ID."
    );
  }

  // Rejected in every environment, not just Production: src/auth/AuthService.ts's
  // pre-consolidation validator rejected placeholder values regardless of environment (there was
  // no environment concept when it was written), and that cross-environment behavior is
  // preserved here rather than narrowed — an unfilled `.env.example` value is never a valid
  // config in any environment. See docs/environment-config-contract.md.
  const fields: [string, string][] = [
    ["EXPO_PUBLIC_API_BASE_URL", apiBaseUrl],
    ["EXPO_PUBLIC_COGNITO_REGION", cognitoRegion],
    ["EXPO_PUBLIC_COGNITO_USER_POOL_ID", cognitoUserPoolId],
    ["EXPO_PUBLIC_COGNITO_APP_CLIENT_ID", cognitoAppClientId],
  ];
  for (const [fieldName, value] of fields) {
    if (isPlaceholderLike(value)) {
      throw new InvalidEnvironmentConfigError(
        `${fieldName} looks like a placeholder/example value, which is not allowed in any environment.`
      );
    }
  }

  return Object.freeze({
    environment,
    apiBaseUrl,
    cognitoRegion,
    cognitoUserPoolId,
    cognitoAppClientId,
  });
}
