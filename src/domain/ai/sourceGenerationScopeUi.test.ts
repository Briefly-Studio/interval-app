import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";

import { normalizeDocxSource } from "../normalization/docxAdapter";
import { normalizeSpreadsheetSource } from "../normalization/spreadsheetAdapter";
import type { NormalizedSourceContent } from "../normalization/types";
import { extractSourceStructure, type SourceStructure } from "../sourceStructure";
import { buildSourceScopeChoices, buildStructureNodeChoices, buildStructureNodePickerLabel } from "./sourceGenerationScopeUi";

function values(choices: { value: string }[]): string[] {
  return choices.map((c) => c.value);
}

const structureSourceId = "structure-ui-fixture";
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
const EMPTY_STRUCTURE: SourceStructure = { sourceId: "", normalizationVersion: 0, nodes: [], warnings: [] };

test("a tiny source with no uncovered material still offers Automatic + Entire source (fits trivially)", () => {
  const choices = buildSourceScopeChoices({ totalSectionCount: 1, hasUncoveredMaterial: false, entireSourceAvailable: true });
  // entireSourceAvailable is true, but a 1-section source gains nothing from a separate "Entire
  // source" option distinct from Automatic — still, this function doesn't special-case that; it
  // simply reflects the inputs it was given. entireSource is offered whenever it fits.
  assert.deepEqual(values(choices), ["automatic", "entireSource"]);
});

test("offers Uncovered material only when there is actual uncovered content", () => {
  const withUncovered = buildSourceScopeChoices({ totalSectionCount: 10, hasUncoveredMaterial: true, entireSourceAvailable: true });
  const withoutUncovered = buildSourceScopeChoices({ totalSectionCount: 10, hasUncoveredMaterial: false, entireSourceAvailable: true });
  assert.ok(values(withUncovered).includes("uncovered"));
  assert.ok(!values(withoutUncovered).includes("uncovered"));
});

test("omits Entire source — never offers it disabled — when it would not fit", () => {
  const choices = buildSourceScopeChoices({ totalSectionCount: 500, hasUncoveredMaterial: false, entireSourceAvailable: false });
  assert.ok(!values(choices).includes("entireSource"));
});

test("offers Page range for a PDF with a known, multi-page count", () => {
  const choices = buildSourceScopeChoices({ totalSectionCount: 50, pageCount: 20, hasUncoveredMaterial: false, entireSourceAvailable: false });
  assert.ok(values(choices).includes("pageRange"));
  assert.ok(!values(choices).includes("sectionRange"));
});

test("never offers Page range for a single-page PDF — nothing to range over", () => {
  const choices = buildSourceScopeChoices({ totalSectionCount: 3, pageCount: 1, hasUncoveredMaterial: false, entireSourceAvailable: false });
  assert.ok(!values(choices).includes("pageRange"));
  // Falls back to the generic section range instead, since there are multiple sections.
  assert.ok(values(choices).includes("sectionRange"));
});

test("offers the generic Section range fallback for a non-PDF multi-section source", () => {
  const choices = buildSourceScopeChoices({ totalSectionCount: 40, hasUncoveredMaterial: false, entireSourceAvailable: false });
  assert.ok(values(choices).includes("sectionRange"));
  assert.ok(!values(choices).includes("pageRange"));
});

test("never offers Section range for a single-section source — nothing to range over", () => {
  const choices = buildSourceScopeChoices({ totalSectionCount: 1, hasUncoveredMaterial: false, entireSourceAvailable: false });
  assert.ok(!values(choices).includes("sectionRange"));
  assert.deepEqual(values(choices), ["automatic"]);
});

test("Automatic is always first and always present", () => {
  const choices = buildSourceScopeChoices({ totalSectionCount: 0, hasUncoveredMaterial: false, entireSourceAvailable: false });
  assert.equal(values(choices)[0], "automatic");
});

// ---- Structure-aware scope choice (DOCX heading / XLSX worksheet) ----

test("offers structureNode only when the source actually has real structure, never for an empty one", () => {
  const withHeadings = extractSourceStructure(docxContent(heading(1, "A") + para("Body")));
  const withNone = extractSourceStructure(docxContent(para("Just a paragraph, no headings")));
  const withHeadingsChoices = buildSourceScopeChoices({ totalSectionCount: 2, hasUncoveredMaterial: false, entireSourceAvailable: true, structure: withHeadings });
  const withNoneChoices = buildSourceScopeChoices({ totalSectionCount: 1, hasUncoveredMaterial: false, entireSourceAvailable: true, structure: withNone });
  const withNullChoices = buildSourceScopeChoices({ totalSectionCount: 1, hasUncoveredMaterial: false, entireSourceAvailable: true, structure: null });
  assert.ok(values(withHeadingsChoices).includes("structureNode"));
  assert.ok(!values(withNoneChoices).includes("structureNode"));
  assert.ok(!values(withNullChoices).includes("structureNode"));
});

