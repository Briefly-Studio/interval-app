import type { ReviewEventRecord } from "../../models/reviewEvent";

// Pure, dependency-free (no AsyncStorage, no AuthService, no network) — the one place the
// ReviewEvent dedup/merge rule lives, pulled out of SyncService.ts's applyChanges specifically so
// it can be exercised directly by `node --test` without mocking React Native storage, mirroring
// why pushHelpers.mjs exists as its own file. See docs/spaced-repetition-foundation.md's "Sync
// considerations" section for the full rationale.

export type ReviewEventMergeResult = {
  /** The full merged set for one deck — every existing record, plus any genuinely new incoming
   * ones, each written with `dirty: false` (a record arriving from the server, by definition,
   * needs no further push). Order is not meaningful here; see recomputeCardSchedulingState.ts's
   * own deterministic ordering for replay. */
  merged: ReviewEventRecord[];
  /** Card ids that received at least one genuinely NEW event this merge — the exact set that
   * needs its CardSchedulingState recomputed afterward (Requirement 7: only affected cards, never
   * every card). Empty when every incoming event was already present (a duplicate/repeated
   * pull). */
  affectedCardIds: string[];
};

/**
 * Merges a batch of incoming (pulled) ReviewEventRecords into an existing local set for one deck.
 *
 * Existence-based idempotent add — deliberately NOT the generic `incomingWins` rev/updatedAt
 * conflict rule SyncService.ts uses for every mutable entity. A ReviewEvent's id is
 * content-addressed (computeReviewEventId) and the record is never mutated after creation (rev
 * is always 1), so two records sharing an id are definitionally the same immutable fact — an id
 * already present locally is simply skipped, with no rev/timestamp comparison at all. This is
 * what makes the same event pushed twice, pulled twice, or replayed after a restart a true no-op:
 * identity is the event's own `id`, never payload equality and never ordering.
 */
export function mergeIncomingReviewEvents(
  existing: readonly ReviewEventRecord[],
  incoming: readonly ReviewEventRecord[]
): ReviewEventMergeResult {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const affectedCardIds = new Set<string>();

  for (const event of incoming) {
    if (byId.has(event.id)) continue;
    byId.set(event.id, { ...event, dirty: false });
    affectedCardIds.add(event.cardId);
  }

  return { merged: Array.from(byId.values()), affectedCardIds: Array.from(affectedCardIds) };
}
