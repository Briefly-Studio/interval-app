import type { CardSchedulingState, ReviewRating, SchedulerPreviewEntry, SchedulerReviewOutcome } from "./types";

// The ONE boundary a scheduling engine must satisfy. Nothing outside src/domain/scheduling/
// (storage, UI, future sync) is allowed to import a specific engine's own types or call its API
// directly — every caller goes through a `Scheduler`. Swapping fsrsScheduler.ts for a different
// engine (a newer FSRS major version, a different algorithm entirely) means writing one new file
// that satisfies this interface; nothing else in the app changes. See
// docs/spaced-repetition-foundation.md's "Scheduler architecture" section.

export interface Scheduler {
  readonly algorithm: string;
  readonly version: string;
  /** The scheduling state a card starts in the moment it becomes eligible for scheduling —
   * immediately due, zero stability/difficulty. Used both for a brand-new card and for migrating
   * a legacy card with no prior scheduling state (see migration.ts) — NEVER backfilled with
   * invented historical stability/difficulty/review counts, only this engine's own, real,
   * algorithmic "nothing has happened yet" defaults. */
  createNewCardState(cardId: string, now: Date): CardSchedulingState;
  /** Applies one real review outcome, deterministically, for a fixed `now` — no internal
   * `Date.now()` call. */
  scheduleReview(state: CardSchedulingState, rating: ReviewRating, now: Date): SchedulerReviewOutcome;
  /** Previews all four possible outcomes without mutating or persisting anything — what the
   * review screen shows before the user picks a rating. */
  previewReview(state: CardSchedulingState, now: Date): SchedulerPreviewEntry[];
}

/**
 * UTC calendar-day difference between two instants — discards time-of-day, matching exactly how
 * the FSRS reference algorithm itself measures "elapsed days" (see fsrsScheduler.ts's header
 * comment for the verified source). Deliberately NOT a fractional-duration divide-by-86400000:
 * calendar-day diffing is timezone-boundary-safe by construction (both inputs are read via their
 * UTC Y/M/D components, so the device's local timezone never enters the calculation) and keeps
 * this app's own notion of "elapsed days" identical to what the scheduling engine computes
 * internally, regardless of which engine is behind the `Scheduler` boundary.
 */
export function utcCalendarDayDiff(earlier: Date, later: Date): number {
  const utcEarlier = Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate());
  const utcLater = Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate());
  return Math.floor((utcLater - utcEarlier) / 86_400_000);
}