test("uses document-section copy for DOCX headings and worksheet copy for XLSX, never the other", () => {
  const headingStructure = extractSourceStructure(docxContent(heading(1, "A") + para("Body")));
  const worksheetStructure = extractSourceStructure(workbookContent([{ name: "Sheet1", text: "A" }]));
  const headingChoice = buildSourceScopeChoices({ totalSectionCount: 2, hasUncoveredMaterial: false, entireSourceAvailable: true, structure: headingStructure })
    .find((c) => c.value === "structureNode")!;
  const worksheetChoice = buildSourceScopeChoices({ totalSectionCount: 1, hasUncoveredMaterial: false, entireSourceAvailable: true, structure: worksheetStructure })
    .find((c) => c.value === "structureNode")!;
  assert.equal(headingChoice.labelKey, "generateDeck.scope.documentSectionLabel");
  assert.equal(worksheetChoice.labelKey, "generateDeck.scope.worksheetLabel");
});

test("buildStructureNodeChoices mirrors document order and real ancestor titles, excluding the node itself", () => {
  const content = docxContent(heading(1, "AWS") + para("Intro") + heading(2, "IAM") + para("Detail"));
  const structure = extractSourceStructure(content);
  const choices = buildStructureNodeChoices(structure);
  assert.deepEqual(choices.map((c) => c.title), ["AWS", "IAM"]);
  assert.deepEqual(choices[0].ancestorTitles, []);
  assert.deepEqual(choices[1].ancestorTitles, ["AWS"]);
  assert.deepEqual(choices[0].level, 1);
  assert.deepEqual(choices[1].level, 2);
});

test("buildStructureNodeChoices marks a node with zero chunks disabled, without omitting it", () => {
  // An empty worksheet is the one real case that produces zero chunks for a node — a DOCX
  // heading's own interval always includes at least its own heading-text chunk (see
  // sourceStructure.ts's extractSourceStructure), so "no body" there still means chunkCount 1.
  const content = workbookContent([{ name: "HasText", text: "A" }, { name: "Empty", text: "" }]);
  const structure = extractSourceStructure(content);
  const choices = buildStructureNodeChoices(structure);
  const [withText, empty] = choices;
  assert.equal(withText.disabled, false);
  assert.ok(withText.chunkCount > 0);
  assert.equal(empty.disabled, true);
  assert.equal(empty.chunkCount, 0);
});

test("buildStructureNodeChoices flags titleIsAmbiguous only for a real duplicate title, disambiguated by true ancestor identity", () => {
  const content = docxContent(heading(1, "A") + heading(2, "Dup") + heading(1, "B") + heading(2, "Dup"));
  const structure = extractSourceStructure(content);
  const choices = buildStructureNodeChoices(structure);
  const [a, dup1, b, dup2] = choices;
  assert.equal(a.titleIsAmbiguous, false);
  assert.equal(b.titleIsAmbiguous, false);
  assert.equal(dup1.titleIsAmbiguous, true);
  assert.equal(dup2.titleIsAmbiguous, true);
  assert.deepEqual(dup1.ancestorTitles, ["A"]);
  assert.deepEqual(dup2.ancestorTitles, ["B"]);
  // Different parents — breadcrumb already disambiguates them, so no positional noise is added.
  assert.equal(dup1.duplicatePosition, undefined);
  assert.equal(dup2.duplicatePosition, undefined);
});

test("buildStructureNodeChoices discloses sharedWithOtherNodes exactly for nodes with overlapping chunk membership", () => {
  const content = workbookContent([{ name: "One", text: "A" }, { name: "Two", text: "B" }]);
  const structure = extractSourceStructure(content);
  const choices = buildStructureNodeChoices(structure);
  assert.ok(choices.every((c) => c.sharedWithOtherNodes === true));
});

test("buildStructureNodeChoices returns [] for an empty structure", () => {
  assert.deepEqual(buildStructureNodeChoices(EMPTY_STRUCTURE), []);
});

// ---- Duplicate-sibling disambiguation (same title AND same parent) ----

test("two same-title sibling nodes (same parent) are visibly distinguishable via positional context", () => {
  const content = docxContent(heading(1, "AWS") + heading(2, "Intro") + para("First") + heading(2, "Intro") + para("Second"));
  const structure = extractSourceStructure(content);
  const choices = buildStructureNodeChoices(structure);
  const siblings = choices.filter((c) => c.title === "Intro");
  assert.equal(siblings.length, 2);
  // Breadcrumb can't help here — both siblings share the identical ancestor path — so
  // titleIsAmbiguous (the breadcrumb-qualify flag) stays false; disambiguation instead comes
  // from duplicatePosition, derived from real document order.
  assert.ok(siblings.every((c) => c.titleIsAmbiguous === false));
  assert.deepEqual(siblings.map((c) => c.duplicatePosition), [
    { position: 1, total: 2 },
    { position: 2, total: 2 },
  ]);
  assert.notEqual(siblings[0].nodeId, siblings[1].nodeId);
});

