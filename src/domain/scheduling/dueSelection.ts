import { utcCalendarDayDiff } from "./scheduler";
import type { CardSchedulingState } from "./types";

// Pure, storage-agnostic due/new/overdue/future selection and a default queue ordering — "what
// should I review now." Deliberately NOT a workload planner, exam-date scheduler, or
// gamification layer (explicitly out of scope — see docs/spaced-repetition-foundation.md). Every
// function here takes already-resolved `CardSchedulingState`s (see migration.ts for how a
// never-reviewed card's state is resolved) — this module has no idea what a "card," "deck," or
// "AsyncStorage" is; a caller joins whatever card/deck data it has with scheduling state and
// passes that in, exactly as the "keep queue construction separate from scheduler math, do not
// bury ordering inside UI components" guidance asks for.

export type SchedulableCard<T = unknown> = { cardId: string; schedulingState: CardSchedulingState; card: T };

/** A review-state card (learning/relearning/review) is "due" the moment its own `dueAt` has
 * arrived — never gated on calendar-day boundaries, since a short-term learning step can
 * legitimately come due again within the same day, sometimes within minutes. */
export function isDue<T>(entry: SchedulableCard<T>, now: Date): boolean {
  return entry.schedulingState.state !== "new" && new Date(entry.schedulingState.dueAt).getTime() <= now.getTime();
}

export function isNew<T>(entry: SchedulableCard<T>): boolean {
  return entry.schedulingState.state === "new";
}

/** A DUE card whose due date falls on an earlier calendar day than `now` (UTC) — it has been
 * waiting at least one full extra day, not just "due earlier today." Calendar-day comparison
 * (not a fixed-hours threshold) so this is stable regardless of what time of day someone happens
 * to study. */
export function isOverdue<T>(entry: SchedulableCard<T>, now: Date): boolean {
  if (!isDue(entry, now)) return false;
  return utcCalendarDayDiff(new Date(entry.schedulingState.dueAt), now) > 0;
}

/** Not yet eligible — due strictly after `now`. A "new" card (never scheduled) is never
 * considered "future"; it is its own bucket (see `isNew`). */
export function isFuture<T>(entry: SchedulableCard<T>, now: Date): boolean {
  return entry.schedulingState.state !== "new" && new Date(entry.schedulingState.dueAt).getTime() > now.getTime();
}

export function selectDueCards<T>(entries: SchedulableCard<T>[], now: Date): SchedulableCard<T>[] {
  return entries.filter((e) => isDue(e, now));
}

export function selectOverdueCards<T>(entries: SchedulableCard<T>[], now: Date): SchedulableCard<T>[] {
  return entries.filter((e) => isOverdue(e, now));
}

export function selectNewCards<T>(entries: SchedulableCard<T>[]): SchedulableCard<T>[] {
  return entries.filter(isNew);
}

export function selectFutureCards<T>(entries: SchedulableCard<T>[], now: Date): SchedulableCard<T>[] {
  return entries.filter((e) => isFuture(e, now));
}

/** Ascending by `dueAt` — the most overdue/earliest-due card first. Stable for equal `dueAt`
 * values (preserves the input's relative order, same guarantee `Array.prototype.sort` already
 * makes in every JS engine this app targets). */
export function orderByDueAt<T>(entries: SchedulableCard<T>[]): SchedulableCard<T>[] {
  return [...entries].sort((a, b) => new Date(a.schedulingState.dueAt).getTime() - new Date(b.schedulingState.dueAt).getTime());
}

export type DefaultQueueOptions = {
  /** Caps how many NEW cards the queue introduces — omitted/undefined means no cap. Daily limits
   * beyond this simple per-call cap (e.g. a persisted "already introduced N new cards today"
   * counter) are explicitly future work — see docs/spaced-repetition-foundation.md. */
  newCardLimit?: number;
};

/**
 * The default "what to review now" ordering: every due card (overdue and learning/relearning/
 * review cards due today, oldest-due first — overdue cards naturally sort first since their
 * `dueAt` is earliest), then new cards (in the order the caller supplied them — e.g. a deck's own
 * stable creation order — never reshuffled here; a future "introduce new cards in a smarter
 * order" decision is separate work). Future (not-yet-due) cards are never included — this is a
 * "review now" queue, not a workload forecast.
 */
export function buildDefaultReviewQueue<T>(entries: SchedulableCard<T>[], now: Date, options: DefaultQueueOptions = {}): SchedulableCard<T>[] {
  const due = orderByDueAt(selectDueCards(entries, now));
  const newCards = selectNewCards(entries);
  const cappedNewCards = typeof options.newCardLimit === "number" ? newCards.slice(0, Math.max(0, options.newCardLimit)) : newCards;
  return [...due, ...cappedNewCards];
}
