import { fsrsScheduler } from "./fsrsScheduler";
import type { Scheduler } from "./scheduler";
import type { CardSchedulingState } from "./types";

// The single place the app decides WHICH scheduling engine is active. Every other file
// (storage, UI, applyCardReview.ts, dueSelection.ts) imports `activeScheduler` from here — never
// `fsrsScheduler` directly — so swapping engines later is a one-line change, never a search-and-
// replace across the app. See docs/spaced-repetition-foundation.md's "Algorithm/version
// strategy" section for how a future engine swap should be handled (old ReviewEvents remain
// valid; existing CardSchedulingState is not silently rescheduled without an explicit, separate
// product decision).
export const activeScheduler: Scheduler = fsrsScheduler;

/**
 * The scheduling state ANY card with no prior scheduling state should start in — a brand-new
 * card today, or a legacy card (created before this foundation existed) being migrated for the
 * first time. Both cases are identical on purpose: neither has any real scheduling history, so
 * both get the engine's own honest "nothing has happened yet" default (immediately due, no
 * fabricated stability/difficulty/review count) — never a synthetic past review or an invented
 * interval. See migration.ts for how this is applied idempotently to existing cards.
 */
export function createDefaultSchedulingState(cardId: string, now: Date, scheduler: Scheduler = activeScheduler): CardSchedulingState {
  return scheduler.createNewCardState(cardId, now);
}
