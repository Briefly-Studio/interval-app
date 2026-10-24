import { test } from "node:test";
import assert from "node:assert/strict";

import { validateChange } from "./validateChange";

function validRawReviewEventChange(overrides: Record<string, unknown> = {}) {
  const record = {
    id: "ev-1",
    cardId: "card-1",
    deckId: "deck-1",
    reviewedAt: "2026-01-01T00:00:00.000Z",
    rating: "good",
    previousState: "new",
    resultingState: "learning",
    previousDueAt: "2026-01-01T00:00:00.000Z",
    nextDueAt: "2026-01-01T00:10:00.000Z",
    elapsedDays: 0,
    scheduledDays: 0,
    schedulerAlgorithm: "fsrs",
    schedulerVersion: "v5.4.2 using FSRS-6.0",
    rev: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
  return {
    id: "ev-1",
    entity: "reviewEvent",
    op: "upsert",
    record,
    ts: "2026-01-01T00:00:00.000Z",
  };
}

test("validateChange accepts a well-formed reviewEvent change", () => {
  const result = validateChange(validRawReviewEventChange());
  assert.equal(result.ok, true);
});

test("validateChange rejects a reviewEvent with an invalid rating", () => {
  const raw = validRawReviewEventChange();
  (raw.record as Record<string, unknown>).rating = "terrible";
  const result = validateChange(raw);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.rejected.reason, "malformed-reviewEvent-record");
});

test("validateChange rejects a reviewEvent with an invalid previousState/resultingState", () => {
  const raw = validRawReviewEventChange({ previousState: "bogus" });
  const result = validateChange(raw);
  assert.equal(result.ok, false);
});

test("validateChange rejects a reviewEvent missing cardId or deckId", () => {
  const missingCardId = validRawReviewEventChange();
  delete (missingCardId.record as Record<string, unknown>).cardId;
  assert.equal(validateChange(missingCardId).ok, false);

  const missingDeckId = validRawReviewEventChange();
  delete (missingDeckId.record as Record<string, unknown>).deckId;
  assert.equal(validateChange(missingDeckId).ok, false);
});

test("validateChange rejects a reviewEvent whose record.id does not match the outer change id", () => {
  const raw = validRawReviewEventChange();
  (raw.record as Record<string, unknown>).id = "different-id";
  const result = validateChange(raw);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.rejected.reason, "id-mismatch");
});

test("validateChange rejects a reviewEvent missing rev or updatedAt", () => {
  const missingRev = validRawReviewEventChange();
  delete (missingRev.record as Record<string, unknown>).rev;
  assert.equal(validateChange(missingRev).ok, false);

  const missingUpdatedAt = validRawReviewEventChange();
  delete (missingUpdatedAt.record as Record<string, unknown>).updatedAt;
  assert.equal(validateChange(missingUpdatedAt).ok, false);
});

test("validateChange's ENTITY_TYPES now recognizes 'reviewEvent' as a known entity", () => {
  const raw = validRawReviewEventChange();
  raw.entity = "reviewEvent";
  const result = validateChange(raw);
  assert.equal(result.ok, true);
});
