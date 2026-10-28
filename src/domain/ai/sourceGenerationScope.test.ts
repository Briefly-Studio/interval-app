import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";

import type { NormalizedChunk, NormalizedSourceContent } from "../normalization/types";
import { normalizeDocxSource } from "../normalization/docxAdapter";
import { normalizeSpreadsheetSource } from "../normalization/spreadsheetAdapter";
import { extractSourceStructure } from "../sourceStructure";
import { DEFAULT_CONTEXT_CHAR_BUDGET } from "./contextPreparation";
import { fitsContextBudget, getSectionCount, resolveSourceGenerationScope } from "./sourceGenerationScope";

function chunk(index: number, overrides: Partial<NormalizedChunk> = {}): NormalizedChunk {
  return {
    id: `chunk_${index}`,
    index,
    text: `Chunk ${index} text`,
    approxSize: 100,
    provenance: {},
    ...overrides,
  };
}

function pdfChunks(perPage: Record<number, number>): NormalizedChunk[] {
  const chunks: NormalizedChunk[] = [];
  let globalIndex = 0;
  for (const [page, count] of Object.entries(perPage)) {
    for (let i = 0; i < count; i++) {
      chunks.push(chunk(globalIndex, { provenance: { page: Number(page) } }));
      globalIndex++;
    }
  }
  return chunks;
}

// ---- Automatic ----

test("automatic always resolves to no restriction, regardless of input", () => {
  const result = resolveSourceGenerationScope({ chunks: [chunk(0), chunk(1)], scope: { type: "automatic" } });
  assert.deepEqual(result, { status: "ok" });
});

test("automatic resolves to no restriction even for an empty chunk list", () => {
  const result = resolveSourceGenerationScope({ chunks: [], scope: { type: "automatic" } });
  assert.deepEqual(result, { status: "ok" });
});

// ---- Entire source ----

test("entireSource resolves ok with every chunk id, explicitly, when the full source fits the budget", () => {
  const chunks = [chunk(0, { approxSize: 100 }), chunk(1, { approxSize: 100 })];
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "entireSource" } });
  assert.deepEqual(result, { status: "ok", chunkIds: ["chunk_0", "chunk_1"] });
});

// Multi-batch generation (batchPlanning.ts/multiBatchGeneration.ts) is what now makes "entire
// source" truthful for a source larger than one context budget — scope resolution itself no
// longer gates on budget at all, only on whether there's any content to select from.
test("entireSource still resolves ok with every chunk id even when the full source exceeds one context budget", () => {
  const chunks = [
    chunk(0, { approxSize: DEFAULT_CONTEXT_CHAR_BUDGET }),
    chunk(1, { approxSize: DEFAULT_CONTEXT_CHAR_BUDGET }),
  ];
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "entireSource" } });
  assert.deepEqual(result, { status: "ok", chunkIds: ["chunk_0", "chunk_1"] });
});

test("entireSource errors for a source with zero chunks", () => {
  const result = resolveSourceGenerationScope({ chunks: [], scope: { type: "entireSource" } });
  assert.deepEqual(result, { status: "error", code: "entire-source-too-large" });
});

// fitsContextBudget is no longer entireSource's own gate (multi-batch planning now handles the
// "doesn't fit one budget" case) — it remains used by the options screen to decide whether a
// RESTRICTIVE scope's own candidate set needs batching at all. Still exercised directly here.
test("fitsContextBudget: true only when every chunk fits within one context budget", () => {
  const fits = [chunk(0, { approxSize: 10 }), chunk(1, { approxSize: 10 })];
  const tooBig = [chunk(0, { approxSize: DEFAULT_CONTEXT_CHAR_BUDGET + 1 })];
  assert.equal(fitsContextBudget(fits), true);
  assert.equal(fitsContextBudget(tooBig), false);
  assert.equal(fitsContextBudget([]), false);
});

// ---- Uncovered ----

