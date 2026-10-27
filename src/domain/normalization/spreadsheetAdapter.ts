import { unzipSync, type UnzipFileInfo } from "fflate";

import { boundStructureTitle, type SourceStructureWarning, type WorksheetIdentity, type WorksheetStructureMetadata } from "../sourceStructure";
import { readWorkbookSheetIdentities, readWorksheetRelationships } from "./workbookStructure";
import { segmentText } from "./chunking";
import { NORMALIZATION_VERSION, type NormalizedSourceContent } from "./types";
import type { SourceType } from "../../models/librarySource";

// XLSX (Office Open XML Spreadsheet) adapter — same security posture as docxContent.ts/
// sourceReaderDocx.ts (DOCX's own reader), applied to SpreadsheetML instead of WordprocessingML.
//
// Dependency note (see docs/ai-multiformat-generation.md's "Dependencies" section for the full
// audit): the npm-published `xlsx` (SheetJS) package is the LAST version ever published to npm
// (0.18.5, 2022) and is flagged by a GitHub Security Advisory (GHSA-4r6h-8v6p-xvw6 /
// CVE-2023-30533, prototype pollution) with NO fixed version available via npm — SheetJS
// deliberately stopped publishing security fixes there. `exceljs` is Node-oriented (depends on
// `tmp`, `archiver`, `unzipper`, `readable-stream` — filesystem/Node-stream APIs with no real fit
// in a React Native runtime). Neither is used. Instead this file reuses `fflate` (already a
// dependency, already audited for exactly this purpose) plus a small, purpose-built SpreadsheetML
// reader — the same architectural choice already made for DOCX, not a new one introduced here.
//
// Zip-bomb / untrusted-input defense is identical in spirit to sourceReaderDocx.ts: every size
// limit below is enforced via `unzipSync`'s pre-inflation `filter` callback (name + declared
// uncompressed size from the ZIP central directory), so a hostile entry is rejected before a
// single byte of it is ever inflated. Only four kinds of entry are ever accepted: the exact paths
// `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/sharedStrings.xml`, and worksheet parts
// directly under `xl/worksheets/` with an XML extension — charts, drawings, embedded images/objects, VBA macros
// (`xl/vbaProject.bin`), and every other package part are rejected by the filter and never
// touched, exactly like DOCX's media/styles/headers exclusion.
//
// Formulas: a formula cell's cached, already-computed result (`<v>`) is used — the same value
// Excel itself would display — never the raw formula source text (`<f>`), and this adapter never
// evaluates a formula itself. If a formula cell has no cached value at all, it reads as empty;
// nothing is invented.

const MAX_ARCHIVE_BYTES = 30 * 1024 * 1024;
const MAX_WORKBOOK_XML_BYTES = 1 * 1024 * 1024;
const MAX_RELS_XML_BYTES = 1 * 1024 * 1024;
const MAX_SHARED_STRINGS_BYTES = 10 * 1024 * 1024;
const MAX_WORKSHEET_XML_BYTES = 15 * 1024 * 1024;
const MAX_SHEETS = 50;
const MAX_ROWS_PER_SHEET = 5000;
const MAX_TOTAL_ROWS = 20000;
const MAX_COLUMNS_PER_ROW = 200;

const WORKBOOK_PATH = "xl/workbook.xml";
const WORKBOOK_RELS_PATH = "xl/_rels/workbook.xml.rels";
const SHARED_STRINGS_PATH = "xl/sharedStrings.xml";
const WORKSHEET_RE = /^xl\/worksheets\/[^/\\]+\.xml$/i;

function isSafeEntryName(name: string): boolean {
  if (name.startsWith("/")) return false;
  if (name.split("/").includes("..")) return false;
  return true;
}

// ---- Minimal, bounded, linear-time XML tag scanner — deliberately re-implemented here rather
// than imported from docxContent.ts, so this new adapter never risks changing already-shipped,
// founder-QA-verified DOCX behavior. Same two security properties as that scanner: no DOCTYPE/
// ENTITY handling (no XXE surface), and every regex is anchored to the next `<`/`>` with no
// nested quantifiers (no catastrophic-backtracking risk). ----

type TagToken = { kind: "open" | "close" | "self"; name: string; attrs: string };
type ScanToken = { tag: TagToken } | { text: string };

const TOKEN_RE = /<(\/?)([a-zA-Z0-9:_-]+)([^>]*?)(\/?)>|([^<]+)/g;

function* scan(xml: string): Generator<ScanToken> {
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(xml))) {
    const [, closing, name, attrs, selfClosing, text] = match;
    if (text !== undefined) {
      yield { text };
    } else {
      yield { tag: { kind: selfClosing ? "self" : closing ? "close" : "open", name, attrs } };
    }
  }
}

