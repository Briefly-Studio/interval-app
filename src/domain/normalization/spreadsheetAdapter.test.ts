import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync } from "fflate";

import { buildSpreadsheetText, normalizeSpreadsheetSource, readSpreadsheetArchive } from "./spreadsheetAdapter";
import { prepareGenerationContext } from "../ai/contextPreparation";

function workbookXml(sheetNames: string[]): string {
  const sheets = sheetNames.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  return `<?xml version="1.0"?><workbook><sheets>${sheets}</sheets></workbook>`;
}

function workbookRels(count: number): string {
  const rels = Array.from(
    { length: count },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join("");
  return `<?xml version="1.0"?><Relationships>${rels}</Relationships>`;
}

function sharedStrings(strings: string[]): string {
  const si = strings.map((s) => `<si><t>${s}</t></si>`).join("");
  return `<?xml version="1.0"?><sst count="${strings.length}" uniqueCount="${strings.length}">${si}</sst>`;
}

type CellSpec = { ref: string; value: string; type?: "s" | "n" | "b" | "str" | "e" | "inlineStr" };

function cellXml(cell: CellSpec): string {
  if (cell.type === "inlineStr") return `<c r="${cell.ref}" t="inlineStr"><is><t>${cell.value}</t></is></c>`;
  if (cell.type === "s" || cell.type === "str" || cell.type === "e") {
    return `<c r="${cell.ref}" t="${cell.type}"><v>${cell.value}</v></c>`;
  }
  if (cell.type === "b") return `<c r="${cell.ref}" t="b"><v>${cell.value}</v></c>`;
  return `<c r="${cell.ref}"><v>${cell.value}</v></c>`; // numeric (default, no t attr)
}

function rowXml(rowNum: number, cells: CellSpec[]): string {
  return `<row r="${rowNum}">${cells.map(cellXml).join("")}</row>`;
}

function sheetXml(rows: string): string {
  return `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`;
}

function buildXlsxArchive(parts: {
  sheetNames: string[];
  sheetXmls: string[];
  sharedStringsXml?: string;
  relsOverride?: string;
}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "xl/workbook.xml": new TextEncoder().encode(workbookXml(parts.sheetNames)),
    "xl/_rels/workbook.xml.rels": new TextEncoder().encode(parts.relsOverride ?? workbookRels(parts.sheetNames.length)),
  };
  parts.sheetXmls.forEach((xml, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = new TextEncoder().encode(xml);
  });
  if (parts.sharedStringsXml) files["xl/sharedStrings.xml"] = new TextEncoder().encode(parts.sharedStringsXml);
  return zipSync(files, { level: 0 });
}

const baseInput = { sourceId: "src-1", sourceType: "xlsx" as const, title: "Test Workbook" };

test("readSpreadsheetArchive: a simple sheet with shared-string headers and numeric data reads correctly", () => {
  const archiveBytes = buildXlsxArchive({
    sheetNames: ["Revenue"],
    sharedStringsXml: sharedStrings(["Month", "Revenue", "Expenses"]),
    sheetXmls: [
      sheetXml(
        rowXml(1, [
          { ref: "A1", value: "0", type: "s" },
          { ref: "B1", value: "1", type: "s" },
          { ref: "C1", value: "2", type: "s" },
        ]) +
          rowXml(2, [
            { ref: "A2", value: "Jan" },
            { ref: "B2", value: "100000" },
            { ref: "C2", value: "75000" },
          ])
      ),
    ],
  });
  const outcome = readSpreadsheetArchive(archiveBytes);
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.equal(outcome.sheets.length, 1);
  assert.equal(outcome.sheets[0].name, "Revenue");
  assert.deepEqual(outcome.sheets[0].rows, [
    ["Month", "Revenue", "Expenses"],
    ["Jan", "100000", "75000"],
  ]);
});

