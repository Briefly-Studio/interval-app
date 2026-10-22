import type { CardLearningState, CardSchedulingState } from "../domain/scheduling/types";

// The storage-level record for one card's CURRENT, derived scheduling state — see
// src/domain/scheduling/types.ts for the pure domain shape this extends, and
// docs/spaced-repetition-foundation.md for why this is its own record (keyed by `cardId`, the
// same identity CardRecord uses) rather than a field on CardRecord itself.
//
// Carries the same rev/updatedAt/dirty contract every other synced-shaped record in this app
// uses, even though this record is NOT wired into src/cloud/sync/** in this batch — so a future
// sync-enablement pass only has to touch the sync files (see that same doc's "Sync considerations"
// section), never this shape. `deletedAt` is present for the same forward-compatibility reason,
// but nothing in this batch ever sets it — a card's scheduling state is deliberately left
// untouched (never tombstoned) when the card itself is soft-deleted, so restoring the card later
// naturally restores its scheduling history too; see migration.ts's header comment.

export type CardSchedulingRecord = CardSchedulingState & {
  rev: number;
  updatedAt: string;
  dirty?: boolean;
  deletedAt?: string;
};

const VALID_STATES: readonly CardLearningState[] = ["new", "learning", "review", "relearning"];

function isValidState(value: unknown): value is CardLearningState {
  return typeof value === "string" && (VALID_STATES as readonly string[]).includes(value);
}

/**
 * Local-data upgrade helper, mirroring upgradeCard/upgradeDeck's own two-branch pattern: an
 * already-upgraded record (has `rev`/`updatedAt`) passes through unchanged aside from
 * normalizing `dirty`; anything else is treated as malformed/legacy and rebuilt with safe
 * defaults. Unlike `upgradeCard`, there is no "trusted legacy shape" this record type predates —
 * this function exists for forward safety (a future format change to this exact record) and to
 * keep the same resilience-on-read posture every other `getXAll` storage function already has,
 * not because any legacy shape is known to exist today.
 */
export function upgradeCardSchedulingRecord(value: any): CardSchedulingRecord | null {
  if (!value || typeof value.cardId !== "string" || !value.cardId) return null;
  if (!isValidState(value.state)) return null;
  if (typeof value.dueAt !== "string" || !value.dueAt) return null;
  if (typeof value.scheduledDays !== "number") return null;
  if (typeof value.elapsedDays !== "number") return null;
  if (typeof value.reps !== "number") return null;
  if (typeof value.lapses !== "number") return null;
  if (typeof value.schedulerAlgorithm !== "string" || !value.schedulerAlgorithm) return null;
  if (typeof value.schedulerVersion !== "string" || !value.schedulerVersion) return null;

  if (typeof value.rev === "number" && typeof value.updatedAt === "string") {
    return { ...value, dirty: value.dirty ?? false };
  }

  return {
    cardId: value.cardId,
    state: value.state,
    dueAt: value.dueAt,
    lastReviewedAt: typeof value.lastReviewedAt === "string" ? value.lastReviewedAt : undefined,
    stability: typeof value.stability === "number" ? value.stability : undefined,
    schedulingDifficulty: typeof value.schedulingDifficulty === "number" ? value.schedulingDifficulty : undefined,
    scheduledDays: value.scheduledDays,
    elapsedDays: value.elapsedDays,
    reps: value.reps,
    lapses: value.lapses,
    schedulerAlgorithm: value.schedulerAlgorithm,
    schedulerVersion: value.schedulerVersion,
    rev: 0,
    updatedAt: new Date().toISOString(),
    dirty: false,
  };
}
