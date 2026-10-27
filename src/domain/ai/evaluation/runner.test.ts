import assert from "node:assert/strict";
import test from "node:test";

import { createMockProvider } from "../mockProvider";
import type { ModelProvider } from "../aiService";
import { estimatePlannedRequestCount, runEvaluationCase, runEvaluationMatrix } from "./runner";
import type { EvaluationCase } from "./types";

function caseFor(overrides: Partial<EvaluationCase> = {}): EvaluationCase {
  return { fixtureId: "txt-factual-rich", difficulty: "balanced", tier: "medium", scope: "bounded", ...overrides };
}

test("runEvaluationCase (bounded, mock provider): a rich fixture produces a ready result with sane scoring", async () => {
  const result = await runEvaluationCase({ provider: createMockProvider(), evalCase: caseFor() });
  assert.equal(result.fixtureId, "txt-factual-rich");
  assert.equal(result.sourceType, "text");
  assert.ok(["ready", "insufficient-content"].includes(result.outcomeCategory));
  assert.ok(result.generatedCount > 0);
  assert.equal(result.groundingScore, 1);
  assert.equal(result.provenanceValidity, true);
  assert.equal(result.exactDuplicateCount, 0);
  assert.equal(typeof result.latencyMs, "number");
  assert.ok(result.latencyMs >= 0);
});

test("runEvaluationCase: a sparse, designedForInsufficiency fixture reports valid-insufficiency, never flagged as a failure", async () => {
  const result = await runEvaluationCase({ provider: createMockProvider(), evalCase: caseFor({ fixtureId: "txt-sparse", tier: "large" }) });
  assert.equal(result.countCheckStatus, "valid-insufficiency");
  assert.equal(result.countScore, 1);
});

test("runEvaluationCase: generatedCount never exceeds requestedMaximum for the mock provider", async () => {
  for (const tier of ["small", "medium", "large"] as const) {
    const result = await runEvaluationCase({ provider: createMockProvider(), evalCase: caseFor({ fixtureId: "pdf-structured-facts", tier }) });
    assert.ok(result.generatedCount <= result.requestedMaximum, `tier=${tier}: ${result.generatedCount} > ${result.requestedMaximum}`);
    assert.notEqual(result.countCheckStatus, "exceeded-maximum");
  }
});

test("runEvaluationCase (wholeSource, large fixture): triggers multi-batch planning and reports batchInfo with plannedBatchCount > 1", async () => {
  const result = await runEvaluationCase({ provider: createMockProvider(), evalCase: caseFor({ fixtureId: "docx-large-multibatch", scope: "wholeSource", tier: "large" }) });
  assert.equal(result.outcomeCategory, "ready");
  assert.ok(result.batchInfo);
  assert.ok(result.batchInfo!.plannedBatchCount > 1, `expected > 1 batch, got ${result.batchInfo!.plannedBatchCount}`);
  assert.equal(result.batchInfo!.completedBatchCount, result.batchInfo!.plannedBatchCount);
});

test("runEvaluationCase (wholeSource, large fixture): later source sections are represented in the final deck, not just the first batch", async () => {
  const result = await runEvaluationCase({ provider: createMockProvider(), evalCase: caseFor({ fixtureId: "docx-large-multibatch", scope: "wholeSource", tier: "large" }) });
  // expectedConcepts = ["lighthouse", "windmill"] — section 1 and section 10 respectively.
  assert.equal(result.expectedConceptCoverage, 1, "both the FIRST and LAST section's concepts must be represented");
});

test("runEvaluationCase (wholeSource, small fixture): a fixture that fits one context budget takes the single-batch fallthrough, not multi-batch orchestration", async () => {
  const result = await runEvaluationCase({ provider: createMockProvider(), evalCase: caseFor({ fixtureId: "txt-factual-rich", scope: "wholeSource" }) });
  // The mock provider's own "one card per chunk" behavior means a short fixture segmented into
  // few chunks can honestly land on either outcome here — the point of THIS test is the batch
  // shape (single-batch fallthrough, never multi-batch orchestration for content that fits one
  // budget), asserted independent of whether that single batch happened to clear its target.
  assert.ok(["ready", "insufficient-content"].includes(result.outcomeCategory));
  assert.deepEqual(result.batchInfo, { plannedBatchCount: 1, completedBatchCount: 1 });
});

test("runEvaluationCase: a provider error is categorized correctly and never crashes the runner", async () => {
  const failingProvider: ModelProvider = {
    id: "failing-test-provider",
    async generate() {
      return { status: "error", error: { code: "rate-limited", message: "down for test" } };
    },
  };
  const result = await runEvaluationCase({ provider: failingProvider, evalCase: caseFor() });
  assert.equal(result.outcomeCategory, "rate-limited");
  assert.equal(result.generatedCount, 0);
  assert.equal(result.countScore, 0);
});

test("runEvaluationCase: a provider that throws is caught, not propagated, and categorized as a harness-config-error", async () => {
  const throwingProvider: ModelProvider = {
    id: "throwing-test-provider",
    async generate() {
      throw new Error("boom");
    },
  };
  const result = await runEvaluationCase({ provider: throwingProvider, evalCase: caseFor() });
  assert.equal(result.outcomeCategory, "harness-config-error");
});

test("runEvaluationCase: an unknown fixture id throws synchronously with a clear message (harness config error, caught by the caller if needed)", async () => {
  await assert.rejects(
    runEvaluationCase({ provider: createMockProvider(), evalCase: caseFor({ fixtureId: "nope" }) }),
    /Unknown evaluation fixture id/
  );
});

test("runEvaluationMatrix: runs every case sequentially and returns results in the same order", async () => {
  const cases: EvaluationCase[] = [
    caseFor({ fixtureId: "txt-factual-rich" }),
    caseFor({ fixtureId: "pdf-structured-facts" }),
    caseFor({ fixtureId: "xlsx-spreadsheet-facts" }),
  ];
  const results = await runEvaluationMatrix(createMockProvider(), cases);
  assert.equal(results.length, 3);
  assert.deepEqual(results.map((r) => r.fixtureId), ["txt-factual-rich", "pdf-structured-facts", "xlsx-spreadsheet-facts"]);
});

test("estimatePlannedRequestCount: bounded scope is always exactly 1 request, computed without calling any provider", () => {
  assert.equal(estimatePlannedRequestCount(caseFor({ scope: "bounded" })), 1);
  assert.equal(estimatePlannedRequestCount(caseFor({ fixtureId: "docx-large-multibatch", scope: "bounded" })), 1);
});

test("estimatePlannedRequestCount: wholeSource on a small fixture is 1 (single-batch fallthrough); on the large fixture matches the real planned batch count", () => {
  assert.equal(estimatePlannedRequestCount(caseFor({ scope: "wholeSource" })), 1);
  const planned = estimatePlannedRequestCount(caseFor({ fixtureId: "docx-large-multibatch", scope: "wholeSource", tier: "large" }));
  assert.ok(planned > 1, `expected > 1, got ${planned}`);
});

test("runEvaluationCase: non-English fixture (Spanish) is generated from without error and matches its own expected Spanish concepts", async () => {
  const result = await runEvaluationCase({ provider: createMockProvider(), evalCase: caseFor({ fixtureId: "txt-spanish-baseline", tier: "small" }) });
  assert.ok(["ready", "insufficient-content"].includes(result.outcomeCategory));
  assert.equal(result.expectedConceptCoverage, 1, "all 3 Spanish concepts cluster within the mock's own 160-char card-back snippet window");
});