test("readSpreadsheetArchive: a sparse row (a cell absent from the XML) reports an honest empty slot, not a dropped column", () => {
  const archiveBytes = buildXlsxArchive({
    sheetNames: ["Sheet1"],
    sheetXmls: [
      sheetXml(
        rowXml(1, [
          { ref: "A1", value: "Name" },
          { ref: "B1", value: "Score" },
          { ref: "C1", value: "Notes" },
        ]) + rowXml(2, [{ ref: "A2", value: "Ann" }, { ref: "C2", value: "ok" }])
      ),
    ],
  });
  const outcome = readSpreadsheetArchive(archiveBytes);
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.deepEqual(outcome.sheets[0].rows[1], ["Ann", "", "ok"]);
});

test("readSpreadsheetArchive: a boolean cell resolves to TRUE/FALSE, an error cell keeps its error code verbatim", () => {
  const archiveBytes = buildXlsxArchive({
    sheetNames: ["Sheet1"],
    sheetXmls: [
      sheetXml(
        rowXml(1, [
          { ref: "A1", value: "1", type: "b" },
          { ref: "B1", value: "0", type: "b" },
          { ref: "C1", value: "#DIV/0!", type: "e" },
        ])
      ),
    ],
  });
  const outcome = readSpreadsheetArchive(archiveBytes);
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.deepEqual(outcome.sheets[0].rows[0], ["TRUE", "FALSE", "#DIV/0!"]);
});

test("readSpreadsheetArchive: a formula cell uses its cached <v> result, never the <f> formula source", () => {
  const sheetXmlWithFormula = `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c><c r="C1"><f>A1+B1</f><v>3</v></c></row></sheetData></worksheet>`;
  const archiveBytes = buildXlsxArchive({ sheetNames: ["Sheet1"], sheetXmls: [sheetXmlWithFormula] });
  const outcome = readSpreadsheetArchive(archiveBytes);
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.deepEqual(outcome.sheets[0].rows[0], ["1", "2", "3"]);
});

test("readSpreadsheetArchive: an inline string with multiple rich-text runs is concatenated, not truncated to the last run", () => {
  const sheetXmlWithInline = `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><r><t>Hello </t></r><r><t>World</t></r></is></c></row></sheetData></worksheet>`;
  const archiveBytes = buildXlsxArchive({ sheetNames: ["Sheet1"], sheetXmls: [sheetXmlWithInline] });
  const outcome = readSpreadsheetArchive(archiveBytes);
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.deepEqual(outcome.sheets[0].rows[0], ["Hello World"]);
});

test("readSpreadsheetArchive: multiple sheets are read in workbook tab order", () => {
  const archiveBytes = buildXlsxArchive({
    sheetNames: ["Revenue", "Expenses"],
    sheetXmls: [sheetXml(rowXml(1, [{ ref: "A1", value: "R" }])), sheetXml(rowXml(1, [{ ref: "A1", value: "E" }]))],
  });
  const outcome = readSpreadsheetArchive(archiveBytes);
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.deepEqual(outcome.sheets.map((s) => s.name), ["Revenue", "Expenses"]);
});

test("readSpreadsheetArchive: a workbook with zero real cell content anywhere is empty", () => {
  const archiveBytes = buildXlsxArchive({ sheetNames: ["Blank"], sheetXmls: [sheetXml("")] });
  const outcome = readSpreadsheetArchive(archiveBytes);
  assert.equal(outcome.status, "empty");
});

test("readSpreadsheetArchive: bytes that aren't a ZIP at all are unsupported, not a crash", () => {
  const outcome = readSpreadsheetArchive(new TextEncoder().encode("not a zip"));
  assert.equal(outcome.status, "unsupported");
});

test("readSpreadsheetArchive: a ZIP with no xl/workbook.xml part is unsupported", () => {
  const archiveBytes = zipSync({ "readme.txt": new TextEncoder().encode("hi") }, { level: 0 });
  const outcome = readSpreadsheetArchive(archiveBytes);
  assert.equal(outcome.status, "unsupported");
});

