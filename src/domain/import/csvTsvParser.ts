import { MAX_IMPORT_BACK_LENGTH, MAX_IMPORT_CARDS, MAX_IMPORT_FRONT_LENGTH, MAX_IMPORT_LINE_LENGTH } from "./importLimits";
import type { ImportedCardDraft, ImportedDeckDraft, ImportParseResult, ImportWarning } from "./types";

// Pure, dependency-free CSV/TSV flashcard parser. Never touches storage (see types.ts's header
// comment) and never throws for ordinary malformed input — every failure mode is a typed
// ImportParseResult the caller renders as a friendly message, never a raw parser exception,
// filesystem path, or stack trace (see "Warnings" in the mission this was built from).

// Common Quizlet/flashcard-tool export header pairs, lowercase, trimmed. Matched against BOTH
// cells of the first row before anything else is decided — exact match only (never a prefix/
// fuzzy match), so a genuine flashcard whose front happens to start with "term" is never
// mistaken for a header by accident.
const KNOWN_HEADER_PAIRS: readonly [string, string][] = [
  ["term", "definition"],
  ["front", "back"],
  ["question", "answer"],
  ["word", "meaning"],
  ["prompt", "answer"],
  ["front text", "back text"],
];

function isHeaderRow(front: string, back: string): boolean {
  const f = front.trim().toLowerCase();
  const b = back.trim().toLowerCase();
  return KNOWN_HEADER_PAIRS.some(([hf, hb]) => hf === f && hb === b);
}

function splitLines(raw: string): string[] {
  return raw.split(/\r\n|\r|\n/);
}

/**
 * Minimal, robust RFC-4180-style CSV tokenizer. Returns one array of string fields per row.
 * Handles: quoted fields (including embedded commas and embedded newlines), `""` as an escaped
 * literal quote inside a quoted field, and CRLF/CR/LF row separators. A field is never required
 * to be quoted — plain unquoted fields are the common case for a simple two-column export.
 */
function tokenizeCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = raw.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < len) {
    const ch = raw[i];

    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && field.length === 0) {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      endRow();
      i += raw[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Trailing field/row (file doesn't end with a newline).
  if (field.length > 0 || row.length > 0) endRow();

  return rows;
}

function deriveDeckName(fileName: string | undefined): string {
  if (!fileName) return "";
  const withoutExtension = fileName.replace(/\.[^./\\]+$/, "");
  const cleaned = withoutExtension.replace(/[_-]+/g, " ").trim();
  return cleaned;
}

type RowCounts = {
  skippedEmpty: number;
  skippedTooLong: number;
  skippedMalformed: number;
  headerSkipped: boolean;
};

function buildCandidateCards(rows: string[][], counts: RowCounts): ImportedCardDraft[] {
  const candidates: ImportedCardDraft[] = [];

  rows.forEach((fields, index) => {
    // A fully-blank row (every field empty, including a lone [""] from a stray blank line).
    if (fields.every((f) => f.trim().length === 0)) return;

    if (fields.length < 2) {
      counts.skippedMalformed += 1;
      return;
    }

    const front = fields[0].trim();
    const back = fields[1].trim();

    if (index === 0 && isHeaderRow(front, back)) {
      counts.headerSkipped = true;
      return;
    }

    if (front.length === 0 || back.length === 0) {
      counts.skippedEmpty += 1;
      return;
    }
    if (front.length > MAX_IMPORT_FRONT_LENGTH || back.length > MAX_IMPORT_BACK_LENGTH) {
      counts.skippedTooLong += 1;
      return;
    }

    candidates.push({ front, back });
  });

  return candidates;
}

function countDuplicates(cards: ImportedCardDraft[]): number {
  const seen = new Map<string, number>();
  for (const card of cards) {
    const key = `${card.front}\u0000${card.back}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  let duplicates = 0;
  for (const occurrences of seen.values()) {
    if (occurrences > 1) duplicates += occurrences - 1;
  }
  return duplicates;
}

export type ParseDelimitedFlashcardsOptions = {
  fileName?: string;
};

/**
 * Parses a raw CSV or TSV flashcard export into a format-neutral `ImportedDeckDraft`. Delimiter
 * is auto-detected: any tab character anywhere in the file selects TSV (simple split-on-first-tab
 * per line, matching how Quizlet's own TSV export is actually shaped — unquoted); otherwise CSV
 * (full RFC-4180-style quoting via `tokenizeCsv`). Never writes anything, never throws for
 * ordinary malformed input.
 */
export function parseDelimitedFlashcards(raw: string, options: ParseDelimitedFlashcardsOptions = {}): ImportParseResult {
  // Strip a leading UTF-8 BOM, exactly like the existing legacy-deck-import screen does.
  const cleaned = raw.replace(/^﻿/, "");

  if (cleaned.trim().length === 0) {
    return { status: "failed", failure: { code: "empty-file" } };
  }

  const isTsv = cleaned.includes("\t");

  let rows: string[][];
  if (isTsv) {
    rows = splitLines(cleaned)
      .filter((line) => line.length <= MAX_IMPORT_LINE_LENGTH)
      .map((line) => {
        const tabIndex = line.indexOf("\t");
        if (tabIndex === -1) return [line];
        return [line.slice(0, tabIndex), line.slice(tabIndex + 1)];
      });
  } else {
    // A pathologically long single CSV line (no newlines at all) is rejected outright rather
    // than tokenized — guards against an unbounded quoted field consuming unbounded memory.
    if (cleaned.length > MAX_IMPORT_LINE_LENGTH && splitLines(cleaned).every((l) => l.length > MAX_IMPORT_LINE_LENGTH)) {
      return { status: "failed", failure: { code: "no-readable-rows" } };
    }
    rows = tokenizeCsv(cleaned);
  }

  if (rows.length === 0) {
    return { status: "failed", failure: { code: "no-readable-rows" } };
  }

  const counts: RowCounts = { skippedEmpty: 0, skippedTooLong: 0, skippedMalformed: 0, headerSkipped: false };
  const allCandidates = buildCandidateCards(rows, counts);

  const truncatedCount = Math.max(0, allCandidates.length - MAX_IMPORT_CARDS);
  const cards = allCandidates.slice(0, MAX_IMPORT_CARDS);

  const duplicateCount = countDuplicates(cards);

  const warnings: ImportWarning[] = [];
  if (counts.headerSkipped) warnings.push({ code: "header-row-skipped" });
  if (counts.skippedEmpty > 0) warnings.push({ code: "rows-skipped-empty", count: counts.skippedEmpty });
  if (counts.skippedTooLong > 0) warnings.push({ code: "rows-skipped-too-long", count: counts.skippedTooLong });
  if (counts.skippedMalformed > 0) warnings.push({ code: "rows-skipped-malformed", count: counts.skippedMalformed });
  if (duplicateCount > 0) warnings.push({ code: "duplicates-found", count: duplicateCount });
  if (truncatedCount > 0) warnings.push({ code: "cards-truncated-at-limit", count: truncatedCount });

  const draft: ImportedDeckDraft = {
    name: deriveDeckName(options.fileName),
    cards,
    warnings,
    metadata: { sourceFormat: isTsv ? "tsv" : "csv", originalFileName: options.fileName },
  };

  return { status: "ok", draft };
}
