import assert from "node:assert/strict";
import test from "node:test";

import { EVALUATION_FIXTURES, getEvaluationFixture } from "./fixtures";

test("EVALUATION_FIXTURES: every fixture builds a ready, non-empty NormalizedSourceContent", () => {
  for (const fixture of EVALUATION_FIXTURES) {
    const content = fixture.buildNormalizedContent();
    assert.equal(content.extraction.status, "ready", `fixture "${fixture.id}" did not normalize to ready`);
    assert.ok(content.chunks.length > 0, `fixture "${fixture.id}" produced zero chunks`);
    assert.equal(content.sourceType, fixture.sourceType);
    assert.equal(content.language, fixture.language);
  }
});

test("EVALUATION_FIXTURES: every fixture id is unique", () => {
  const ids = EVALUATION_FIXTURES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("EVALUATION_FIXTURES: chunk ids are real, deterministic content-addressed ids (chunk_<8 hex>)", () => {
  for (const fixture of EVALUATION_FIXTURES) {
    const content = fixture.buildNormalizedContent();
    for (const chunk of content.chunks) {
      assert.match(chunk.id, /^chunk_[0-9a-f]{8}$/, `fixture "${fixture.id}" chunk id ${chunk.id}`);
    }
  }
});

test("EVALUATION_FIXTURES: rebuilding the same fixture twice is fully deterministic (same chunk ids/text)", () => {
  for (const fixture of EVALUATION_FIXTURES) {
    const a = fixture.buildNormalizedContent();
    const b = fixture.buildNormalizedContent();
    assert.deepEqual(a.chunks.map((c) => c.id), b.chunks.map((c) => c.id));
    assert.deepEqual(a.chunks.map((c) => c.text), b.chunks.map((c) => c.text));
  }
});

test("pdf-structured-facts: real page-based provenance, no lineRange (matches the real PDF adapter's own contract)", () => {
  const content = getEvaluationFixture("pdf-structured-facts").buildNormalizedContent();
  assert.ok(content.chunks.every((c) => typeof c.provenance.page === "number"));
  assert.ok(content.chunks.every((c) => c.provenance.lineRange === undefined));
});

test("docx-structured-headings: real blockType variety and heading provenance", () => {
  const content = getEvaluationFixture("docx-structured-headings").buildNormalizedContent();
  const blockTypes = new Set(content.chunks.map((c) => c.blockType));
  assert.ok(blockTypes.has("heading"));
  assert.ok(blockTypes.has("paragraph"));
  assert.ok(blockTypes.has("tableRow"));
  assert.ok(content.chunks.some((c) => c.provenance.heading === "Watering"));
});

test("xlsx-spreadsheet-facts: chunk text contains the real 'Sheet:'/'Row N:' shape buildSpreadsheetText produces", () => {
  const content = getEvaluationFixture("xlsx-spreadsheet-facts").buildNormalizedContent();
  const allText = content.chunks.map((c) => c.text).join("\n");
  assert.match(allText, /Sheet: Elements/);
  assert.match(allText, /Row \d+: /);
});

test("docx-large-multibatch: total candidate size exceeds one default context budget (forces multi-batch planning)", () => {
  const content = getEvaluationFixture("docx-large-multibatch").buildNormalizedContent();
  const totalChars = content.chunks.reduce((sum, c) => sum + c.text.length, 0);
  assert.ok(totalChars > 24_000, `expected > 24,000 total chars, got ${totalChars}`);
});

test("getEvaluationFixture: throws a clear error for an unknown id", () => {
  assert.throws(() => getEvaluationFixture("does-not-exist"), /Unknown evaluation fixture id/);
});

test("txt-spanish-baseline: Unicode content survives normalization intact", () => {
  const content = getEvaluationFixture("txt-spanish-baseline").buildNormalizedContent();
  const allText = content.chunks.map((c) => c.text).join(" ");
  assert.match(allText, /evaporación/);
  assert.match(allText, /condensación/);
});