test("uncovered selects only uncovered chunk ids, preserving source order", () => {
  const chunks = [chunk(0), chunk(1), chunk(2), chunk(3)];
  const coverage = {
    totalChunkCount: 4,
    coveredChunkCount: 2,
    uncoveredChunkCount: 2,
    coverageRatio: 0.5,
    coveredChunkIds: ["chunk_0", "chunk_2"],
    uncoveredChunkIds: ["chunk_1", "chunk_3"],
  };
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "uncovered" }, coverage });
  assert.deepEqual(result, { status: "ok", chunkIds: ["chunk_1", "chunk_3"] });
});

test("uncovered excludes covered chunks even if coverage data is out of order", () => {
  const chunks = [chunk(0), chunk(1), chunk(2)];
  const coverage = {
    totalChunkCount: 3,
    coveredChunkCount: 1,
    uncoveredChunkCount: 2,
    coverageRatio: 2 / 3,
    coveredChunkIds: ["chunk_1"],
    // Deliberately listed out of document order — result must still follow `chunks`' own order.
    uncoveredChunkIds: ["chunk_2", "chunk_0"],
  };
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "uncovered" }, coverage });
  assert.deepEqual(result, { status: "ok", chunkIds: ["chunk_0", "chunk_2"] });
});

test("uncovered errors when there is zero uncovered material", () => {
  const chunks = [chunk(0), chunk(1)];
  const coverage = {
    totalChunkCount: 2,
    coveredChunkCount: 2,
    uncoveredChunkCount: 0,
    coverageRatio: 1,
    coveredChunkIds: ["chunk_0", "chunk_1"],
    uncoveredChunkIds: [],
  };
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "uncovered" }, coverage });
  assert.deepEqual(result, { status: "error", code: "uncovered-unavailable" });
});

test("uncovered errors when no coverage was supplied at all", () => {
  const result = resolveSourceGenerationScope({ chunks: [chunk(0)], scope: { type: "uncovered" } });
  assert.deepEqual(result, { status: "error", code: "uncovered-unavailable" });
});

test("uncovered safely ignores a stale coverage chunk id that no longer exists in the current chunks", () => {
  const chunks = [chunk(0), chunk(1)];
  const coverage = {
    totalChunkCount: 3,
    coveredChunkCount: 1,
    uncoveredChunkCount: 2,
    coverageRatio: 1 / 3,
    coveredChunkIds: ["chunk_2"],
    // "chunk_99" was never in `chunks` — e.g. a re-normalization under a new NORMALIZATION_VERSION.
    uncoveredChunkIds: ["chunk_0", "chunk_99"],
  };
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "uncovered" }, coverage });
  assert.deepEqual(result, { status: "ok", chunkIds: ["chunk_0"] });
});

// ---- PDF page range ----

test("pageRange selects only chunks whose provenance page falls in the requested range", () => {
  const chunks = pdfChunks({ 1: 1, 2: 2, 3: 1, 4: 1 });
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "pageRange", startPage: 2, endPage: 3 }, pageCount: 4 });
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.deepEqual(
      result.chunkIds,
      chunks.filter((c) => c.provenance.page === 2 || c.provenance.page === 3).map((c) => c.id)
    );
  }
});

test("pageRange supports a single-page range", () => {
  const chunks = pdfChunks({ 1: 1, 2: 1, 3: 1 });
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "pageRange", startPage: 2, endPage: 2 }, pageCount: 3 });
  assert.equal(result.status, "ok");
  if (result.status === "ok") assert.deepEqual(result.chunkIds, [chunks[1].id]);
});

test("pageRange rejects a reversed range", () => {
  const chunks = pdfChunks({ 1: 1, 2: 1 });
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "pageRange", startPage: 2, endPage: 1 }, pageCount: 2 });
  assert.deepEqual(result, { status: "error", code: "invalid-range" });
});

