import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSourceScopeChoices } from "./sourceGenerationScopeUi";

function values(choices: { value: string }[]): string[] {
  return choices.map((c) => c.value);
}

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