const ENTITY_MAP: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescapeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const codePoint = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return "";
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return "";
      }
    }
    return ENTITY_MAP[body] ?? match;
  });
}

function localName(name: string): string {
  return name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
}

function attrValue(attrs: string, attrName: string): string | undefined {
  const re = new RegExp(`${attrName}=(?:"([^"]*)"|'([^']*)')`);
  const m = re.exec(attrs);
  if (!m) return undefined;
  return unescapeXmlEntities(m[1] ?? m[2] ?? "");
}

/** 0-based column index from a cell reference like "A1" -> 0, "B7" -> 1, "AA1" -> 26. */
function columnIndexFromCellRef(ref: string): number {
  const letters = /^[A-Za-z]+/.exec(ref)?.[0] ?? "";
  let index = 0;
  for (const ch of letters.toUpperCase()) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return Math.max(0, index - 1);
}

// ---- xl/workbook.xml: sheet name + relationship id, in tab order ----

type WorkbookSheet = { name: string; relId: string };

function parseWorkbookSheets(xml: string, maxSheets: number): WorkbookSheet[] {
  const sheets: WorkbookSheet[] = [];
  for (const token of scan(xml)) {
    if ("text" in token) continue;
    if (localName(token.tag.name) !== "sheet") continue;
    const name = attrValue(token.tag.attrs, "name");
    const relId = attrValue(token.tag.attrs, "r:id");
    if (name && relId) sheets.push({ name, relId });
    if (sheets.length >= maxSheets) break;
  }
  return sheets;
}

// ---- xl/_rels/workbook.xml.rels: relationship id -> worksheet part path ----

// ---- xl/sharedStrings.xml: index -> plain text (rich-text runs concatenated, same as a DOCX
// paragraph's runs — formatting is dropped, the words are kept) ----

function parseSharedStrings(xml: string, maxStrings: number): string[] {
  const strings: string[] = [];
  let current = "";
  let inT = false;
  let buffer = "";
  let depth = 0; // nesting depth inside one <si>; 0 means not currently inside an <si>.

  for (const token of scan(xml)) {
    if ("text" in token) {
      if (inT) buffer += token.text;
      continue;
    }
    const local = localName(token.tag.name);
    if (local === "si") {
      if (token.tag.kind === "open") {
        depth = 1;
        current = "";
      } else if (token.tag.kind === "close") {
        depth = 0;
        strings.push(current);
        if (strings.length >= maxStrings) break;
      } else {
        // Self-closing <si/> — an empty shared string.
        strings.push("");
        if (strings.length >= maxStrings) break;
      }
      continue;
    }
    if (depth === 0) continue; // outside any <si> — only <sst>/<si> wrapper tags reach here.
    if (local === "t") {
      if (token.tag.kind === "open") {
        inT = true;
        buffer = "";
      } else if (token.tag.kind === "close") {
        inT = false;
        current += unescapeXmlEntities(buffer);
        buffer = "";
      }
      continue;
    }
  }
  return strings;
}

type SheetParseResult = { rows: string[][]; truncated: boolean };

/**
 * Parses one worksheet's `<sheetData>` into dense, column-aligned rows. A cell absent from the
 * XML (Excel omits blank cells entirely) becomes an empty string at its real column position —
 * never silently dropped, never fabricated as if it had a value. `maxColumns` bounds how wide any
 * single row is allowed to report before this sheet is treated as too large (defends against a
 * pathological single-row cell reference like "ZZZZ1").
 */
