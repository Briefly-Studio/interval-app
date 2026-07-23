// Validation and Cognito-attribute helpers for the given/family name fields planned for
// sign-up (Batch 1B.1 section 2). NOT YET WIRED into app/sign-up.tsx — Cognito schema and
// app-client write-attribute support for given_name/family_name have not been confirmed in
// this environment. Built and tested in isolation now so enabling it later is a small,
// low-risk change (call isValidName + buildNameAttributes from the sign-up screen) rather than
// designing validation under time pressure once verification lands.

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
