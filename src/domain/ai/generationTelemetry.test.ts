import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";

import { emitGenerationReviewOutcome, type GenerationReviewOutcome } from "./generationTelemetry";

const g = globalThis as { __DEV__?: boolean };
let originalDev: boolean | undefined;
let logs: unknown[][];
let originalLog: typeof console.log;

beforeEach(() => {
  originalDev = g.__DEV__;
  logs = [];
  originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args);
  };
});

afterEach(() => {
  g.__DEV__ = originalDev;
  console.log = originalLog;
});

function sample(overrides: Partial<GenerationReviewOutcome> = {}): GenerationReviewOutcome {
  return {
    attemptId: "a1b2c3d4-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    generatedCount: 10,
    editedCount: 2,
    deletedCount: 1,
    savedCount: 9,
    abandoned: false,
    scopeType: "automatic",
    ...overrides,
  };
}

test("emitGenerationReviewOutcome: logs only the seven safe fields when __DEV__ is true", () => {
  g.__DEV__ = true;
  emitGenerationReviewOutcome(sample());
  assert.equal(logs.length, 1);
  const [, payload] = logs[0] as [string, Record<string, unknown>];
  assert.deepEqual(Object.keys(payload).sort(), ["abandoned", "attemptId", "deletedCount", "editedCount", "generatedCount", "savedCount", "scopeType", "structureNodeType"]);
  assert.equal(payload.attemptId, "a1b2c3d4-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(payload.generatedCount, 10);
  assert.equal(payload.scopeType, "automatic");
  assert.equal(payload.structureNodeType, undefined);
});

test("emitGenerationReviewOutcome: reports scopeType/structureNodeType for a structureNode generation, never a nodeId or title", () => {
  g.__DEV__ = true;
  emitGenerationReviewOutcome(sample({ scopeType: "structureNode", structureNodeType: "heading" }));
  const [, payload] = logs[0] as [string, Record<string, unknown>];
  assert.equal(payload.scopeType, "structureNode");
  assert.equal(payload.structureNodeType, "heading");
  assert.deepEqual(Object.keys(payload).sort(), ["abandoned", "attemptId", "deletedCount", "editedCount", "generatedCount", "savedCount", "scopeType", "structureNodeType"]);
});

test("emitGenerationReviewOutcome: silent when __DEV__ is false or undefined (matches multiBatchGeneration.ts's own convention)", () => {
  g.__DEV__ = false;
  emitGenerationReviewOutcome(sample());
  assert.equal(logs.length, 0);

  g.__DEV__ = undefined;
  emitGenerationReviewOutcome(sample());
  assert.equal(logs.length, 0);
});

test("emitGenerationReviewOutcome: a caller-widened object literal can never leak an extra field through — only the 7 known fields are ever read", () => {
  g.__DEV__ = true;
  const widened = { ...sample(), cardFront: "this must never be logged", sourceText: "neither must this" } as GenerationReviewOutcome;
  emitGenerationReviewOutcome(widened);
  const [, payload] = logs[0] as [string, Record<string, unknown>];
  assert.equal("cardFront" in payload, false);
  assert.equal("sourceText" in payload, false);
});

test("emitGenerationReviewOutcome: abandon case reports savedCount 0 and abandoned true (caller contract, not enforced here, but shape allows it)", () => {
  g.__DEV__ = true;
  emitGenerationReviewOutcome(sample({ savedCount: 0, abandoned: true }));
  const [, payload] = logs[0] as [string, Record<string, unknown>];
  assert.equal(payload.savedCount, 0);
  assert.equal(payload.abandoned, true);
});
