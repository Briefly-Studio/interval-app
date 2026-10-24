import { activeScheduler, createDefaultSchedulingState } from "./defaults";
import type { Scheduler } from "./scheduler";
import type { CardSchedulingState } from "./types";

// Migration strategy for this foundation is deliberately simple, because of WHERE scheduling
// state lives: it is its own store, keyed by cardId (src/storage/cardScheduling.ts) — never a
// field bolted onto CardRecord itself (see docs/spaced-repetition-foundation.md's "Storage"
// section for why: CardRecord already syncs to Production on every signed-in user's next sync,
// and adding a scheduling field there would reach Production uncontrolled, exactly the risk
// CLAUDE.md's Deck Collections precedent already warns against for DeckRecord). Because of that,
// a card that has never been reviewed under this system simply has NO entry in that store — there
// is no legacy shape to upgrade/coerce, unlike CardRecord/DeckRecord's `upgradeX` functions. "No
// entry" and "a brand-new card today" are treated identically: both resolve, lazily, to the
// scheduler's own default "nothing has happened yet" state (see defaults.ts) — never a fabricated
// prior review, stability, or difficulty.
//
// This makes migration trivially deterministic and idempotent: resolving a missing state never
// writes anything (see applyCardReview.ts — a real state is only ever persisted once an actual
// review happens), so launching the app any number of times before a card's first real review
// produces the exact same (absence of) data every time. No batch "migrate all existing cards on
// first launch" step exists, or is needed.

/**
 * Resolves the scheduling state to use for a card: the stored state if one exists, otherwise the
 * scheduler's own honest default — identical treatment for a legacy (pre-foundation) card and a
 * brand-new one, since neither has real scheduling history.
 */
export function resolveCardSchedulingState(
  cardId: string,
  now: Date,
  existing: CardSchedulingState | undefined,
  scheduler: Scheduler = activeScheduler
): CardSchedulingState {
  if (existing) return existing;
  return createDefaultSchedulingState(cardId, now, scheduler);
}