function parseWorksheetRows(xml: string, sharedStrings: string[], maxRows: number, maxColumns: number): SheetParseResult {
  const rows: string[][] = [];
  let truncated = false;

  let inRow = false;
  let rowCells: { col: number; text: string }[] = [];
  let maxColSeen = 0;

  let inCell = false;
  let cellType = "";
  let cellCol = 0;
  let cellValueBuffer = "";
  let inValue = false;
  // Inline strings (`<is>...</is>`) can hold multiple rich-text runs (`<r><t>A</t></r><r><t>B</t
  // ></r>`), exactly like a shared string's `<si>` — `inlineTextAccum` accumulates ACROSS runs for
  // the whole cell, while `inInlineText`'s buffer (reusing `cellValueBuffer`) is scratch space for
  // just the current `<t>...</t>` run, appended into `inlineTextAccum` on each `</t>` close.
  let inInlineStr = false;
  let inInlineText = false;
  let inlineTextAccum = "";

  function flushRow() {
    if (rowCells.length === 0) {
      rows.push([]);
    } else {
      const width = Math.min(maxColSeen + 1, maxColumns);
      const dense = new Array<string>(width).fill("");
      for (const cell of rowCells) {
        if (cell.col < width) dense[cell.col] = cell.text;
      }
      rows.push(dense);
    }
    rowCells = [];
    maxColSeen = 0;
    inRow = false;
  }

  for (const token of scan(xml)) {
    if ("text" in token) {
      if (inValue || inInlineText) cellValueBuffer += token.text;
      continue;
    }
    const { kind, name, attrs } = token.tag;
    const local = localName(name);

    if (local === "row") {
      if (kind === "open") {
        inRow = true;
        rowCells = [];
        maxColSeen = 0;
      } else if (kind === "close") {
        flushRow();
        if (rows.length >= maxRows) {
          truncated = true;
          return { rows, truncated };
        }
      }
      continue;
    }
    if (!inRow) continue;

    if (local === "c") {
      if (kind === "open") {
        inCell = true;
        cellType = attrValue(attrs, "t") ?? "";
        cellCol = columnIndexFromCellRef(attrValue(attrs, "r") ?? "");
        cellValueBuffer = "";
        inlineTextAccum = "";
      } else if (kind === "close") {
        if (inCell) {
          const text = resolveCellText(cellType, cellType === "inlineStr" ? inlineTextAccum : cellValueBuffer, sharedStrings);
          rowCells.push({ col: cellCol, text });
          maxColSeen = Math.max(maxColSeen, cellCol);
          if (cellCol >= maxColumns) truncated = true;
        }
        inCell = false;
      } else {
        // Self-closing <c/> — a genuinely empty cell; its column still participates in width.
        const col = columnIndexFromCellRef(attrValue(attrs, "r") ?? "");
        rowCells.push({ col, text: "" });
        maxColSeen = Math.max(maxColSeen, col);
      }
      continue;
    }
    if (!inCell) continue;

    if (local === "v") {
      if (kind === "open") {
        inValue = true;
        cellValueBuffer = "";
      } else if (kind === "close") {
        inValue = false;
      }
      continue;
    }
    if (local === "is") {
      if (kind === "open") {
        inInlineStr = true;
        inlineTextAccum = "";
      } else if (kind === "close") {
        inInlineStr = false;
      }
      continue;
    }
    if (local === "t" && inInlineStr) {
      if (kind === "open") {
        inInlineText = true;
        cellValueBuffer = "";
      } else if (kind === "close") {
        inInlineText = false;
        inlineTextAccum += cellValueBuffer;
      }
      continue;
    }
    // <f> (formula source text) is intentionally never read — see this file's header comment.
  }

  return { rows, truncated };
}

function resolveCellText(cellType: string, rawValue: string, sharedStrings: string[]): string {
  const value = unescapeXmlEntities(rawValue).trim();
  if (cellType === "s") {
    const index = Number.parseInt(value, 10);
    return Number.isFinite(index) ? sharedStrings[index] ?? "" : "";
  }
  if (cellType === "b") return value === "1" ? "TRUE" : "FALSE";
  // "n" (or absent) = numeric, "str" = formula-computed string, "e" = error code, "inlineStr" =
  // already resolved via the <is><t> branch above — all read as their raw, already-decoded text.
  return value;
}

export type SpreadsheetSheet = { name: string; rows: string[][]; identity?: WorksheetIdentity };

export type SpreadsheetReadOutcome =
  | { status: "ready" | "empty"; sheets: SpreadsheetSheet[]; structureWarnings: SourceStructureWarning[] }
  | { status: "too-large" }
  // Not a valid XLSX package (encrypted workbook, or a file renamed to .xlsx that isn't one) —
  // same framing as DOCX's own "unsupported" for an unreadable-but-not-corrupt archive.
  | { status: "unsupported" }
  | { status: "failed" };

/** Reads an already-in-memory XLSX archive. Never touches the filesystem itself — the caller
 * (normalizeSource.ts) is responsible for local-first/cloud-fallback resolution and the byte
 * read, exactly like every other adapter. */
