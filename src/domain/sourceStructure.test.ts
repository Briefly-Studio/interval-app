import assert from "node:assert/strict";
import { test } from "node:test";
import { zipSync, strToU8 } from "fflate";
import { extractSourceStructure, resolveStructureNodeChunks, SOURCE_STRUCTURE_LIMITS } from "./sourceStructure";
import { normalizeDocxSource, normalizeStructuredBlocks } from "./normalization/docxAdapter";
import { buildSpreadsheetText, normalizeSpreadsheetSource, readSpreadsheetArchive } from "./normalization/spreadsheetAdapter";
import { normalizePdfTextSource } from "./normalization/pdfAdapter";
import { normalizeTextSource } from "./normalization/textAdapter";
import { computeChunkId, segmentText } from "./normalization/chunking";
import { prepareGenerationContext } from "./ai/contextPreparation";
import { computeSourceCoverage } from "./sourceCoverage";
import type { NormalizedSourceContent } from "./normalization/types";

const sourceId = "structure-fixture";
function docx(body: string): NormalizedSourceContent {
  const archiveBytes = zipSync({ "word/document.xml": strToU8(`<w:document><w:body>${body}</w:body></w:document>`) });
  const result = normalizeDocxSource({ sourceId, sourceType: "docx", title: "Document", archiveBytes });
  assert.ok(result.status === "ready" || result.status === "empty");
  return result.content;
}
const heading = (level: number, text: string) => `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

type Sheet = { name: string; text?: string; state?: string; target?: string };
function xlsx(sheets: Sheet[], overrides: Record<string, string> = {}): Uint8Array {
  const files: Record<string, string> = {
    "xl/workbook.xml": `<workbook><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" r:id="r${i}"${s.state ? ` state="${s.state}"` : ""}/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships>${sheets.map((s, i) => `<Relationship Id="r${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${s.target ?? `worksheets/sheet${i + 1}.xml`}"/>`).join("")}</Relationships>`,
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData>${s.text ? `<row r="1"><c r="A1" t="inlineStr"><is><t>${s.text}</t></is></c></row>` : ""}</sheetData></worksheet>`; });
  return zipSync(Object.fromEntries(Object.entries({ ...files, ...overrides }).map(([k, v]) => [k, strToU8(v)])));
}
function workbook(sheets: Sheet[], overrides?: Record<string, string>): NormalizedSourceContent {
  const result = normalizeSpreadsheetSource({ sourceId, sourceType: "xlsx", title: "Workbook", archiveBytes: xlsx(sheets, overrides) });
  assert.ok(result.status === "ready" || result.status === "empty");
  return result.content;
}

test("DOCX actual H1/H2/H3 styles form ordered intervals, including descendants", () => {
  const content = docx(para("Preamble") + heading(1, "IAM") + para("Introduction") + heading(2, "Policies") + heading(3, "Details") + para("Rules") + heading(2, "Roles") + heading(1, "Next") + para("End"));
  const nodes = extractSourceStructure(content).nodes;
  assert.deepEqual(nodes.map(n => [n.title, n.level, n.order]), [["IAM", 1, 0], ["Policies", 2, 1], ["Details", 3, 2], ["Roles", 2, 3], ["Next", 1, 4]]);
  assert.equal(nodes[1].parentId, nodes[0].id);
  assert.equal(nodes[2].parentId, nodes[1].id);
  assert.equal(nodes[3].parentId, nodes[0].id);
  assert.equal(nodes[4].parentId, undefined);
  assert.deepEqual(nodes[0].chunkIds, content.chunks.slice(1, 7).map(c => c.id));
  assert.deepEqual(nodes[1].chunkIds, content.chunks.slice(3, 6).map(c => c.id));
  assert.deepEqual(nodes[3].chunkIds, [content.chunks[6].id]); // heading with no body
  assert.ok(!nodes.some(n => n.chunkIds.includes(content.chunks[0].id))); // no invented preamble section
});
test("DOCX repeated and Unicode headings retain source titles, with distinct stable identities", () => {
  const content = docx(heading(1, "مقدمة 😀") + heading(1, "Introduction") + heading(1, "Introduction"));
  const first = extractSourceStructure(content);
  assert.deepEqual(first, extractSourceStructure(docx(heading(1, "مقدمة 😀") + heading(1, "Introduction") + heading(1, "Introduction"))));
  assert.equal(new Set(first.nodes.map(n => n.id)).size, 3);
  assert.deepEqual(first.nodes.map(n => n.title), ["مقدمة 😀", "Introduction", "Introduction"]);
});
test("ordinary DOCX typography, uppercase and Chapter text never become headings", () => {
  assert.deepEqual(extractSourceStructure(docx(para("CHAPTER 1") + '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>BIG TITLE</w:t></w:r></w:p>')).nodes, []);
  assert.deepEqual(extractSourceStructure(docx(heading(4, "Unsupported style level"))).nodes, []);
});
test("missing or malformed heading levels degrade to flat headings, without guessed hierarchy", () => {
  const content = normalizeStructuredBlocks({ sourceId, sourceType: "docx", title: "Flat", blocks: [
    { type: "heading", text: "A", headingLevel: 1 }, { type: "paragraph", text: "Body" }, { type: "heading", text: "B" },
  ] }).content;
  const nodes = extractSourceStructure(content).nodes;
  assert.deepEqual(nodes.map(n => n.chunkIds), [content.chunks.slice(0, 2).map(c => c.id), [content.chunks[2].id]]);
  assert.ok(nodes.every(n => n.parentId === undefined && n.level === undefined));
  content.chunks[0].provenance.headingLevel = 99999;
  assert.ok(extractSourceStructure(content).warnings.includes("malformed-structure"));
});
test("structure IDs respond to source, normalization version, title and interval changes", () => {
  const content = docx(heading(1, "A") + para("Body"));
  const original = extractSourceStructure(content).nodes[0].id;
  assert.notEqual(extractSourceStructure({ ...content, normalizationVersion: 2 }).nodes[0].id, original);
  assert.notEqual(extractSourceStructure({ ...content, sourceId: "other" }).nodes[0].id, original);
  assert.notEqual(extractSourceStructure(docx(heading(1, "A") + para("Changed"))).nodes[0].id, original);
  assert.notEqual(extractSourceStructure(docx(heading(1, "B") + para("Body"))).nodes[0].id, original);
});
test("bounded node/title output preserves Unicode and boundaries beyond the retained node limit", () => {
  const content = normalizeStructuredBlocks({ sourceId, sourceType: "docx", title: "Limits", blocks:
    Array.from({ length: SOURCE_STRUCTURE_LIMITS.maxNodes + 2 }, (_, i) => ({ type: "heading", text: i === 0 ? "a".repeat(255) + "😀" : `Heading ${i}`, headingLevel: 1 })) }).content;
  const result = extractSourceStructure(content);
  assert.equal(result.nodes.length, SOURCE_STRUCTURE_LIMITS.maxNodes);
  assert.equal(result.nodes[0].title, "a".repeat(255));
  assert.deepEqual(result.nodes.at(-1)!.chunkIds, [content.chunks[SOURCE_STRUCTURE_LIMITS.maxNodes - 1].id]);
  assert.ok(result.warnings.includes("structure-truncated"));
});
test("blank semantic title is omitted safely without renaming or losing other text", () => {
  const content = normalizeStructuredBlocks({ sourceId, sourceType: "docx", title: "Blank", blocks: [{ type: "heading", text: " " }, { type: "paragraph", text: "Body" }] }).content;
  assert.equal(content.chunks.length, 2);
  assert.equal(extractSourceStructure(content).nodes.length, 0);
  assert.ok(extractSourceStructure(content).warnings.includes("malformed-structure"));
});
test("additive DOCX levels leave chunk text/index/IDs and coverage identity unchanged", () => {
  const content = docx(heading(1, "A") + para("Body"));
  for (const chunk of content.chunks) assert.equal(chunk.id, computeChunkId(sourceId, chunk.index, chunk.text));
  assert.equal(content.normalizationVersion, 1);
  assert.equal(prepareGenerationContext(content).fullSourceIncluded, true);
  assert.equal(computeSourceCoverage(content.chunks.map(c => c.id), [content.chunks[0].id]).coveredChunkCount, 1);
});
test("XLSX keeps spaces, decoded Unicode names, tab order, hidden and empty worksheets", () => {
  const content = workbook([{ name: "Q4 Revenue", text: "100" }, { name: "日本語 &amp; العربية", state: "hidden", text: "200" }, { name: "Blank", state: "veryHidden" }]);
  const nodes = extractSourceStructure(content).nodes;
  assert.deepEqual(nodes.map(n => [n.title, n.worksheet!.sheetIndex, n.worksheet!.visibility]), [["Q4 Revenue", 1, "visible"], ["日本語 & العربية", 2, "hidden"], ["Blank", 3, "veryHidden"]]);
  assert.deepEqual(nodes[2].chunkIds, []);
  assert.ok(nodes.every(n => n.parentId === undefined && n.level === undefined));
  assert.equal(resolveStructureNodeChunks(content, extractSourceStructure(content), nodes[2].id).status, "error");
});
test("entirely empty workbook still carries real empty-sheet structure", () => {
  const content = workbook([{ name: "Empty" }]);
  assert.equal(content.extraction.status, "empty");
  assert.deepEqual(extractSourceStructure(content).nodes.map(n => [n.title, n.chunkIds]), [["Empty", []]]);
});
test("XLSX resolves worksheet relationships, not entry order, sheet filenames or sheetId", () => {
  const content = workbook([{ name: "First", target: "/xl/worksheets/sheet2.xml", text: "Part one" }, { name: "Second", target: "./worksheets/sheet1.xml", text: "Part two" }]);
  assert.ok(content.chunks[0].text.startsWith("Sheet: First\nRow 1: Part two"));
  assert.deepEqual(content.metadata.worksheets!.map(s => s.sheetName), ["First", "Second"]);
});
test("XLSX custom worksheet XML names are read only through real package relationships", () => {
  const content = workbook([{ name: "Actual name", target: "worksheets/custom.xml" }], { "xl/worksheets/custom.xml": "<worksheet><sheetData><row><c><v>42</v></c></row></sheetData></worksheet>" });
  assert.ok(content.chunks[0].text.includes("42"));
  assert.equal(extractSourceStructure(content).nodes[0].title, "Actual name");
});
test("XLSX boundary chunks disclose shared worksheet membership without rechunking", () => {
  const archiveBytes = xlsx([{ name: "One", text: "A" }, { name: "Two", text: "B" }]);
  const read = readSpreadsheetArchive(archiveBytes);
  assert.equal(read.status, "ready"); if (read.status !== "ready") return;
  const result = normalizeSpreadsheetSource({ sourceId, sourceType: "xlsx", title: "Book", archiveBytes });
  assert.equal(result.status, "ready"); if (result.status !== "ready") return;
  assert.equal(buildSpreadsheetText(read.sheets), "Sheet: One\nRow 1: A\n\nSheet: Two\nRow 1: B");
  const content = result.content, legacy = segmentText(sourceId, buildSpreadsheetText(read.sheets)).chunks;
  assert.deepEqual(content.chunks.map(({ id, text, index, approxSize }) => ({ id, text, index, approxSize })), legacy.map(({ id, text, index, approxSize }) => ({ id, text, index, approxSize })));
  assert.equal(content.chunks.length, 1);
  assert.deepEqual(content.chunks[0].provenance.worksheets!.map(s => s.sheetName), ["One", "Two"]);
  const structure = extractSourceStructure(content);
  assert.ok(structure.warnings.includes("shared-worksheet-chunks"));
  assert.deepEqual(structure.nodes[0].chunkIds, structure.nodes[1].chunkIds);
  assert.deepEqual(resolveStructureNodeChunks(content, structure, structure.nodes[0].id), { status: "ok", chunkIds: [content.chunks[0].id], sharedWithOtherNodes: true });
  assert.equal(content.normalizationVersion, 1);
});
test("XLSX worksheet affiliation follows actual character intersection, even with overlapping windows", () => {
  const content = workbook([{ name: "Long", text: "Long content ".repeat(500) }, { name: "Short", text: "End" }]);
  const structure = extractSourceStructure(content);
  for (const node of structure.nodes) {
    const sheet = content.metadata.worksheets!.find(s => s.sheetIndex === node.worksheet!.sheetIndex)!;
    assert.deepEqual(node.chunkIds, content.chunks.filter(c => c.provenance.charRange!.start < sheet.charRange!.end && c.provenance.charRange!.end > sheet.charRange!.start).map(c => c.id));
  }
  assert.ok(content.chunks.every(c => c.provenance.page === undefined));
});
test("malformed optional workbook metadata leaves safely extracted text available, with warning", () => {
  const content = workbook([{ name: "A", text: "Body" }], { "xl/workbook.xml": '<workbook><sheets><sheet name="A" r:id="r0"/></WRONG>' });
  assert.equal(content.extraction.status, "ready");
  assert.ok(content.chunks[0].text.includes("Body"));
  assert.deepEqual(extractSourceStructure(content).nodes, []);
  assert.ok(extractSourceStructure(content).warnings.includes("workbook-sheet-metadata-unavailable"));
});
test("duplicate worksheet names do not create invented, renamed structure", () => {
  const content = workbook([{ name: "Same", text: "A" }, { name: "same", text: "B" }]);
  assert.equal(content.extraction.status, "ready");
  assert.deepEqual(extractSourceStructure(content).nodes, []);
  assert.ok(content.metadata.structureWarnings!.includes("workbook-sheet-metadata-unavailable"));
});
test("malformed and external worksheet relationships are never guessed from basename", () => {
  for (const target of ["../worksheets/sheet1.xml", "https://example.com/sheet1.xml", "other/sheet1.xml", "worksheets/%2e%2e/sheet1.xml"]) {
    const content = workbook([{ name: "Bad", target, text: "Secret" }]);
    assert.equal(content.chunks.length, 0);
    assert.deepEqual(extractSourceStructure(content).nodes, []);
    assert.ok(content.metadata.structureWarnings!.includes("workbook-sheet-metadata-unavailable"));
  }
});
test("relationship aliasing cannot assign one sheet part two trustworthy identities", () => {
  const content = workbook([{ name: "A", text: "A" }, { name: "B", target: "worksheets/sheet1.xml", text: "B" }]);
  assert.equal(content.extraction.status, "ready");
  assert.deepEqual(extractSourceStructure(content).nodes, []);
  assert.ok(content.metadata.structureWarnings!.includes("workbook-sheet-metadata-unavailable"));
});
test("absurd worksheet titles are bounded with a nonfatal warning", () => {
  const content = workbook([{ name: "N".repeat(1000), text: "Body" }]);
  const structure = extractSourceStructure(content);
  assert.equal(structure.nodes[0].title.length, SOURCE_STRUCTURE_LIMITS.maxTitleLength);
  assert.ok(structure.warnings.includes("structure-truncated"));
});
test("TXT and PDF emit no fabricated chapters, even from chapter-like page/text content", () => {
  const text = normalizeTextSource({ sourceId, sourceType: "text", title: "Text", byteSize: 20, rawText: "CHAPTER 1\n\nINTRODUCTION" });
  assert.equal(text.status, "ready"); if (text.status !== "ready") return;
  assert.deepEqual(extractSourceStructure(text.content).nodes, []);
  const pdf = normalizePdfTextSource({ sourceId, sourceType: "pdf", title: "PDF", pages: ["Chapter 1\nINTRODUCTION", "Chapter 2"] });
  assert.equal(pdf.status, "ready"); if (pdf.status !== "ready") return;
  assert.deepEqual(extractSourceStructure(pdf.content).nodes, []);
  assert.deepEqual(pdf.content.chunks.map(c => c.provenance.page), [1, 2]);
});
test("node resolver rejects missing, stale-version and changed-content snapshots", () => {
  const content = docx(heading(1, "A") + para("Body")), structure = extractSourceStructure(content), id = structure.nodes[0].id;
  assert.deepEqual(resolveStructureNodeChunks(content, structure, id), { status: "ok", chunkIds: content.chunks.map(c => c.id), sharedWithOtherNodes: false });
  assert.deepEqual(resolveStructureNodeChunks(content, structure, "missing"), { status: "error", code: "node-not-found" });
  assert.deepEqual(resolveStructureNodeChunks({ ...content, normalizationVersion: 2 }, structure, id), { status: "error", code: "stale-structure" });
  assert.deepEqual(resolveStructureNodeChunks(docx(heading(1, "A") + para("Changed")), structure, id), { status: "error", code: "stale-structure" });
});

test("worksheet structure does not leak archive path traversal entries or fabricated metadata", () => {
  const content = workbook([{ name: "Safe", text: "Safe" }], {
    "xl/workbook.xml": '<workbook><custom><sheets><sheet name="Fake" r:id="r0"/></sheets></custom><sheets><sheet name="Safe" r:id="r0"/></sheets></workbook>',
    "../xl/worksheets/sheet1.xml": "<worksheet><sheetData>Malicious</sheetData></worksheet>",
  });
  assert.deepEqual(extractSourceStructure(content).nodes.map(n => n.title), ["Safe"]);
  assert.ok(!content.chunks.some(c => c.text.includes("Malicious")));
});
test("malformed worksheet range metadata is omitted without affecting normalized text", () => {
  const content = workbook([{ name: "A", text: "Body" }]);
  content.metadata.worksheets![0].charRange = { start: 20, end: 1 };
  assert.deepEqual(extractSourceStructure(content).nodes, []);
  assert.ok(extractSourceStructure(content).warnings.includes("malformed-structure"));
  assert.ok(content.chunks[0].text.includes("Body"));
});
