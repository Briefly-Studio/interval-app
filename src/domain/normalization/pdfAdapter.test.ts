import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CHUNKS } from "./chunking";
import { normalizePdfTextSource } from "./pdfAdapter";

function baseInput(pages: string[]) {
  return {
    sourceId: "pdf-src-1",
    sourceType: "pdf" as const,
    title: "Test PDF",
    pages,
  };
}

test("normalizePdfTextSource: a single page produces chunks tagged with page 1", () => {
  const outcome = normalizePdfTextSource(baseInput(["This is the only page of a short PDF document."]));
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.ok(outcome.content.chunks.length >= 1);
  for (const chunk of outcome.content.chunks) {
    assert.equal(chunk.provenance.page, 1);
  }
  assert.equal(outcome.content.contentKind, "text");
  assert.equal(outcome.content.extraction.status, "ready");
  assert.equal(outcome.content.extraction.adapter, "pdf-text-v1");
  assert.equal(outcome.content.metadata.pageCount, 1);
});

test("normalizePdfTextSource: chunk ordering and page provenance are preserved across multiple pages", () => {
  const pages = ["Page one content about photosynthesis.", "Page two content about mitochondria.", "Page three content about ribosomes."];
  const outcome = normalizePdfTextSource(baseInput(pages));
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;

  const chunks = outcome.content.chunks;
  assert.ok(chunks.length >= 3);

  // index must be a single, strictly-increasing GLOBAL sequence across the whole document —
  // never reset per page (contextPreparation.ts's preserveOriginalOrder sorts by this field).
  for (let i = 0; i < chunks.length; i++) {
    assert.equal(chunks[i].index, i);
  }

  // Page numbers must be non-decreasing across the chunk sequence (document order preserved).
  const pageNumbers = chunks.map((c) => c.provenance.page);
  for (let i = 1; i < pageNumbers.length; i++) {
    assert.ok((pageNumbers[i] as number) >= (pageNumbers[i - 1] as number));
  }
  assert.deepEqual(new Set(pageNumbers), new Set([1, 2, 3]));

  // Each chunk's text should actually come from its own claimed page.
  const page1Chunk = chunks.find((c) => c.provenance.page === 1);
  const page2Chunk = chunks.find((c) => c.provenance.page === 2);
  assert.match(page1Chunk?.text ?? "", /photosynthesis/);
  assert.match(page2Chunk?.text ?? "", /mitochondria/);
});

test("normalizePdfTextSource: blank/whitespace-only pages contribute zero chunks but don't break numbering of real pages", () => {
  const pages = ["Real content on page one.", "   \n\n  ", "Real content on page three."];
  const outcome = normalizePdfTextSource(baseInput(pages));
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;

  const pageNumbers = new Set(outcome.content.chunks.map((c) => c.provenance.page));
  assert.ok(!pageNumbers.has(2));
  assert.ok(pageNumbers.has(1));
  assert.ok(pageNumbers.has(3));
});

test("normalizePdfTextSource: deterministic — identical input always produces identical chunks/ids", () => {
  const pages = ["Alpha page text.", "Beta page text."];
  const a = normalizePdfTextSource(baseInput(pages));
  const b = normalizePdfTextSource(baseInput(pages));
  assert.deepEqual(a, b);
});

test("normalizePdfTextSource: chunk ids are recomputed against the GLOBAL index, not a per-page-local one", () => {
  // Two single-chunk pages with deliberately swapped text, to confirm the id really is a function
  // of (sourceId, GLOBAL index, text) and not accidentally collapsed to a per-page-local index
  // that would make page 2's first chunk indistinguishable in id-space from page 1's first chunk.
  const outcome = normalizePdfTextSource(baseInput(["First page unique text.", "Second page unique text."]));
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  const ids = outcome.content.chunks.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "chunk ids must be unique across pages");
});

