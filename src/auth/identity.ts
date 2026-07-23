// Display-only user identity derived from ID-token claims. Nothing exported from this module
// is ever a valid source of security or workspace identity — `sub` (from AuthService's
// self-healed, authoritative value) is the only field with any bearing on storage
// partitioning, sync ownership, or authorization, and it is passed in rather than re-derived
// from claims here so this module can never become a second source of truth for it.

export type UserIdentity = {
  sub: string;
  email?: string;
  givenName?: string;
  familyName?: string;
  fullName?: string;
  displayName: string;
};

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function emailPrefix(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const [prefix] = email.split("@");
  return trimmedString(prefix);
}

function composeFullName(
  givenName: string | undefined,
  familyName: string | undefined,
  name: string | undefined
): string | undefined {
  if (givenName && familyName) return `${givenName} ${familyName}`;
  return givenName ?? familyName ?? name;
}

// Fallback order, per spec: given_name -> name -> email prefix -> "there".
function composeDisplayName(
  givenName: string | undefined,
  name: string | undefined,
  email: string | undefined
): string {
  return givenName ?? name ?? emailPrefix(email) ?? "there";
}

/**
 * Builds a display-only identity from decoded ID-token claims (which may be null/malformed —
 * every field is read defensively). `sub` must be supplied by the caller from a trusted source
 * (AuthService.getActiveSub()), never re-derived from `claims.sub` here.
 */
export function deriveIdentityFromClaims(
  claims: Record<string, unknown> | null | undefined,
  sub: string
): UserIdentity {
  const email = trimmedString(claims?.email);
  const givenName = trimmedString(claims?.given_name);
  const familyName = trimmedString(claims?.family_name);
  const name = trimmedString(claims?.name);

  return {
    sub,
    email,
    givenName,
    familyName,
    fullName: composeFullName(givenName, familyName, name),
    displayName: composeDisplayName(givenName, name, email),
  };
}
