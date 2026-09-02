// Pure-logic tests for the DOCX table column-sizing helper. Runs on Node's built-in test runner
// with zero added dependencies:  npm run test:docx
import test from "node:test";
import assert from "node:assert/strict";

import { DOCX_TABLE_MIN_COLUMN_WIDTH, computeDocxTableLayout } from "./docxTableLayout.ts";

const PHONE = 360; // a representative phone content width in dp

test("single column fills the viewport and never scrolls", () => {
  const layout = computeDocxTableLayout(1, PHONE);
  assert.equal(layout.columnCount, 1);
  assert.equal(layout.columnWidth, PHONE);
  assert.equal(layout.tableWidth, PHONE);
  assert.equal(layout.scrollable, false);
});

test("two narrow columns split the viewport evenly, no scroll, no wasted space", () => {
  const layout = computeDocxTableLayout(2, PHONE);
  assert.equal(layout.columnWidth, 180);
  assert.equal(layout.tableWidth, 360);
  assert.equal(layout.scrollable, false);
});

test("four columns exceed a phone viewport -> min width per column, scrolls", () => {
  const layout = computeDocxTableLayout(4, PHONE);
  assert.equal(layout.columnWidth, DOCX_TABLE_MIN_COLUMN_WIDTH);
  assert.equal(layout.tableWidth, 4 * DOCX_TABLE_MIN_COLUMN_WIDTH); // 480 > 360
  assert.equal(layout.scrollable, true);
});

test("eight-plus columns stay at the readable minimum and scroll far past the viewport", () => {
  const layout = computeDocxTableLayout(8, PHONE);
  assert.equal(layout.columnWidth, DOCX_TABLE_MIN_COLUMN_WIDTH);
  assert.equal(layout.tableWidth, 960);
  assert.equal(layout.scrollable, true);

  const many = computeDocxTableLayout(20, PHONE);
  assert.equal(many.columnWidth, DOCX_TABLE_MIN_COLUMN_WIDTH);
  assert.equal(many.tableWidth, 2400);
  assert.equal(many.scrollable, true);
});

test("viewport narrower than a single minimum column still yields a readable, scrollable column", () => {
  const layout = computeDocxTableLayout(1, 80);
  assert.equal(layout.columnWidth, DOCX_TABLE_MIN_COLUMN_WIDTH);
  assert.equal(layout.tableWidth, DOCX_TABLE_MIN_COLUMN_WIDTH);
  assert.equal(layout.scrollable, true);
});

test("viewport much wider than the natural table widens columns evenly instead of scrolling", () => {
  const layout = computeDocxTableLayout(3, 1200);
  assert.equal(layout.columnWidth, 400);
  assert.equal(layout.tableWidth, 1200);
  assert.equal(layout.scrollable, false);
});

test("exact-fit boundary (columns * min === viewport) does not scroll", () => {
  const layout = computeDocxTableLayout(3, 3 * DOCX_TABLE_MIN_COLUMN_WIDTH);
  assert.equal(layout.columnWidth, DOCX_TABLE_MIN_COLUMN_WIDTH);
  assert.equal(layout.scrollable, false);
});

test("zero / negative / non-finite column counts are handled without throwing", () => {
  for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
    const layout = computeDocxTableLayout(bad, PHONE);
    assert.equal(layout.columnCount, 0);
    assert.equal(layout.scrollable, false);
    assert.ok(layout.tableWidth > 0);
    assert.ok(layout.columnWidth > 0);
  }
});

test("non-finite viewport falls back to a single minimum column width", () => {
  // With no real viewport, the fallback is one minimum column (120), so any multi-column table
  // is treated as wide and made scrollable rather than crammed into an unknown width.
  const layout = computeDocxTableLayout(2, Number.NaN);
  assert.equal(layout.columnWidth, DOCX_TABLE_MIN_COLUMN_WIDTH);
  assert.equal(layout.tableWidth, 2 * DOCX_TABLE_MIN_COLUMN_WIDTH);
  assert.equal(layout.scrollable, true);
});

test("a custom minimum column width is honored", () => {
  const layout = computeDocxTableLayout(4, PHONE, 80);
  assert.equal(layout.columnWidth, 90); // 4 * 80 = 320 <= 360 -> even split of 360
  assert.equal(layout.scrollable, false);
});

test("fractional column counts are floored", () => {
  const layout = computeDocxTableLayout(2.9, PHONE);
  assert.equal(layout.columnCount, 2);
});
