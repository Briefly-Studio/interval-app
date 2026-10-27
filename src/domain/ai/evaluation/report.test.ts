import assert from "node:assert/strict";
import test from "node:test";

import { buildEvaluationReport, checkRegressions, formatConsoleTable, formatFailureSummary } from "./report";
import type { GenerationEvaluationResult } from "./types";

function readyResult(overrides: Partial<GenerationEvaluationResult> = {}): GenerationEvaluationResult {
  return {
    fixtureId: "txt-factual-rich",
    sourceType: "text",
    difficulty: "balanced",
    tier: "medium",
    scope: "bounded",
    outcomeCategory: "ready",
    generatedCount: 12,
    targetMinimum: 10,
    requestedMaximum: 15,
    countCheckStatus: "within-range",
    countScore: 1,
    groundingScore: 1,
    provenanceValidity: true,
    exactDuplicateCount: 0,
    latencyMs: 5,
    generationStatus: "complete",
    ...overrides,
  };
}

test("checkRegressions: a clean within-range ready result passes with zero failures", () => {
  const { passed, failures } = checkRegressions([readyResult()], "mock");
  assert.equal(passed, true);
  assert.deepEqual(failures, []);
});

test("checkRegressions: exceeded-maximum is a hard failure", () => {
  const { passed, failures } = checkRegressions([readyResult({ countCheckStatus: "exceeded-maximum" })], "mock");
  assert.equal(passed, false);
  assert.match(failures[0].reason, /exceeding the requested maximum/);
});

test("checkRegressions: unexplained-under-target is a hard failure", () => {
  const { passed, failures } = checkRegressions([readyResult({ countCheckStatus: "unexplained-under-target", generatedCount: 4 })], "mock");
  assert.equal(passed, false);
  assert.match(failures[0].reason, /while self-reporting "complete"/);
});

test("checkRegressions: valid-insufficiency (an honest shortfall) is NOT a failure", () => {
  const { passed } = checkRegressions([readyResult({ countCheckStatus: "valid-insufficiency", outcomeCategory: "insufficient-content", generatedCount: 3, generationStatus: "insufficient-distinct-content" })], "mock");
  assert.equal(passed, true);
});

test("checkRegressions: invalid provenance is a hard failure", () => {
  const { passed, failures } = checkRegressions([readyResult({ provenanceValidity: false })], "mock");
  assert.equal(passed, false);
  assert.match(failures[0].reason, /invalid provenance/);
});

test("checkRegressions: an exact duplicate is a hard failure", () => {
  const { passed, failures } = checkRegressions([readyResult({ exactDuplicateCount: 1 })], "mock");
  assert.equal(passed, false);
  assert.match(failures[0].reason, /exact-duplicate/);
});

test("checkRegressions: expected-concept coverage below the fixture's threshold (default 1) is a hard failure", () => {
  const { passed, failures } = checkRegressions([readyResult({ expectedConceptCoverage: 0.5 })], "mock");
  assert.equal(passed, false);
  assert.match(failures[0].reason, /coverage 0\.50 below threshold 1/);
});

test("checkRegressions: full expected-concept coverage passes", () => {
  const { passed } = checkRegressions([readyResult({ expectedConceptCoverage: 1 })], "mock");
  assert.equal(passed, true);
});

test("checkRegressions: an unsupported/forbidden claim is a hard failure", () => {
  const { passed, failures } = checkRegressions([readyResult({ unsupportedClaimCount: 1 })], "mock");
  assert.equal(passed, false);
  assert.match(failures[0].reason, /forbidden\/unsupported concept/);
});

test("checkRegressions (mock mode): a provider-unavailable outcome is ALWAYS a hard failure — the mock must never legitimately produce one", () => {
  const { passed, failures } = checkRegressions([readyResult({ outcomeCategory: "provider-unavailable", provenanceValidity: false })], "mock");
  assert.equal(passed, false);
  assert.match(failures[0].reason, /non-ready outcome "provider-unavailable"/);
});

test("checkRegressions (real mode): the SAME provider-unavailable outcome is observational only, not a hard failure", () => {
  const { passed, failures } = checkRegressions([readyResult({ outcomeCategory: "provider-unavailable", provenanceValidity: false })], "real");
  assert.equal(passed, true);
  assert.deepEqual(failures, []);
});

test("checkRegressions (real mode): a genuine validation-failure is STILL a hard failure even in real mode (not an infra category)", () => {
  const { passed } = checkRegressions([readyResult({ outcomeCategory: "validation-failure" })], "real");
  assert.equal(passed, false);
});

test("buildEvaluationReport: carries providerMode/providerId/caseCount and the full results+failures", () => {
  const report = buildEvaluationReport({ providerMode: "mock", providerId: "mock-v1", results: [readyResult(), readyResult({ countCheckStatus: "exceeded-maximum" })] });
  assert.equal(report.providerMode, "mock");
  assert.equal(report.providerId, "mock-v1");
  assert.equal(report.caseCount, 2);
  assert.equal(report.passed, false);
  assert.equal(report.failures.length, 1);
  assert.equal(report.results.length, 2);
  assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("formatConsoleTable: produces a header row, a separator row, and one row per result, all with aligned column widths", () => {
  const table = formatConsoleTable([readyResult(), readyResult({ fixtureId: "pdf-structured-facts", tier: "large" })]);
  const lines = table.split("\n");
  assert.equal(lines.length, 4); // header + separator + 2 rows
  assert.match(lines[0], /^Fixture/);
  assert.match(lines[1], /^-+-\|-/);
});

test("formatFailureSummary: 'No regression failures.' when clean, one FAIL line per failure otherwise", () => {
  assert.equal(formatFailureSummary([]), "No regression failures.");
  const { failures } = checkRegressions([readyResult({ exactDuplicateCount: 2 })], "mock");
  const summary = formatFailureSummary(failures);
  assert.match(summary, /^FAIL txt-factual-rich\/balanced\/medium\/bounded: 2 exact-duplicate/);
});
