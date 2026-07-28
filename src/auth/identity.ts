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
  // Read-only today: nothing in this codebase writes a `nickname` attribute (Edit Profile V1
  // deliberately doesn't expose it — see src/auth/nameValidation.ts and app/edit-profile.tsx for
  // why). This just means that if a nickname claim ever legitimately appears on the ID token
  // (e.g. a future batch wires writing it, once verified safe), display already prefers it
  // without any further changes here.
  nickname?: string;
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

// Fallback order: nickname -> given_name -> name -> email prefix -> "there". Nickname leads
// because it's the most deliberately-chosen preferred name when present, but today nothing
// populates it (see UserIdentity.nickname) so this is equivalent to the old given_name-first
// chain until a future batch verifies and wires nickname writes.
function composeDisplayName(
  nickname: string | undefined,
  givenName: string | undefined,
  name: string | undefined,
  email: string | undefined
): string {
  return nickname ?? givenName ?? name ?? emailPrefix(email) ?? "there";
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
  const nickname = trimmedString(claims?.nickname);
  const name = trimmedString(claims?.name);

  return {
    sub,
    email,
    givenName,
    familyName,
    nickname,
    fullName: composeFullName(givenName, familyName, name),
    displayName: composeDisplayName(nickname, givenName, name, email),
  };
}
