import { test } from "node:test";
import assert from "node:assert/strict";

import { formatSchedulingIntervalPreview } from "./intervalFormat";

const NOW = new Date("2026-01-01T00:00:00.000Z");

test("formatSchedulingIntervalPreview: under 24 hours reports whole minutes", () => {
  assert.deepEqual(formatSchedulingIntervalPreview("2026-01-01T00:10:00.000Z", NOW), { unit: "minutes", value: 10 });
  assert.deepEqual(formatSchedulingIntervalPreview("2026-01-01T00:01:00.000Z", NOW), { unit: "minutes", value: 1 });
});

test("formatSchedulingIntervalPreview: 24 hours or more reports whole days", () => {
  assert.deepEqual(formatSchedulingIntervalPreview("2026-01-02T00:00:00.000Z", NOW), { unit: "days", value: 1 });
  assert.deepEqual(formatSchedulingIntervalPreview("2026-01-09T00:00:00.000Z", NOW), { unit: "days", value: 8 });
});

test("formatSchedulingIntervalPreview: a due date at or before now never reports 0 or negative", () => {
  assert.deepEqual(formatSchedulingIntervalPreview(NOW.toISOString(), NOW), { unit: "minutes", value: 1 });
  assert.deepEqual(formatSchedulingIntervalPreview("2025-12-31T00:00:00.000Z", NOW), { unit: "minutes", value: 1 });
});

test("formatSchedulingIntervalPreview: rounds to the nearest minute/day rather than truncating", () => {
  // 90 seconds -> rounds to 2 minutes, not 1.
  assert.deepEqual(formatSchedulingIntervalPreview("2026-01-01T00:01:30.000Z", NOW), { unit: "minutes", value: 2 });
});