export function readSpreadsheetArchive(archiveBytes: Uint8Array): SpreadsheetReadOutcome {
  if (archiveBytes.byteLength === 0) return { status: "unsupported" };
  if (archiveBytes.byteLength > MAX_ARCHIVE_BYTES) return { status: "too-large" };

  let entries: Record<string, Uint8Array>;
  let worksheetBytes = 0, worksheetCount = 0, exceededSheetBudget = false;
  try {
    entries = unzipSync(archiveBytes, {
      filter(file: UnzipFileInfo) {
        if (!isSafeEntryName(file.name)) return false;
        if (file.name === WORKBOOK_PATH) return file.originalSize <= MAX_WORKBOOK_XML_BYTES;
        if (file.name === WORKBOOK_RELS_PATH) return file.originalSize <= MAX_RELS_XML_BYTES;
        if (file.name === SHARED_STRINGS_PATH) return file.originalSize <= MAX_SHARED_STRINGS_BYTES;
        if (WORKSHEET_RE.test(file.name)) {
          worksheetBytes += file.originalSize; worksheetCount++;
          if (file.originalSize > MAX_WORKSHEET_XML_BYTES || worksheetBytes > MAX_ARCHIVE_BYTES || worksheetCount > MAX_SHEETS) {
            exceededSheetBudget = true; return false;
          }
          return true;
        }
        return false;
      },
    });
  } catch {
    return { status: "unsupported" };
  }

  if (exceededSheetBudget) return { status: "too-large" };
  const workbookXmlBytes = entries[WORKBOOK_PATH];
  if (!workbookXmlBytes) return { status: "unsupported" };

  let workbookXml: string;
  let relsXml = "";
  let sharedStringsXml = "";
  try {
    workbookXml = new TextDecoder("utf-8").decode(workbookXmlBytes);
    const relsBytes = entries[WORKBOOK_RELS_PATH];
    if (relsBytes) relsXml = new TextDecoder("utf-8").decode(relsBytes);
    const sharedStringsBytes = entries[SHARED_STRINGS_PATH];
    if (sharedStringsBytes) sharedStringsXml = new TextDecoder("utf-8").decode(sharedStringsBytes);
  } catch {
    return { status: "failed" };
  }

  const structureWarnings = new Set<SourceStructureWarning>();
  const identities = readWorkbookSheetIdentities(workbookXml);
  if (!identities) structureWarnings.add("workbook-sheet-metadata-unavailable");
  let workbookSheets: WorkbookSheet[];
  let relationships: Map<string, string>;
  let sharedStrings: string[];
  try {
    workbookSheets = identities ? identities.slice(0, MAX_SHEETS).map(i => ({ name: i.sheetName, relId: i.relId })) : parseWorkbookSheets(workbookXml, MAX_SHEETS);
    const rels = readWorksheetRelationships(relsXml);
    relationships = rels.paths;
    if (rels.malformed) structureWarnings.add("workbook-sheet-metadata-unavailable");
    sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml, 1_000_000) : [];
  } catch {
    return { status: "failed" };
  }
  if (workbookSheets.length === 0) return { status: "empty", sheets: [], structureWarnings: [...structureWarnings] };
  if (identities && identities.length > MAX_SHEETS) structureWarnings.add("structure-truncated");

  const sheets: SpreadsheetSheet[] = [];
  let totalRows = 0;
  for (const sheet of workbookSheets) {
    const path = relationships.get(sheet.relId);
    const bytes = path ? entries[path] : undefined;
    if (!bytes) { structureWarnings.add("workbook-sheet-metadata-unavailable"); continue; }

    let sheetXml: string;
    try {
      sheetXml = new TextDecoder("utf-8").decode(bytes);
    } catch {
      return { status: "failed" };
    }

    let parsed: SheetParseResult;
    try {
      parsed = parseWorksheetRows(sheetXml, sharedStrings, MAX_ROWS_PER_SHEET, MAX_COLUMNS_PER_ROW);
    } catch {
      return { status: "failed" };
    }
    if (parsed.truncated) return { status: "too-large" };

    totalRows += parsed.rows.length;
    if (totalRows > MAX_TOTAL_ROWS) return { status: "too-large" };

    const identity = identities?.find(i => i.relId === sheet.relId && i.sheetName === sheet.name);
    // Aliased worksheet parts are malformed, so avoid publishing either claimed identity.
    const aliased = workbookSheets.filter(s => relationships.get(s.relId) === path).length > 1;
    if (aliased) structureWarnings.add("workbook-sheet-metadata-unavailable");
    sheets.push({ name: sheet.name, rows: parsed.rows, ...(identity && !aliased ? { identity: {
      sheetName: identity.sheetName, sheetIndex: identity.sheetIndex, visibility: identity.visibility,
    } } : {}) });
  }

  const hasAnyContent = sheets.some((s) => s.rows.some((row) => row.some((cell) => cell.trim().length > 0)));
  return { status: hasAnyContent ? "ready" : "empty", sheets, structureWarnings: [...structureWarnings] };
}

// ---- Text representation + chunking (reuses the existing flat-text chunker) ----

