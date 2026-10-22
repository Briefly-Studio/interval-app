import { test } from "node:test";
import assert from "node:assert/strict";

import { utcCalendarDayDiff } from "./scheduler";

test("utcCalendarDayDiff: zero for the same UTC calendar day, regardless of time of day", () => {
  assert.equal(utcCalendarDayDiff(new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T23:59:59.000Z")), 0);
});

test("utcCalendarDayDiff: one for consecutive UTC calendar days, even if less than 24 real hours apart", () => {
  // 2026-01-01 23:00 UTC -> 2026-01-02 01:00 UTC is only 2 real hours, but crosses a UTC calendar
  // day boundary — calendar-day diffing (not a 24h duration divide) must still report 1.
  assert.equal(utcCalendarDayDiff(new Date("2026-01-01T23:00:00.000Z"), new Date("2026-01-02T01:00:00.000Z")), 1);
});

test("utcCalendarDayDiff: a full real 24 hours within the same UTC calendar day reports 0 if it doesn't cross midnight", () => {
  assert.equal(utcCalendarDayDiff(new Date("2026-01-01T01:00:00.000Z"), new Date("2026-01-01T23:00:00.000Z")), 0);
});

test("utcCalendarDayDiff: exact N-day differences", () => {
  assert.equal(utcCalendarDayDiff(new Date("2026-01-01T12:00:00.000Z"), new Date("2026-01-08T00:00:00.000Z")), 7);
  assert.equal(utcCalendarDayDiff(new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-08T00:00:00.000Z")), 7);
});

test("utcCalendarDayDiff: never negative-zero or reversed-sign surprises for identical instants", () => {
  const now = new Date("2026-06-15T08:30:00.000Z");
  assert.equal(utcCalendarDayDiff(now, now), 0);
});

test("utcCalendarDayDiff: negative when 'later' is actually earlier than 'earlier'", () => {
  assert.equal(utcCalendarDayDiff(new Date("2026-01-10T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z")), -9);
});

test("utcCalendarDayDiff: a UTC year boundary is a simple one-day step, not a special case", () => {
  assert.equal(utcCalendarDayDiff(new Date("2025-12-31T23:00:00.000Z"), new Date("2026-01-01T01:00:00.000Z")), 1);
});
