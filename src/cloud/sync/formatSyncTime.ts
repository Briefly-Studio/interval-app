// Pure, dependency-free formatter for "how long ago did the last successful sync happen" — kept
// separate from any UI file so it stays easily unit-testable (same rationale as syncState.ts).
// Deliberately coarse (minutes/hours/days) rather than exact timestamps: this is plain,
// nontechnical copy for end users, never a raw ISO string or debugging detail.
//
// Returns a structured, translatable result rather than a final string — this file has no
// React/i18n import on purpose, so the actual wording (including pluralization and locale) is
// resolved by the caller via t()/plural() against the `sync.relativeTime.*` keys.
export type SyncTimeAgo = { unit: "justNow" } | { unit: "minutes" | "hours" | "days"; count: number };

export function formatSyncTime(iso: string, now: number = Date.now()): SyncTimeAgo {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return { unit: "justNow" };

  const diffMs = Math.max(0, now - then);
  const diffMin = Math.round(diffMs / 60000);

  if (diffMin < 1) return { unit: "justNow" };
  if (diffMin < 60) return { unit: "minutes", count: diffMin };

  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return { unit: "hours", count: diffHr };

  const diffDay = Math.round(diffHr / 24);
  return { unit: "days", count: diffDay };
}
