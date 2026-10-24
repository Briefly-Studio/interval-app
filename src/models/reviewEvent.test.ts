import { test } from "node:test";
import assert from "node:assert/strict";

import { upgradeReviewEventRecord, type ReviewEventRecord } from "./reviewEvent";

const validShape = {
  id: "abc123",
  cardId: "card-1",
  deckId: "deck-1",
  reviewedAt: "2026-01-10T00:00:00.000Z",
  rating: "good",
  previousState: "new",
  resultingState: "learning",
  previousDueAt: "2026-01-10T00:00:00.000Z",
  nextDueAt: "2026-01-10T00:10:00.000Z",
  elapsedDays: 0,
  scheduledDays: 0,
  schedulerAlgorithm: "fsrs",
  schedulerVersion: "v5.4.2 using FSRS-6.0",
};

test("upgradeReviewEventRecord: an already-upgraded record passes through, normalizing dirty", () => {
  const record: ReviewEventRecord = { ...validShape, rev: 1, updatedAt: "2026-01-10T00:00:00.000Z" } as ReviewEventRecord;
  const upgraded = upgradeReviewEventRecord(record);
  assert.ok(upgraded);
  assert.equal(upgraded?.dirty, false);
});

test("upgradeReviewEventRecord: a structurally valid un-rev'd record is rebuilt with rev 0", () => {
  const upgraded = upgradeReviewEventRecord(validShape);
  assert.ok(upgraded);
  assert.equal(upgraded?.id, "abc123");
  assert.equal(upgraded?.rev, 0);
  assert.equal(upgraded?.dirty, false);
});

test("upgradeReviewEventRecord: rejects an invalid rating rather than coercing it", () => {
  assert.equal(upgradeReviewEventRecord({ ...validShape, rating: "medium" }), null);
});

test("upgradeReviewEventRecord: rejects an invalid previousState/resultingState", () => {
  assert.equal(upgradeReviewEventRecord({ ...validShape, previousState: "mastered" }), null);
  assert.equal(upgradeReviewEventRecord({ ...validShape, resultingState: "" }), null);
});

test("upgradeReviewEventRecord: rejects a missing id/cardId/deckId", () => {
  assert.equal(upgradeReviewEventRecord({ ...validShape, id: "" }), null);
  assert.equal(upgradeReviewEventRecord({ ...validShape, cardId: undefined }), null);
  assert.equal(upgradeReviewEventRecord({ ...validShape, deckId: null }), null);
});

test("upgradeReviewEventRecord: rejects a missing/malformed reviewedAt or scheduling-shape field", () => {
  assert.equal(upgradeReviewEventRecord({ ...validShape, reviewedAt: 12345 }), null);
  assert.equal(upgradeReviewEventRecord({ ...validShape, elapsedDays: "0" }), null);
});

test("upgradeReviewEventRecord: has no deletedAt field at all, even when one is present on the input (review events are never soft-deleted)", () => {
  const upgraded = upgradeReviewEventRecord({ ...validShape, deletedAt: "2026-01-11T00:00:00.000Z" });
  assert.ok(upgraded);
  assert.equal((upgraded as any).deletedAt, undefined);
});

test("upgradeReviewEventRecord: optional analytics fields (sessionId, responseTimeMs, stability/difficulty deltas) preserved only when real", () => {
  const withOptionals = upgradeReviewEventRecord({ ...validShape, sessionId: "session-1", responseTimeMs: 4200, nextStability: 2.3 });
  assert.equal(withOptionals?.sessionId, "session-1");
  assert.equal(withOptionals?.responseTimeMs, 4200);
  assert.equal(withOptionals?.nextStability, 2.3);

  const withoutOptionals = upgradeReviewEventRecord(validShape);
  assert.equal(withoutOptionals?.sessionId, undefined);
  assert.equal(withoutOptionals?.responseTimeMs, undefined);
});
