// Pure formatting for the review screen's "Good · in 3 days" style rating captions — the ONLY
// reason a user sees a rating's consequence before committing to it. Deliberately coarse (whole
// minutes or whole days, never seconds or fractional days): this is a quick glance before a
// review decision, not a precise countdown.

export type SchedulingIntervalPreview = { unit: "minutes" | "days"; value: number };

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 24 * 60;

/**
 * How far away `dueAt` is from `now`, coarsened to minutes (under 24 hours) or whole days (24
 * hours or more). Never negative — a due date at or before `now` previews as "1 minute" (the
 * smallest unit this ever reports), since "0" would misleadingly read as "never" rather than
 * "effectively immediately."
 */
export function formatSchedulingIntervalPreview(dueAt: string, now: Date): SchedulingIntervalPreview {
  const diffMs = Math.max(0, new Date(dueAt).getTime() - now.getTime());
  const diffMinutes = Math.round(diffMs / MS_PER_MINUTE);

  if (diffMinutes < MINUTES_PER_DAY) {
    return { unit: "minutes", value: Math.max(1, diffMinutes) };
  }
  return { unit: "days", value: Math.max(1, Math.round(diffMinutes / MINUTES_PER_DAY)) };
}
