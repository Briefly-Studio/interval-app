// Validation and Cognito-attribute helpers for the given/family name fields on sign-up.
// Wired into app/sign-up.tsx — the given_name/family_name schema attributes and app-client
// write-attribute support were confirmed against the real Cognito user pool
// (us-east-2_UwGRm5dye) via CloudShell before this was enabled.

export const MAX_NAME_LENGTH = 50;

export function trimName(value: string): string {
  return value.trim();
}

// Letters from any script (\p{L}), combining marks for accents (\p{M}), spaces, apostrophes,
// and hyphens. Deliberately not ASCII-only — must support international names.
const NAME_PATTERN = /^[\p{L}\p{M}'\- ]+$/u;

export function isValidName(value: string): boolean {
  const trimmed = trimName(value);
  if (trimmed.length === 0) return false;
  if (trimmed.length > MAX_NAME_LENGTH) return false;
  return NAME_PATTERN.test(trimmed);
}

export type CognitoAttribute = { Name: string; Value: string };

/** Builds the given_name/family_name entries to append to a Cognito SignUp UserAttributes array. */
export function buildNameAttributes(givenName: string, familyName: string): CognitoAttribute[] {
  return [
    { Name: "given_name", Value: trimName(givenName) },
    { Name: "family_name", Value: trimName(familyName) },
  ];
}