test("pageRange rejects an out-of-bounds range", () => {
  const chunks = pdfChunks({ 1: 1, 2: 1 });
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "pageRange", startPage: 1, endPage: 10 }, pageCount: 2 });
  assert.deepEqual(result, { status: "error", code: "invalid-range" });
});

test("pageRange rejects a zero/negative start page", () => {
  const chunks = pdfChunks({ 1: 1 });
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "pageRange", startPage: 0, endPage: 1 }, pageCount: 1 });
  assert.deepEqual(result, { status: "error", code: "invalid-range" });
});

test("pageRange errors when no page count is known at all", () => {
  const chunks = pdfChunks({ 1: 1, 2: 1 });
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "pageRange", startPage: 1, endPage: 2 } });
  assert.deepEqual(result, { status: "error", code: "page-range-unavailable" });
});

test("pageRange reports empty-selection when a valid range matches zero chunks (e.g. blank pages produced none)", () => {
  // Pages 2-3 produced no chunks at all (blank), even though the document has 4 pages.
  const chunks = pdfChunks({ 1: 1, 4: 1 });
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "pageRange", startPage: 2, endPage: 3 }, pageCount: 4 });
  assert.deepEqual(result, { status: "error", code: "empty-selection" });
});

test("pageRange correctly handles chunks never spanning a page boundary", () => {
  const chunks = pdfChunks({ 5: 3 });
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "pageRange", startPage: 5, endPage: 5 }, pageCount: 5 });
  assert.equal(result.status, "ok");
  if (result.status === "ok") assert.equal(result.chunkIds?.length, 3);
});

// ---- Generic section range ----

test("sectionRange selects a 1-based ordinal range of chunks and preserves order", () => {
  const chunks = [chunk(0), chunk(1), chunk(2), chunk(3), chunk(4)];
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "sectionRange", startSection: 2, endSection: 4 } });
  assert.deepEqual(result, { status: "ok", chunkIds: ["chunk_1", "chunk_2", "chunk_3"] });
});

test("sectionRange rejects a reversed range", () => {
  const chunks = [chunk(0), chunk(1), chunk(2)];
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "sectionRange", startSection: 3, endSection: 1 } });
  assert.deepEqual(result, { status: "error", code: "invalid-range" });
});

test("sectionRange rejects an out-of-bounds range", () => {
  const chunks = [chunk(0), chunk(1)];
  const result = resolveSourceGenerationScope({ chunks, scope: { type: "sectionRange", startSection: 1, endSection: 5 } });
  assert.deepEqual(result, { status: "error", code: "invalid-range" });
});

test("sectionRange errors for a source with zero chunks", () => {
  const result = resolveSourceGenerationScope({ chunks: [], scope: { type: "sectionRange", startSection: 1, endSection: 1 } });
  assert.deepEqual(result, { status: "error", code: "invalid-range" });
});

test("getSectionCount is simply the chunk count", () => {
  assert.equal(getSectionCount([chunk(0), chunk(1), chunk(2)]), 3);
  assert.equal(getSectionCount([]), 0);
});

// ---- Structure node (DOCX heading / XLSX worksheet) ----

const structureSourceId = "structure-scope-fixture";
function docxContent(body: string): NormalizedSourceContent {
  const archiveBytes = zipSync({ "word/document.xml": strToU8(`<w:document><w:body>${body}</w:body></w:document>`) });
  const result = normalizeDocxSource({ sourceId: structureSourceId, sourceType: "docx", title: "Document", archiveBytes });
  assert.ok(result.status === "ready" || result.status === "empty");
  return result.content;
}
const heading = (level: number, text: string) => `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function xlsxBytes(sheets: { name: string; text: string }[]): Uint8Array {
  const files: Record<string, string> = {
    "xl/workbook.xml": `<workbook><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" r:id="r${i}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships>${sheets.map((s, i) => `<Relationship Id="r${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${s.text}</t></is></c></row></sheetData></worksheet>`; });
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}
function workbookContent(sheets: { name: string; text: string }[]): NormalizedSourceContent {
  const result = normalizeSpreadsheetSource({ sourceId: structureSourceId, sourceType: "xlsx", title: "Workbook", archiveBytes: xlsxBytes(sheets) });
  assert.ok(result.status === "ready" || result.status === "empty");
  return result.content;
}