test("normalizePdfTextSource: exceeding the global chunk-count ceiling reports too-large", () => {
  // One chunk per page, deliberately one page over MAX_CHUNKS, to exercise the GLOBAL (cross-page)
  // ceiling check — not segmentText's own per-page MAX_CHUNKS guard, which a single page could
  // never realistically reach on its own.
  const pages = Array.from({ length: MAX_CHUNKS + 1 }, (_, i) => `Short unique page content number ${i}.`);
  const outcome = normalizePdfTextSource(baseInput(pages));
  assert.equal(outcome.status, "too-large");
});

test("normalizePdfTextSource: charRange is source-wide — strictly increasing and non-overlapping across pages", () => {
  const pages = ["Page one content about photosynthesis.", "Page two content about mitochondria.", "Page three content about ribosomes."];
  const outcome = normalizePdfTextSource(baseInput(pages));
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;

  const chunks = outcome.content.chunks;
  assert.ok(chunks.length >= 3);

  // Every chunk has a charRange, and ranges never overlap/repeat across pages — each page's
  // local offsets must have been shifted into one shared, whole-document coordinate space.
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1].provenance.charRange;
    const cur = chunks[i].provenance.charRange;
    assert.ok(prev && cur, "every PDF chunk must carry a charRange");
    assert.ok(cur!.start >= prev!.end, "a later chunk's charRange must not start before the previous chunk's ends");
  }

  // Page 2 and page 3's chunks must start at a strictly later document-wide offset than page 1's —
  // the old, buggy page-relative implementation would have had page 2 and page 3 restart near 0,
  // producing identical/overlapping ranges to page 1's.
  const page1End = Math.max(...chunks.filter((c) => c.provenance.page === 1).map((c) => c.provenance.charRange!.end));
  const page2Start = Math.min(...chunks.filter((c) => c.provenance.page === 2).map((c) => c.provenance.charRange!.start));
  const page3Start = Math.min(...chunks.filter((c) => c.provenance.page === 3).map((c) => c.provenance.charRange!.start));
  assert.ok(page2Start >= page1End);
  assert.ok(page3Start > page2Start);
});

test("normalizePdfTextSource: a blank middle page still shifts the following page's charRange forward", () => {
  const withBlank = normalizePdfTextSource(baseInput(["Real content on page one.", "   \n\n  ", "Real content on page three."]));
  assert.equal(withBlank.status, "ready");
  if (withBlank.status !== "ready") return;

  const page3Chunk = withBlank.content.chunks.find((c) => c.provenance.page === 3);
  const page1Chunk = withBlank.content.chunks.find((c) => c.provenance.page === 1);
  assert.ok(page3Chunk?.provenance.charRange && page1Chunk?.provenance.charRange);
  // Page 3's offset must account for page 1's AND the blank page 2's length (plus separators) —
  // strictly greater than where page 1 alone would end, not merely greater than zero.
  assert.ok(page3Chunk!.provenance.charRange!.start > page1Chunk!.provenance.charRange!.end);
});

test("normalizePdfTextSource: never populates lineRange — page is the only location signal, so it is never masked by a synthetic line citation", () => {
  const outcome = normalizePdfTextSource(baseInput(["Line one.\nLine two.\nLine three.", "Another page.\nWith lines too."]));
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  for (const chunk of outcome.content.chunks) {
    assert.equal(chunk.provenance.lineRange, undefined);
    assert.equal(typeof chunk.provenance.page, "number");
  }
});

test("normalizePdfTextSource: zero pages produces a ready result with zero chunks", () => {
  // normalizeSource.ts's own orchestration never reaches the adapter with zero pages in practice
  // (pdfTextExtraction.ts maps that case to "empty" before this adapter is ever called) — this
  // test only confirms the adapter itself degrades gracefully rather than throwing, as a
  // defense-in-depth property of the pure function in isolation.
  const outcome = normalizePdfTextSource(baseInput([]));
  assert.equal(outcome.status, "ready");
  if (outcome.status === "ready") {
    assert.equal(outcome.content.chunks.length, 0);
    assert.equal(outcome.content.metadata.pageCount, 0);
  }
});
