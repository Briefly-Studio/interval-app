// Pure, dependency-free formatter for "how long ago did the last successful sync happen" — kept
// separate from any UI file so it stays easily unit-testable (same rationale as syncState.ts).
// Deliberately coarse (minutes/hours/days) rather than exact timestamps: this is plain,
// nontechnical copy for end users, never a raw ISO string or debugging detail.
export function formatSyncTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";

  const diffMs = Math.max(0, now - then);
  const diffMin = Math.round(diffMs / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;

  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;

  const diffDay = Math.round(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}