test("three same-title siblings are all distinguishable, each with a unique position", () => {
  const content = docxContent(heading(1, "AWS") + heading(2, "Intro") + heading(2, "Intro") + heading(2, "Intro"));
  const structure = extractSourceStructure(content);
  const choices = buildStructureNodeChoices(structure);
  const siblings = choices.filter((c) => c.title === "Intro");
  assert.equal(siblings.length, 3);
  assert.deepEqual(siblings.map((c) => c.duplicatePosition), [
    { position: 1, total: 3 },
    { position: 2, total: 3 },
    { position: 3, total: 3 },
  ]);
  assert.equal(new Set(siblings.map((c) => c.nodeId)).size, 3, "every sibling keeps its own distinct nodeId");
});

test("a unique title never gets unnecessary positional suffix/context", () => {
  const content = docxContent(heading(1, "AWS") + para("Intro") + heading(2, "IAM") + para("Detail"));
  const structure = extractSourceStructure(content);
  const choices = buildStructureNodeChoices(structure);
  assert.ok(choices.every((c) => c.duplicatePosition === undefined));
});

const LABEL_COPY = {
  ancestorContext: (path: string) => `Under ${path}`,
  levelContext: (level: number) => `Heading level ${level}`,
  duplicatePosition: (position: number, total: number) => `${position} of ${total} with this exact title`,
  emptyHint: "No content in this section yet.",
  sharedHint: "Shared with another worksheet.",
  sectionCount: (count: number) => `${count} source sections`,
};

test("buildStructureNodePickerLabel: same-parent siblings render identical labels but distinguishable descriptions, and selection stays nodeId-based", () => {
  const content = docxContent(heading(1, "AWS") + heading(2, "Intro") + para("First") + heading(2, "Intro") + para("Second"));
  const structure = extractSourceStructure(content);
  const choices = buildStructureNodeChoices(structure);
  const siblings = choices.filter((c) => c.title === "Intro");
  const rendered = siblings.map((c) => buildStructureNodePickerLabel(c, false, LABEL_COPY));
  // The on-screen label alone is identical for both — expected, since breadcrumb can't help here.
  assert.equal(rendered[0].label, rendered[1].label);
  // The secondary description line is what actually makes the two rows distinguishable.
  assert.notEqual(rendered[0].description, rendered[1].description);
  assert.equal(rendered[0].description, "1 of 2 with this exact title");
  assert.equal(rendered[1].description, "2 of 2 with this exact title");
  // Selection must still resolve by nodeId, never by the (possibly identical) displayed text.
  assert.notEqual(siblings[0].nodeId, siblings[1].nodeId);
});

test("buildStructureNodePickerLabel: accessibility label always includes the disambiguating context", () => {
  const content = docxContent(heading(1, "AWS") + heading(2, "Intro") + para("First") + heading(2, "Intro") + para("Second"));
  const structure = extractSourceStructure(content);
  const choices = buildStructureNodeChoices(structure);
  const siblings = choices.filter((c) => c.title === "Intro");
  const rendered = siblings.map((c) => buildStructureNodePickerLabel(c, false, LABEL_COPY));
  assert.ok(rendered[0].accessibilityLabel.includes("1 of 2 with this exact title"));
  assert.ok(rendered[1].accessibilityLabel.includes("2 of 2 with this exact title"));
  assert.notEqual(rendered[0].accessibilityLabel, rendered[1].accessibilityLabel);
});

test("buildStructureNodePickerLabel joins real ancestor context root-first, and never reorders it for direction", () => {
  const content = docxContent(heading(1, "AWS") + heading(2, "Security") + heading(3, "IAM") + para("Body"));
  const structure = extractSourceStructure(content);
  const choices = buildStructureNodeChoices(structure);
  const leaf = choices.find((c) => c.title === "IAM")!;
  assert.deepEqual(leaf.ancestorTitles, ["AWS", "Security"]);
  const rendered = buildStructureNodePickerLabel(leaf, false, LABEL_COPY);
  // Root-first order ("AWS" before "Security") must come through unchanged — this function takes
  // no direction flag at all, since mirroring for RTL is a text-rendering/bidi concern handled
  // elsewhere (StructureNodePicker's own indentation), never a reordering of this logical array.
  assert.ok(rendered.accessibilityLabel.indexOf("AWS") < rendered.accessibilityLabel.indexOf("Security"));
});
