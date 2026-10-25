import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ABSOLUTE_MAX_CARDS_PER_DECK,
  CARD_COUNT_PRESETS,
  resolveRequestedCardCount,
  resolveTargetMinimumCardCount,
} from "./generationOptions";

test("resolveRequestedCardCount: unchanged ceiling for each named tier", () => {
  assert.equal(resolveRequestedCardCount("small"), 8);
  assert.equal(resolveRequestedCardCount("medium"), 15);
  assert.equal(resolveRequestedCardCount("large"), 25);
});

test("resolveTargetMinimumCardCount: the documented quality floor for each named tier", () => {
  assert.equal(resolveTargetMinimumCardCount("small"), 5);
  assert.equal(resolveTargetMinimumCardCount("medium"), 10);
  assert.equal(resolveTargetMinimumCardCount("large"), 18);
});

test("every preset's targetMinimum is strictly less than or equal to its target (never an inverted range)", () => {
  for (const tier of Object.values(CARD_COUNT_PRESETS)) {
    assert.ok(tier.targetMinimum <= tier.target, `targetMinimum ${tier.targetMinimum} must be <= target ${tier.target}`);
  }
});

test("resolveTargetMinimumCardCount: an explicit numeric override has no slack — the minimum equals the number itself", () => {
  assert.equal(resolveTargetMinimumCardCount(12), 12);
});

test("resolveTargetMinimumCardCount: an explicit numeric override is clamped the same way resolveRequestedCardCount is", () => {
  assert.equal(resolveTargetMinimumCardCount(0), 1);
  assert.equal(resolveTargetMinimumCardCount(1000), ABSOLUTE_MAX_CARDS_PER_DECK);
});

test("resolveTargetMinimumCardCount never exceeds resolveRequestedCardCount for the same input", () => {
  for (const option of ["small", "medium", "large"] as const) {
    assert.ok(resolveTargetMinimumCardCount(option) <= resolveRequestedCardCount(option));
  }
  assert.ok(resolveTargetMinimumCardCount(7) <= resolveRequestedCardCount(7));
});
