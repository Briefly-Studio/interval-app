import { activeScheduler } from "./defaults";
import type { Scheduler } from "./scheduler";
import type { CardSchedulingState, ReviewEvent } from "./types";

// The recomputation engine at the center of making multi-device scheduling sync safe — see
// docs/spaced-repetition-foundation.md's "Sync considerations" section. `ReviewEvent` history is
// the durable, synced source of truth; `CardSchedulingState` is a derived cache that must always
// be re-derivable from that history by replaying it through a `Scheduler`, never trusted as
// cross-device truth on its own (never resolved by latest-updatedAt/largest-rev/last-device-to-
// sync — see SyncService.ts's reviewEvent handling for why that generic rule is deliberately NOT
// reused here). Pure: no UI dependency, no Date.now(), no network/storage access — every input is
// caller-supplied and a fixed input always produces the same output.

/**
 * Deterministic ordering for replay: primary key is `reviewedAt` (ISO 8601 string — compares
 * correctly as a timestamp via Date.parse, identically to lexical compare since all events use
 * the same fixed-offset UTC format). Ties (two events with the EXACT same `reviewedAt`, which
 * can genuinely happen — e.g. two devices independently constructing a review at the same
 * millisecond) break on the event's own `id` (a stable, deterministic FNV-1a hash — see
 * reviewEvent.ts's `computeReviewEventId`), so replay order is reproducible across every device
 * and every recompute, not merely "whatever order the array happened to arrive in."
 *
 * CLOCK-SKEW LIMITATION (deliberately not solved here — see the mission this was built from):
 * `reviewedAt` is client wall-clock time, not a logical/vector clock. If two devices' clocks are
 * skewed, the chronological order this function derives may not match the real-world order the
 * reviews actually happened in. This is an accepted limitation, not a bug — building distributed-
 * clock infrastructure (Lamport clocks, hybrid logical clocks, server-assigned sequence numbers)
 * is explicitly out of scope for this batch. What this function DOES guarantee: the same set of
 * events always replays in the same order, on every device, every time — determinism, not
 * real-world chronological accuracy under clock skew.
 */
export function orderReviewEventsForReplay(events: readonly ReviewEvent[]): ReviewEvent[] {
  return [...events].sort((a, b) => {
    const diff = Date.parse(a.reviewedAt) - Date.parse(b.reviewedAt);
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export type RecomputeCardSchedulingStateInput = {
  cardId: string;
  /** Every known ReviewEvent for this card — ACROSS every device, already merged (e.g. by sync).
   * Events for OTHER cards are ignored (filtered internally), so a caller may pass a whole deck's
   * event history without pre-filtering. */
  reviewEvents: readonly ReviewEvent[];
  scheduler?: Scheduler;
};

/**
 * Rebuilds a card's CURRENT scheduling state from scratch by replaying its entire merged review
 * history through the scheduler, in deterministic order. Starts from the scheduler's own
 * brand-new-card default (exactly what a never-reviewed card gets — see defaults.ts), then applies
 * each historical rating in turn via `scheduler.scheduleReview`, discarding every intermediate
 * state except the final one.
 *
 * ALGORITHM VERSIONING: each `ReviewEvent` carries the `schedulerAlgorithm`/`schedulerVersion` the
 * engine used AT THE TIME it was created, but replay always uses the CURRENT `activeScheduler`
 * (or the caller-supplied override) for every event, regardless of what version produced it
 * originally. This is a deliberate, documented choice, not an oversight: FSRS's own review
 * algorithm takes a card's prior (stability, difficulty, state, last-review) as plain numeric
 * input and a (rating, now) pair as the review being applied — it does not need to know which
 * past engine VERSION produced that prior state to correctly schedule the NEXT review from it.
 * Replaying old events through today's scheduler is therefore semantically valid under the
 * CURRENT `fsrsScheduler` — the stored `schedulerAlgorithm`/`schedulerVersion` on each event
 * remains valuable as an audit trail (what actually happened, historically) even though replay
 * does not branch on it. If a FUTURE engine swap changes `schedulerAlgorithm` (not just version —
 * e.g. moving off FSRS entirely to a different family of algorithm), replaying pre-swap events
 * under the new algorithm would no longer be automatically valid, and that migration must define
 * its own explicit strategy before this function is reused for it (see defaults.ts's own
 * "Algorithm/version strategy" doc comment) — nothing here silently reinterprets that case.
 */
export function recomputeCardSchedulingState(input: RecomputeCardSchedulingStateInput): CardSchedulingState {
  const scheduler = input.scheduler ?? activeScheduler;

  // Defense-in-depth de-duplication by id (Requirement 6: the same event must never be applied
  // twice, identity-based not payload-based). The normal caller (SyncService's applyChanges) has
  // already deduplicated via its own byId Map before this is ever called, but this function does
  // not trust that — a caller passing the same event twice (e.g. the same id appearing in both a
  // locally-pending list and a just-pulled batch before they've been merged) must still replay it
  // exactly once, so repeated recompute over overlapping-but-not-identical inputs stays
  // deterministic and idempotent.
  const dedupedById = new Map<string, ReviewEvent>();
  for (const event of input.reviewEvents) {
    if (event.cardId !== input.cardId) continue;
    dedupedById.set(event.id, event);
  }
  const cardEvents = orderReviewEventsForReplay(Array.from(dedupedById.values()));

  if (cardEvents.length === 0) {
    // No history at all — the honest "nothing has happened yet" default, same as a brand-new
    // card. Anchored at the Unix epoch, deliberately NOT `Date.now()` — this function must be
    // pure (same input always produces the same output), and a zero-event card has no real
    // timestamp to anchor to. This is safe: dueSelection.ts's isNew/isDue/isOverdue/isFuture all
    // branch on `state === "new"` before ever consulting `dueAt`, so the exact epoch value here
    // has no effect on due-queue behavior. In practice this branch is never reached by
    // SyncService (it only recomputes cards that just received at least one event), but a
    // general-purpose pure function must still handle it deterministically.
    return scheduler.createNewCardState(input.cardId, new Date(0));
  }

  let state = scheduler.createNewCardState(input.cardId, new Date(cardEvents[0].reviewedAt));
  for (const event of cardEvents) {
    const outcome = scheduler.scheduleReview(state, event.rating, new Date(event.reviewedAt));
    state = outcome.nextState;
  }
  return state;
}
