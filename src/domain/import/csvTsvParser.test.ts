import { test } from "node:test";
import assert from "node:assert/strict";

import { parseDelimitedFlashcards } from "./csvTsvParser";
import { MAX_IMPORT_CARDS, MAX_IMPORT_FRONT_LENGTH } from "./importLimits";

function warningCount(warnings: { code: string; count?: number }[], code: string): number | undefined {
  return warnings.find((w) => w.code === code)?.count;
}

test("basic two-column TSV parses front/back pairs", () => {
  const result = parseDelimitedFlashcards("hola\thello\nadiós\tgoodbye\n");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.draft.cards, [
    { front: "hola", back: "hello" },
    { front: "adiós", back: "goodbye" },
  ]);
  assert.equal(result.draft.metadata?.sourceFormat, "tsv");
});

test("standard CSV with no quoting parses correctly", () => {
  const result = parseDelimitedFlashcards("cat,a small domesticated feline\ndog,a loyal canine\n");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.draft.cards, [
    { front: "cat", back: "a small domesticated feline" },
    { front: "dog", back: "a loyal canine" },
  ]);
  assert.equal(result.draft.metadata?.sourceFormat, "csv");
});

test("CSV with quoted commas inside fields", () => {
  const result = parseDelimitedFlashcards('"apples, oranges, and pears",a fruit basket\n');
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.draft.cards, [{ front: "apples, oranges, and pears", back: "a fruit basket" }]);
});

test("CSV with a quoted multiline field preserves the embedded newline", () => {
  const result = parseDelimitedFlashcards('"line one\nline two",the back\n');
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.draft.cards, [{ front: "line one\nline two", back: "the back" }]);
});

test("CSV with an escaped double-quote inside a quoted field", () => {
  const result = parseDelimitedFlashcards('"she said ""hi""",a greeting\n');
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.draft.cards, [{ front: 'she said "hi"', back: "a greeting" }]);
});

test("Unicode/non-English text is preserved exactly", () => {
  const result = parseDelimitedFlashcards("日本語\tJapanese\nمرحبا\tHello (Arabic)\n");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.draft.cards, [
    { front: "日本語", back: "Japanese" },
    { front: "مرحبا", back: "Hello (Arabic)" },
  ]);
});

test("blank lines are skipped, not turned into empty cards", () => {
  const result = parseDelimitedFlashcards("a\t1\n\n\nb\t2\n");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.draft.cards.length, 2);
});

test("a known header row (Term, Definition) is detected and skipped with a warning", () => {
  const result = parseDelimitedFlashcards("Term,Definition\ncat,a feline\n");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.draft.cards, [{ front: "cat", back: "a feline" }]);
  assert.ok(result.draft.warnings.some((w) => w.code === "header-row-skipped"));
});

test("a first row that merely looks like real card content is never mistaken for a header", () => {
  const result = parseDelimitedFlashcards("terminology\tdefinitions are fun\nfoo\tbar\n");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.draft.cards.length, 2);
  assert.ok(!result.draft.warnings.some((w) => w.code === "header-row-skipped"));
});

test("rows missing a front or back are skipped and counted, never imported blank", () => {
  const result = parseDelimitedFlashcards("front1\tback1\n\t\nfront2\t\n\tback3\nfront4\tback4\n");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.draft.cards, [
    { front: "front1", back: "back1" },
    { front: "front4", back: "back4" },
  ]);
  assert.equal(warningCount(result.draft.warnings, "rows-skipped-empty"), 2);
});

test("a malformed row with only one column is skipped and counted", () => {
  const result = parseDelimitedFlashcards("a,1\njust-one-field\nb,2\n");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.draft.cards.length, 2);
  assert.equal(warningCount(result.draft.warnings, "rows-skipped-malformed"), 1);
});

test("an empty file fails with empty-file", () => {
  const result = parseDelimitedFlashcards("   \n\n  ");
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.failure.code, "empty-file");
});

test("a field over the max length is skipped and counted, never silently truncated", () => {
  const tooLong = "x".repeat(MAX_IMPORT_FRONT_LENGTH + 1);
  const result = parseDelimitedFlashcards(`${tooLong}\tback\nshort\tback\n`);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.draft.cards.length, 1);
  assert.equal(warningCount(result.draft.warnings, "rows-skipped-too-long"), 1);
});

test("more rows than MAX_IMPORT_CARDS are truncated with an explicit warning, not silently dropped", () => {
  const rows = Array.from({ length: MAX_IMPORT_CARDS + 25 }, (_, i) => `front${i}\tback${i}`).join("\n");
  const result = parseDelimitedFlashcards(rows);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.draft.cards.length, MAX_IMPORT_CARDS);
  assert.equal(warningCount(result.draft.warnings, "cards-truncated-at-limit"), 25);
});

test("exact duplicate rows are detected and warned about, but never removed", () => {
  const result = parseDelimitedFlashcards("cat\tfeline\ndog\tcanine\ncat\tfeline\ncat\tfeline\n");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.draft.cards.length, 4);
  assert.equal(warningCount(result.draft.warnings, "duplicates-found"), 2);
});

test("two identical-looking cards that are NOT byte-identical are not flagged as duplicates", () => {
  const result = parseDelimitedFlashcards("cat\tfeline\nCat\tfeline\n");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.draft.cards.length, 2);
  assert.ok(!result.draft.warnings.some((w) => w.code === "duplicates-found"));
});

test("deck name is derived from the file name, extension and separators stripped", () => {
  const result = parseDelimitedFlashcards("a\t1\n", { fileName: "spanish_vocab-export.tsv" });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.draft.name, "spanish vocab export");
});

test("no file name yields an empty derived deck name (caller supplies a fallback)", () => {
  const result = parseDelimitedFlashcards("a\t1\n");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.draft.name, "");
});

test("trimming is applied to fields but never collapses meaningful internal whitespace", () => {
  const result = parseDelimitedFlashcards("  hello world  \t  goodbye world  \n");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.draft.cards, [{ front: "hello world", back: "goodbye world" }]);
});

test("CRLF line endings are handled identically to LF", () => {
  const result = parseDelimitedFlashcards("a\t1\r\nb\t2\r\n");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.draft.cards.length, 2);
});

test("a leading UTF-8 BOM is stripped and never ends up inside the first field", () => {
  // "hello"/"world" (not "front"/"back") deliberately avoids colliding with the header-pair
  // detection list — this test is about BOM stripping, not header detection.
  const result = parseDelimitedFlashcards("﻿hello\tworld\n");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.draft.cards[0].front, "hello");
});

test("CSV wins the delimiter auto-detection only when no tab is present anywhere", () => {
  // A comma appearing inside an otherwise-TSV file must not flip delimiter detection — any tab
  // anywhere selects TSV mode for the whole file.
  const result = parseDelimitedFlashcards("front, with a comma\tback, also with a comma\n");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.draft.metadata?.sourceFormat, "tsv");
  assert.deepEqual(result.draft.cards, [{ front: "front, with a comma", back: "back, also with a comma" }]);
});