test("readSpreadsheetArchive: a huge workbook (too many rows in one sheet) fails too-large honestly rather than silently truncating", () => {
  const manyRows = Array.from({ length: 5001 }, (_, i) => rowXml(i + 1, [{ ref: "A" + (i + 1), value: `v${i}` }])).join("");
  const archiveBytes = buildXlsxArchive({ sheetNames: ["Huge"], sheetXmls: [sheetXml(manyRows)] });
  const outcome = readSpreadsheetArchive(archiveBytes);
  assert.equal(outcome.status, "too-large");
});

test("buildSpreadsheetText: renders the mission's documented 'Sheet / Columns / Row N' shape", () => {
  const text = buildSpreadsheetText([
    {
      name: "Revenue",
      rows: [
        ["Month", "Revenue", "Expenses"],
        ["Jan", "100000", "75000"],
        ["Feb", "112000", "79000"],
      ],
    },
  ]);
  assert.equal(text, "Sheet: Revenue\nColumns: Month | Revenue | Expenses\nRow 1: Jan | 100000 | 75000\nRow 2: Feb | 112000 | 79000");
});

test("normalizeSpreadsheetSource: a simple workbook normalizes to ready, deterministic chunks", () => {
  const archiveBytes = buildXlsxArchive({
    sheetNames: ["Revenue"],
    sheetXmls: [sheetXml(rowXml(1, [{ ref: "A1", value: "Month" }, { ref: "B1", value: "Revenue" }]) + rowXml(2, [{ ref: "A2", value: "Jan" }, { ref: "B2", value: "100000" }]))],
  });
  const outcome = normalizeSpreadsheetSource({ ...baseInput, archiveBytes });
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.equal(outcome.content.contentKind, "text");
  assert.ok(outcome.content.chunks.length > 0);
  assert.ok(outcome.content.chunks[0].text.includes("Sheet: Revenue"));

  const second = normalizeSpreadsheetSource({ ...baseInput, archiveBytes: new Uint8Array(archiveBytes) });
  assert.deepEqual(outcome, second);
});

test("normalizeSpreadsheetSource: never invents a page number — provenance stays line/char-based, exactly like TXT", () => {
  const archiveBytes = buildXlsxArchive({
    sheetNames: ["Sheet1"],
    sheetXmls: [sheetXml(rowXml(1, [{ ref: "A1", value: "A" }, { ref: "B1", value: "B" }]) + rowXml(2, [{ ref: "A2", value: "1" }, { ref: "B2", value: "2" }]))],
  });
  const outcome = normalizeSpreadsheetSource({ ...baseInput, archiveBytes });
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  for (const chunk of outcome.content.chunks) {
    assert.equal(chunk.provenance.page, undefined);
    assert.equal(chunk.provenance.blockIndex, undefined);
  }
});

test("normalizeSpreadsheetSource output is fully compatible with the generic context-preparation layer (full coverage)", () => {
  const archiveBytes = buildXlsxArchive({
    sheetNames: ["S"],
    sheetXmls: [sheetXml(rowXml(1, [{ ref: "A1", value: "x" }]) + rowXml(2, [{ ref: "A2", value: "1" }]))],
  });
  const outcome = normalizeSpreadsheetSource({ ...baseInput, archiveBytes });
  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  const context = prepareGenerationContext(outcome.content);
  assert.equal(context.fullSourceIncluded, true);
  assert.equal(context.excludedChunkCount, 0);
});

test("normalizeSpreadsheetSource: an image-free but genuinely empty workbook is empty, not an error", () => {
  const archiveBytes = buildXlsxArchive({ sheetNames: ["Empty"], sheetXmls: [sheetXml("")] });
  const outcome = normalizeSpreadsheetSource({ ...baseInput, archiveBytes });
  assert.equal(outcome.status, "empty");
});
