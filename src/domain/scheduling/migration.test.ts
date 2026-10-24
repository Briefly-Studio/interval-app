import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveCardSchedulingState } from "./migration";
import { fsrsScheduler } from "./fsrsScheduler";

const NOW = new Date("2026-01-01T00:00:00.000Z");

test("resolveCardSchedulingState: a legacy card with no stored state resolves to the honest 'nothing has happened yet' default", () => {
  const state = resolveCardSchedulingState("card-1", NOW, undefined, fsrsScheduler);
  assert.equal(state.state, "new");
  assert.equal(state.dueAt, NOW.toISOString());
  assert.equal(state.lastReviewedAt, undefined);
  assert.equal(state.stability, undefined);
  assert.equal(state.reps, 0);
  assert.equal(state.lapses, 0);
});

test("resolveCardSchedulingState: a brand-new card today resolves to the exact same default shape as a migrated legacy card", () => {
  const legacy = resolveCardSchedulingState("card-1", NOW, undefined, fsrsScheduler);
  const freshToday = resolveCardSchedulingState("card-2", NOW, undefined, fsrsScheduler);
  assert.equal(legacy.state, freshToday.state);
  assert.equal(legacy.stability, freshToday.stability);
  assert.equal(legacy.reps, freshToday.reps);
});

test("resolveCardSchedulingState: an existing stored state is returned as-is, never overwritten or re-defaulted", () => {
  const existing = fsrsScheduler.createNewCardState("card-1", new Date("2025-06-01T00:00:00.000Z"));
  const reviewed = fsrsScheduler.scheduleReview(existing, "good", new Date("2025-06-01T00:00:00.000Z"));
  const resolved = resolveCardSchedulingState("card-1", NOW, reviewed.nextState, fsrsScheduler);
  assert.deepEqual(resolved, reviewed.nextState);
});

test("resolveCardSchedulingState is idempotent — resolving a missing state repeatedly for the same `now` always produces the same result, and never implicitly persists anything by itself", () => {
  const first = resolveCardSchedulingState("card-1", NOW, undefined, fsrsScheduler);
  const second = resolveCardSchedulingState("card-1", NOW, undefined, fsrsScheduler);
  assert.deepEqual(first, second);
});

test("resolveCardSchedulingState never fabricates a past review for a legacy card even when `now` is far in the future", () => {
  const farFuture = new Date("2030-01-01T00:00:00.000Z");
  const state = resolveCardSchedulingState("card-1", farFuture, undefined, fsrsScheduler);
  assert.equal(state.lastReviewedAt, undefined);
  assert.equal(state.reps, 0);
  // Due immediately as of the moment it was resolved — not backdated to any earlier time.
  assert.equal(state.dueAt, farFuture.toISOString());
});