/**
 * Renders a workbook as one flat, honest text document — "Sheet: X" / "Columns: ..." / "Row N:
 * a | b | c" — then runs it through the SAME `segmentText` every TXT/PDF source already uses, so
 * line/char provenance is real (it cites real lines/characters of THIS generated text). Worksheet
 * identity is attached separately by interval intersection without changing text or chunking.
 * The first row of each
 * sheet is treated as a header row (its values become the "Columns:" line) only when the sheet
 * has more than one row — a single-row sheet has no separate header to extract.
 */
export function buildSpreadsheetText(sheets: SpreadsheetSheet[]): string {
  return buildSpreadsheetTextWithMetadata(sheets).text;
}
function buildSpreadsheetTextWithMetadata(sheets: SpreadsheetSheet[]): { text: string; worksheets: WorksheetStructureMetadata[]; truncatedTitle: boolean } {
  const parts: string[] = [], worksheets: WorksheetStructureMetadata[] = [];
  let offset = 0, truncatedTitle = false;
  for (const sheet of sheets) {
    const nonEmptyRows = sheet.rows.filter((row) => row.some((cell) => cell.trim().length > 0));
    const identity = sheet.identity ? { ...sheet.identity, sheetName: boundStructureTitle(sheet.identity.sheetName) } : undefined;
    if (identity && identity.sheetName !== sheet.identity!.sheetName) truncatedTitle = true;
    if (nonEmptyRows.length === 0) { if (identity) worksheets.push(identity); continue; }

    const lines: string[] = [`Sheet: ${sheet.name}`];
    const [header, ...dataRows] = nonEmptyRows;
    if (dataRows.length > 0) {
      lines.push(`Columns: ${header.join(" | ")}`);
      dataRows.forEach((row, i) => lines.push(`Row ${i + 1}: ${row.join(" | ")}`));
    } else {
      // Only one real row in the whole sheet — nothing to call a "header" versus "data" distinctly.
      lines.push(`Row 1: ${header.join(" | ")}`);
    }
    const part = lines.join("\n");
    if (parts.length) offset += 2;
    if (identity) worksheets.push({ ...identity, charRange: { start: offset, end: offset + part.length } });
    parts.push(part); offset += part.length;
  }
  return { text: parts.join("\n\n"), worksheets, truncatedTitle };
}

export type SpreadsheetAdapterInput = {
  sourceId: string;
  sourceType: SourceType;
  title: string;
  originalName?: string;
  language?: string;
  byteSize?: number;
  archiveBytes: Uint8Array;
};

export type SpreadsheetAdapterOutcome =
  | { status: "ready"; content: NormalizedSourceContent }
  | { status: "empty"; content: NormalizedSourceContent }
  | { status: "too-large" }
  | { status: "unsupported" }
  | { status: "failed" };

export function normalizeSpreadsheetSource(input: SpreadsheetAdapterInput): SpreadsheetAdapterOutcome {
  const read = readSpreadsheetArchive(input.archiveBytes);
  if (read.status === "too-large" || read.status === "unsupported" || read.status === "failed") {
    return { status: read.status };
  }

  const rendered = buildSpreadsheetTextWithMetadata(read.sheets);
  const warnings = new Set(read.structureWarnings);
  if (rendered.truncatedTitle) warnings.add("structure-truncated");
  const base = {
    sourceId: input.sourceId,
    sourceType: input.sourceType,
    title: input.title,
    originalName: input.originalName,
    language: input.language,
    contentKind: "text" as const,
    metadata: { byteSize: input.byteSize, worksheets: rendered.worksheets, structureWarnings: [...warnings] },
    normalizationVersion: NORMALIZATION_VERSION,
  };

  if (read.status === "empty") {
    return { status: "empty", content: { ...base, chunks: [], extraction: { status: "empty", adapter: "spreadsheet-structured-v1" } } };
  }

  // read.status === "ready"
  const text = rendered.text;
  if (text.length === 0) {
    return { status: "empty", content: { ...base, chunks: [], extraction: { status: "empty", adapter: "spreadsheet-structured-v1" } } };
  }

  const { chunks, truncated } = segmentText(input.sourceId, text);
  if (truncated) return { status: "too-large" };
  for (const chunk of chunks) {
    const range = chunk.provenance.charRange!;
    chunk.provenance.worksheets = rendered.worksheets.filter(sheet => sheet.charRange && range.start < sheet.charRange.end && range.end > sheet.charRange.start)
      .map(({ sheetName, sheetIndex, visibility }) => ({ sheetName, sheetIndex, visibility }));
  }

  return {
    status: "ready",
    content: { ...base, chunks, extraction: { status: "ready", adapter: "spreadsheet-structured-v1" } },
  };
}

