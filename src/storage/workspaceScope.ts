export type WorkspaceScope = { kind: "guest" } | { kind: "user"; sub: string };

export function encodeSubForKey(sub: string): string {
  return encodeURIComponent(sub);
}

export function scopedKey(scope: WorkspaceScope, baseKey: string): string {
  return scope.kind === "guest" ? baseKey : `u.${encodeSubForKey(scope.sub)}.${baseKey}`;
}

export function sameScope(a: WorkspaceScope, b: WorkspaceScope): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "guest" || a.sub === (b as { kind: "user"; sub: string }).sub;
}