test("structureNode resolves ok with the node's own chunk ids, delegating to resolveStructureNodeChunks", () => {
  const content = docxContent(heading(1, "IAM") + para("Policies text"));
  const structure = extractSourceStructure(content);
  const nodeId = structure.nodes[0].id;
  const result = resolveSourceGenerationScope({
    chunks: content.chunks,
    scope: { type: "structureNode", nodeId, structureSnapshot: structure },
    normalizedContent: content,
  });
  assert.deepEqual(result, { status: "ok", chunkIds: content.chunks.map((c) => c.id), sharedWithOtherNodes: false });
});

test("structureNode includes a parent heading's descendant chunks", () => {
  const content = docxContent(heading(1, "IAM") + para("Intro") + heading(2, "Policies") + para("Detail"));
  const structure = extractSourceStructure(content);
  const parent = structure.nodes.find((n) => n.title === "IAM")!;
  const result = resolveSourceGenerationScope({
    chunks: content.chunks,
    scope: { type: "structureNode", nodeId: parent.id, structureSnapshot: structure },
    normalizedContent: content,
  });
  assert.equal(result.status, "ok");
  if (result.status === "ok") assert.deepEqual(result.chunkIds, content.chunks.map((c) => c.id));
});

test("structureNode maps resolveStructureNodeChunks' error codes 1:1 (not-found, stale, empty)", () => {
  const content = docxContent(heading(1, "A") + para("Body"));
  const structure = extractSourceStructure(content);
  const nodeId = structure.nodes[0].id;

  assert.deepEqual(
    resolveSourceGenerationScope({ chunks: content.chunks, scope: { type: "structureNode", nodeId: "missing", structureSnapshot: structure }, normalizedContent: content }),
    { status: "error", code: "structure-node-not-found" }
  );
  assert.deepEqual(
    resolveSourceGenerationScope({ chunks: content.chunks, scope: { type: "structureNode", nodeId, structureSnapshot: structure }, normalizedContent: { ...content, normalizationVersion: 2 } }),
    { status: "error", code: "structure-node-stale" }
  );

  const empty = workbookContent([{ name: "Empty", text: "" }]);
  const emptyStructure = extractSourceStructure(empty);
  assert.deepEqual(
    resolveSourceGenerationScope({ chunks: empty.chunks, scope: { type: "structureNode", nodeId: emptyStructure.nodes[0].id, structureSnapshot: emptyStructure }, normalizedContent: empty }),
    { status: "error", code: "structure-node-empty" }
  );
});

test("structureNode is a defensive-backstop error when no normalizedContent was supplied at all", () => {
  const content = docxContent(heading(1, "A") + para("Body"));
  const structure = extractSourceStructure(content);
  const result = resolveSourceGenerationScope({ chunks: content.chunks, scope: { type: "structureNode", nodeId: structure.nodes[0].id, structureSnapshot: structure } });
  assert.deepEqual(result, { status: "error", code: "structure-node-not-found" });
});

test("structureNode discloses sharedWithOtherNodes for the known XLSX chunk-spans-worksheets limitation", () => {
  const content = workbookContent([{ name: "One", text: "A" }, { name: "Two", text: "B" }]);
  const structure = extractSourceStructure(content);
  assert.ok(structure.warnings.includes("shared-worksheet-chunks"));
  const result = resolveSourceGenerationScope({
    chunks: content.chunks,
    scope: { type: "structureNode", nodeId: structure.nodes[0].id, structureSnapshot: structure },
    normalizedContent: content,
  });
  assert.deepEqual(result, { status: "ok", chunkIds: content.chunks.map((c) => c.id), sharedWithOtherNodes: true });
});
