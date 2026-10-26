import { test } from "node:test";
import assert from "node:assert/strict";

import { computeChunkId, segmentText } from "./chunking";

// computeChunkId/segmentText are the one shared primitive every adapter (TXT, PDF per-page, DOCX,
// XLSX) routes through to produce NormalizedChunk.id — see each adapter's own determinism test
// (docxAdapter.test.ts, pdfAdapter.test.ts) for format-specific coverage. This file tests the
// primitive itself directly, since docs/source-coverage.md's whole premise depends on it: Source
// Coverage re-normalizes a source fresh every time it's viewed and compares chunk ids against
// stored provenance, which is only sound if re-normalizing unchanged content reproduces the same
// ids every time.

test("computeChunkId: identical (sourceId, index, text) always produces the same id", () => {
  const a = computeChunkId("source-1", 0, "Hello world");
  const b = computeChunkId("source-1", 0, "Hello world");
  assert.equal(a, b);
});

test("computeChunkId: a different sourceId changes the id even for identical index/text", () => {
  const a = computeChunkId("source-1", 0, "Hello world");
  const b = computeChunkId("source-2", 0, "Hello world");
  assert.notEqual(a, b);
});

test("computeChunkId: a different index changes the id even for identical text", () => {
  const a = computeChunkId("source-1", 0, "Hello world");
  const b = computeChunkId("source-1", 1, "Hello world");
  assert.notEqual(a, b);
});

test("computeChunkId: different text changes the id — a stable id means stable content", () => {
  const a = computeChunkId("source-1", 0, "Hello world");
  const b = computeChunkId("source-1", 0, "Hello world!");
  assert.notEqual(a, b);
});

test("computeChunkId: a different normalizationVersion changes the id", () => {
  const a = computeChunkId("source-1", 0, "Hello world", 1);
  const b = computeChunkId("source-1", 0, "Hello world", 2);
  assert.notEqual(a, b);
});

test("segmentText: re-normalizing byte-identical source text twice produces byte-identical chunk ids, in the same order", () => {
  const text = "Paragraph one is here.\n\nParagraph two follows with more content to read.\n\nAnd a third paragraph closes it out.";
  const first = segmentText("source-stable", text);
  const second = segmentText("source-stable", text);

  assert.equal(first.chunks.length, second.chunks.length);
  assert.ok(first.chunks.length > 0);
  for (let i = 0; i < first.chunks.length; i++) {
    assert.equal(first.chunks[i].id, second.chunks[i].id);
    assert.equal(first.chunks[i].text, second.chunks[i].text);
  }
});

test("segmentText: a change anywhere in the source content changes that chunk's id, not just a checksum of the whole document", () => {
  // Each paragraph is long enough (~1200 chars) that pass 2's short-paragraph merge (greedy up to
  // DEFAULT_CHUNK_TARGET_CHARS = 2000) would push any two combined past that limit, so each stays
  // its own chunk — this is what makes "only the edited paragraph's id changes" a meaningful,
  // controlled assertion rather than an artifact of merging.
  const longParagraph = (label: string) => `${label} ${"lorem ipsum dolor sit amet ".repeat(42)}`.trim();
  const original = segmentText("source-stable", `${longParagraph("One")}\n\n${longParagraph("Two")}\n\n${longParagraph("Three")}`);
  const edited = segmentText(
    "source-stable",
    `${longParagraph("One")}\n\n${longParagraph("TWO EDITED")}\n\n${longParagraph("Three")}`
  );

  assert.equal(original.chunks.length, 3);
  assert.equal(edited.chunks.length, 3);
  assert.equal(original.chunks[0].id, edited.chunks[0].id, "untouched leading chunk keeps its id");
  assert.notEqual(original.chunks[1].id, edited.chunks[1].id, "edited chunk's id changes");
  assert.equal(original.chunks[2].id, edited.chunks[2].id, "untouched trailing chunk keeps its id");
});
