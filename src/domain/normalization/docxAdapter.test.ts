import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync } from "fflate";

import { mapDocxBlocksToGenericBlocks, normalizeDocxSource, normalizeStructuredBlocks } from "./docxAdapter";
import type { DocxBlock } from "../docxContent";
import { prepareGenerationContext } from "../ai/contextPreparation";

// Builds a minimal, valid word/document.xml string from a handful of hand-written WordprocessingML
// snippets — the same tag vocabulary docxContent.ts's own header comment documents (w:p, w:r, w:t,
// w:pStyle, w:numPr, w:tbl/w:tr/w:tc, w:drawing/a:blip).
function heading(level: 1 | 2 | 3, text: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}
function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}
function listItem(text: string): string {
  return `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}
function tableRow(cells: string[]): string {
  const tc = cells.map((c) => `<w:tc><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>`).join("");
  return `<w:tr>${tc}</w:tr>`;
}
function table(rows: string[]): string {
  return `<w:tbl>${rows.join("")}</w:tbl>`;
}
function imageParagraph(relationshipId: string): string {
  return `<w:p><w:r><w:drawing><a:blip r:embed="${relationshipId}"/></w:drawing></w:r></w:p>`;
}

function documentXml(bodyXml: string): string {
  return `<?xml version="1.0"?><w:document><w:body>${bodyXml}</w:body></w:document>`;
}

/** Builds a minimal, real DOCX (ZIP) archive containing only word/document.xml — enough for
 * readDocxArchive to parse, exactly as sourceReaderDocx.ts's own allow-list expects. */
function buildDocxArchive(bodyXml: string): Uint8Array {
  const xml = documentXml(bodyXml);
  return zipSync({ "word/document.xml": new TextEncoder().encode(xml) }, { level: 0 });
}

const baseInput = { sourceId: "src-1", sourceType: "docx" as const, title: "Test Document" };

test("normalizeDocxSource: a simple document (heading + paragraph) produces ordered, ready chunks", () => {
  const archiveBytes = buildDocxArchive(heading(1, "Chapter One") + paragraph("Some body text."));
  const outcome = normalizeDocxSource({ ...baseInput, archiveBytes });
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.equal(outcome.content.contentKind, "structured-text");
  assert.equal(outcome.content.chunks.length, 2);
  assert.equal(outcome.content.chunks[0].text, "Chapter One");
  assert.equal(outcome.content.chunks[0].blockType, "heading");
  assert.equal(outcome.content.chunks[1].text, "Some body text.");
  assert.equal(outcome.content.chunks[1].blockType, "paragraph");
  // Document order preserved via chunk index.
  assert.deepEqual(outcome.content.chunks.map((c) => c.index), [0, 1]);
});

test("normalizeDocxSource: a paragraph after a heading carries that heading in its provenance", () => {
  const archiveBytes = buildDocxArchive(heading(2, "Section A") + paragraph("First.") + paragraph("Second.") + heading(2, "Section B") + paragraph("Third."));
  const outcome = normalizeDocxSource({ ...baseInput, archiveBytes });
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  const [, first, second, , third] = outcome.content.chunks;
  assert.equal(first.provenance.heading, "Section A");
  assert.equal(second.provenance.heading, "Section A");
  assert.equal(third.provenance.heading, "Section B");
});

test("normalizeDocxSource: never populates charRange for a structured-text result — page/char citation stays honest to the contract", () => {
  const archiveBytes = buildDocxArchive(paragraph("Just one paragraph."));
  const outcome = normalizeDocxSource({ ...baseInput, archiveBytes });
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  for (const chunk of outcome.content.chunks) {
    assert.equal(chunk.provenance.charRange, undefined);
    assert.equal(chunk.provenance.page, undefined);
    assert.equal(typeof chunk.provenance.blockIndex, "number");
  }
});

test("normalizeDocxSource: table rows become one chunk per row, cells joined with ' | '", () => {
  const archiveBytes = buildDocxArchive(table([tableRow(["Month", "Revenue"]), tableRow(["Jan", "100000"]), tableRow(["Feb", "112000"])]));
  const outcome = normalizeDocxSource({ ...baseInput, archiveBytes });
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.deepEqual(
    outcome.content.chunks.map((c) => c.text),
    ["Month | Revenue", "Jan | 100000", "Feb | 112000"]
  );
  assert.ok(outcome.content.chunks.every((c) => c.blockType === "tableRow"));
});

test("normalizeDocxSource: a list item is tagged listItem and reads as plain text", () => {
  const archiveBytes = buildDocxArchive(listItem("First point") + listItem("Second point"));
  const outcome = normalizeDocxSource({ ...baseInput, archiveBytes });
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.deepEqual(
    outcome.content.chunks.map((c) => ({ text: c.text, blockType: c.blockType })),
    [
      { text: "First point", blockType: "listItem" },
      { text: "Second point", blockType: "listItem" },
    ]
  );
});

test("normalizeDocxSource: an image-only document (no text anywhere) is empty, not an error", () => {
  const archiveBytes = buildDocxArchive(imageParagraph("rId1"));
  const outcome = normalizeDocxSource({ ...baseInput, archiveBytes });
  assert.equal(outcome.status, "empty");
});

test("normalizeDocxSource: a document with no real content at all is empty", () => {
  const archiveBytes = buildDocxArchive("");
  const outcome = normalizeDocxSource({ ...baseInput, archiveBytes });
  assert.equal(outcome.status, "empty");
});

test("normalizeDocxSource: bytes that aren't a ZIP at all are unsupported, not a crash", () => {
  const archiveBytes = new TextEncoder().encode("this is definitely not a zip file");
  const outcome = normalizeDocxSource({ ...baseInput, archiveBytes });
  assert.equal(outcome.status, "unsupported");
});

test("normalizeDocxSource: a ZIP with no word/document.xml part (e.g. a renamed non-Word archive) is unsupported", () => {
  const archiveBytes = zipSync({ "readme.txt": new TextEncoder().encode("hello") }, { level: 0 });
  const outcome = normalizeDocxSource({ ...baseInput, archiveBytes });
  assert.equal(outcome.status, "unsupported");
});

test("normalizeDocxSource: a document exceeding the block-count safety ceiling is too-large", () => {
  const manyParagraphs = Array.from({ length: 5001 }, (_, i) => paragraph(`Paragraph ${i}`)).join("");
  const archiveBytes = buildDocxArchive(manyParagraphs);
  const outcome = normalizeDocxSource({ ...baseInput, archiveBytes });
  assert.equal(outcome.status, "too-large");
});

test("normalizeDocxSource: deterministic — identical archive bytes always produce identical chunk ids", () => {
  const archiveBytes = buildDocxArchive(heading(1, "Title") + paragraph("Body one.") + paragraph("Body two."));
  const first = normalizeDocxSource({ ...baseInput, archiveBytes });
  const second = normalizeDocxSource({ ...baseInput, archiveBytes: new Uint8Array(archiveBytes) });
  assert.deepEqual(first, second);
});

test("normalizeDocxSource: formatting (bold/italic) is flattened to plain text, never dropped or duplicated", () => {
  const boldRun = `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:t> and plain.</w:t></w:r></w:p>`;
  const archiveBytes = buildDocxArchive(boldRun);
  const outcome = normalizeDocxSource({ ...baseInput, archiveBytes });
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.equal(outcome.content.chunks[0].text, "Bold and plain.");
});

test("normalizeDocxSource output is fully compatible with the generic context-preparation layer (full coverage)", () => {
  const archiveBytes = buildDocxArchive(heading(1, "Title") + paragraph("Short body."));
  const outcome = normalizeDocxSource({ ...baseInput, archiveBytes });
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  const context = prepareGenerationContext(outcome.content);
  assert.equal(context.fullSourceIncluded, true);
  assert.equal(context.excludedChunkCount, 0);
  assert.equal(context.chunkCount, 2);
});

test("normalizeDocxSource output reports partial coverage honestly when it exceeds the context budget, same as any other format", () => {
  const archiveBytes = buildDocxArchive(Array.from({ length: 40 }, (_, i) => paragraph(`Paragraph ${i} `.repeat(400))).join(""));
  const outcome = normalizeDocxSource({ ...baseInput, archiveBytes });
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  const context = prepareGenerationContext(outcome.content);
  assert.equal(context.fullSourceIncluded, false);
  assert.ok(context.excludedChunkCount > 0);
});

// ---- mapDocxBlocksToGenericBlocks (pure, no ZIP needed) ----

test("mapDocxBlocksToGenericBlocks: tracks the nearest-preceding heading across multiple blocks", () => {
  const blocks: DocxBlock[] = [
    { kind: "heading", level: 1, runs: [{ text: "H1" }] },
    { kind: "paragraph", runs: [{ text: "p1" }] },
    { kind: "paragraph", runs: [{ text: "p2" }] },
  ];
  const generic = mapDocxBlocksToGenericBlocks(blocks);
  assert.deepEqual(generic.map((b) => b.heading), ["H1", "H1", "H1"]);
});

test("mapDocxBlocksToGenericBlocks: an image block carries empty text and is dropped by normalizeStructuredBlocks", () => {
  const blocks: DocxBlock[] = [
    { kind: "paragraph", runs: [{ text: "before" }] },
    { kind: "image", relationshipId: "rId1" },
    { kind: "paragraph", runs: [{ text: "after" }] },
  ];
  const generic = mapDocxBlocksToGenericBlocks(blocks);
  assert.equal(generic[1].type, "image");
  assert.equal(generic[1].text, "");

  const outcome = normalizeStructuredBlocks({ sourceId: "s", sourceType: "docx", title: "t", blocks: generic });
  assert.equal(outcome.status, "ready");
  assert.deepEqual(outcome.content.chunks.map((c) => c.text), ["before", "after"]);
});

test("mapDocxBlocksToGenericBlocks: a tableRow's cells are joined with ' | '", () => {
  const blocks: DocxBlock[] = [{ kind: "tableRow", cells: [[{ text: "A" }], [{ text: "B" }], [{ text: "C" }]] }];
  const generic = mapDocxBlocksToGenericBlocks(blocks);
  assert.equal(generic[0].text, "A | B | C");
  assert.equal(generic[0].type, "tableRow");
});
