import { test } from "node:test";
import assert from "node:assert/strict";

import { upgradeCardSchedulingRecord, type CardSchedulingRecord } from "./cardScheduling";

const validLegacyShape = {
  cardId: "card-1",
  state: "review",
  dueAt: "2026-01-10T00:00:00.000Z",
  scheduledDays: 3,
  elapsedDays: 1,
  reps: 2,
  lapses: 0,
  schedulerAlgorithm: "fsrs",
  schedulerVersion: "v5.4.2 using FSRS-6.0",
};

test("upgradeCardSchedulingRecord: an already-upgraded record passes through, normalizing dirty", () => {
  const record: CardSchedulingRecord = { ...validLegacyShape, rev: 3, updatedAt: "2026-01-10T00:00:00.000Z" } as CardSchedulingRecord;
  const upgraded = upgradeCardSchedulingRecord(record);
  assert.ok(upgraded);
  assert.equal(upgraded?.rev, 3);
  assert.equal(upgraded?.dirty, false);
});

test("upgradeCardSchedulingRecord: a structurally valid un-rev'd record is rebuilt with rev 0 / dirty false", () => {
  const upgraded = upgradeCardSchedulingRecord(validLegacyShape);
  assert.ok(upgraded);
  assert.equal(upgraded?.cardId, "card-1");
  assert.equal(upgraded?.state, "review");
  assert.equal(upgraded?.rev, 0);
  assert.equal(upgraded?.dirty, false);
  assert.equal(typeof upgraded?.updatedAt, "string");
});

test("upgradeCardSchedulingRecord: rejects (returns null) rather than coerces a missing/invalid cardId", () => {
  assert.equal(upgradeCardSchedulingRecord({ ...validLegacyShape, cardId: "" }), null);
  assert.equal(upgradeCardSchedulingRecord({ ...validLegacyShape, cardId: undefined }), null);
  assert.equal(upgradeCardSchedulingRecord(null), null);
});

test("upgradeCardSchedulingRecord: rejects an invalid learning-state value", () => {
  assert.equal(upgradeCardSchedulingRecord({ ...validLegacyShape, state: "mastered" }), null);
});

test("upgradeCardSchedulingRecord: rejects when a required numeric field is missing or the wrong type", () => {
  const { scheduledDays, ...withoutScheduledDays } = validLegacyShape;
  assert.equal(upgradeCardSchedulingRecord(withoutScheduledDays), null);
  assert.equal(upgradeCardSchedulingRecord({ ...validLegacyShape, reps: "2" }), null);
});

test("upgradeCardSchedulingRecord: optional fields (lastReviewedAt, stability, schedulingDifficulty) are preserved when present and real, omitted when absent", () => {
  const withOptionals = upgradeCardSchedulingRecord({ ...validLegacyShape, lastReviewedAt: "2026-01-09T00:00:00.000Z", stability: 4.2, schedulingDifficulty: 3.1 });
  assert.equal(withOptionals?.lastReviewedAt, "2026-01-09T00:00:00.000Z");
  assert.equal(withOptionals?.stability, 4.2);
  assert.equal(withOptionals?.schedulingDifficulty, 3.1);

  const withoutOptionals = upgradeCardSchedulingRecord(validLegacyShape);
  assert.equal(withoutOptionals?.lastReviewedAt, undefined);
  assert.equal(withoutOptionals?.stability, undefined);
});
