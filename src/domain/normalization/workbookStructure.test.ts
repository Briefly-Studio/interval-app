import assert from "node:assert/strict";
import { test } from "node:test";
import { readWorkbookSheetIdentities, readWorksheetRelationships } from "./workbookStructure";

const type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
test("metadata parser respects comments, whitespace, entities, tab order and visibility", () => {
  const result = readWorkbookSheetIdentities(`<workbook><sheets><!-- <sheet name="Fake" r:id="fake"/> --><sheet name = 'Q4 &amp; 日本語' r:id = 'a' state='hidden'/><sheet name="Empty" r:id="b"/></sheets></workbook>`);
  assert.deepEqual(result, [
    { sheetName: "Q4 & 日本語", relId: "a", sheetIndex: 1, visibility: "hidden" },
    { sheetName: "Empty", relId: "b", sheetIndex: 2, visibility: "visible" },
  ]);
});
test("metadata XML rejects malformed nesting, repeated attributes, DTDs and excessive depth", () => {
  for (const xml of ["<workbook><sheets></workbook>", '<workbook><sheets></sheets bad="x"></workbook>', "<workbook><!-- malformed -- comment --></workbook>", "<workbook><sheets/><sheets/></workbook>", '<workbook a="x" a="y"/>', '<workbook><sheets><sheet name="A &bad" r:id="a"/></sheets></workbook>', '<!DOCTYPE workbook><workbook/>', '<workbook>' + '<x>'.repeat(17) + '</x>'.repeat(17) + '</workbook>', '<workbook><sheets><sheet name="A" r:id="a" state="unknown"/></sheets></workbook>']) {
    assert.equal(readWorkbookSheetIdentities(xml), null);
  }
});
test("relationships reject duplicate IDs, external mode, traversal and wrong relationship type", () => {
  const rel = (attrs: string) => `<Relationship Type="${type}" ${attrs}/>`;
  const result = readWorksheetRelationships(`<Relationships>${rel('Id="dup" Target="worksheets/sheet1.xml"')}${rel('Id="dup" Target="worksheets/sheet2.xml"')}${rel('Id="ext" Target="worksheets/sheet1.xml" TargetMode="External"')}${rel('Id="bad" Target="../worksheets/sheet1.xml"')}<Relationship Id="wrong" Type="image" Target="worksheets/sheet1.xml"/>${rel('Id="ok" Target="/xl/worksheets/sheet3.xml"')}</Relationships>`);
  assert.equal(result.malformed, true);
  assert.deepEqual([...result.paths], [["ok", "xl/worksheets/sheet3.xml"]]);
});
test("malformed XML/relationship cycles cannot trigger recursive or external resolution", () => {
  assert.equal(readWorksheetRelationships("<Relationships><Relationship></bad>").paths.size, 0);
  assert.equal(readWorksheetRelationships(`<Relationships><Relationship Id="self" Type="${type}" Target="_rels/workbook.xml.rels"/></Relationships>`).paths.size, 0);
});

test("metadata element and XML size limits are bounded optional failures", () => {
  assert.equal(readWorkbookSheetIdentities("<workbook>" + "<x/>".repeat(10001) + "</workbook>"), null);
  assert.equal(readWorkbookSheetIdentities("<workbook>" + " ".repeat(1024 * 1024) + "</workbook>"), null);
});
