import assert from "node:assert/strict";
import { test } from "node:test";
import { generateAttemptId, generateProviderRequestId } from "./generationAttemptId";
import { generateStudyDeck, type ModelProvider, type ModelProviderInput } from "./aiService";
import { createBackendProvider } from "./backendProvider";
import { runMultiBatchGeneration } from "./multiBatchGeneration";
import { planGenerationBatches } from "./batchPlanning";
import { runEvaluationCase } from "./evaluation/runner";
import { createMockProvider } from "./mockProvider";
import { SUPPORTED_LOCALES } from "../../i18n/types";
import { translate } from "../../i18n/translate";
import type { NormalizedSourceContent } from "../normalization/types";

const options = { cardCount: "medium" as const, difficulty: "balanced" as const, cardStyle: "question-answer" as const };
const content: NormalizedSourceContent = { sourceId: "s", sourceType: "text", title: "Source", contentKind: "text", normalizationVersion: 1,
  metadata: {}, extraction: { status: "ready", adapter: "test" }, chunks: Array.from({ length: 3 }, (_, index) => ({ id: `c${index}`, index, text: `Text ${index}`, approxSize: 12000, provenance: {} })) };
const good = (input: ModelProviderInput) => ({ status: "ok" as const, raw: { title: "Deck", cards: input.context.chunks.map(c => ({ front: `Q ${c.id}`, back: `A ${c.id}`, sourceChunkIds: [c.id] })) } });

test("one request gets one identity; an explicitly retained retry identity stays unchanged", async () => {
  const seen: ModelProviderInput[] = [];
  const provider: ModelProvider = { id: "test", async generate(input) { seen.push(input); return good(input); } };
  const identity = { generationAttemptId: generateAttemptId(), requestId: generateProviderRequestId() };
  await generateStudyDeck(provider, { sourceTitle: "Source", normalizedContent: content, options, ...identity });
  await generateStudyDeck(provider, { sourceTitle: "Source", normalizedContent: content, options, ...identity });
  assert.equal(seen[0].request.requestId, identity.requestId); assert.equal(seen[1].request.requestId, identity.requestId);
  await generateStudyDeck(provider, { sourceTitle: "Source", normalizedContent: content, options });
  assert.notEqual(seen[2].request.requestId, identity.requestId); assert.notEqual(seen[2].request.generationAttemptId, identity.generationAttemptId);
});
test("multi-batch IDs are unique per batch, share one attempt, and change on full restart", async () => {
  const seen: ModelProviderInput[] = [];
  const provider: ModelProvider = { id: "test", async generate(input) { seen.push(input); return good(input); } };
  const plan = planGenerationBatches(content.chunks, { charBudget: 12000 }); assert.equal(plan.status, "ok"); if (plan.status !== "ok") return;
  const params = { provider, normalizedContent: content, sourceTitle: "Source", options, plan };
  await runMultiBatchGeneration(params); await runMultiBatchGeneration(params);
  assert.equal(seen.length, 6); assert.equal(new Set(seen.map(i => i.request.requestId)).size, 6);
  assert.equal(new Set(seen.slice(0, 3).map(i => i.request.generationAttemptId)).size, 1);
  assert.notEqual(seen[0].request.generationAttemptId, seen[3].request.generationAttemptId);
});
test("cancel/restart creates a fresh run and request identity without publishing a partial draft", async () => {
  const seen: ModelProviderInput[] = []; let canceled = false;
  const provider: ModelProvider = { id: "test", async generate(input) { seen.push(input); canceled = true; return good(input); } };
  const plan = planGenerationBatches(content.chunks, { charBudget: 12000 }); if (plan.status !== "ok") throw new Error("plan");
  const params = { provider, normalizedContent: content, sourceTitle: "Source", options, plan, isCanceled: () => canceled };
  assert.equal((await runMultiBatchGeneration(params)).status, "canceled"); canceled = false;
  assert.equal((await runMultiBatchGeneration(params)).status, "canceled");
  assert.notEqual(seen[0].request.requestId, seen[1].request.requestId); assert.notEqual(seen[0].request.generationAttemptId, seen[1].request.generationAttemptId);
});
test("safe backend categories never expose storage details; HTTP is not retried automatically", async () => {
  const previous = globalThis.fetch;
  const provider = createBackendProvider({ getAccessToken: async () => "token", getBaseUrl: () => "https://example.invalid" });
  const mock = createMockProvider(); let input!: ModelProviderInput;
  await generateStudyDeck({ id: "capture", async generate(value) { input = value; return mock.generate(value); } }, { sourceTitle: "Source", normalizedContent: content, options });
  try {
    for (const code of ["request-in-progress", "request-outcome-unknown", "idempotency-conflict", "idempotency-storage-failure"] as const) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: code, message: "PRIVATE DYNAMODB DETAIL" }), { status: 409 }); };
      const result = await provider.generate(input);
      assert.equal(result.status, "error"); if (result.status === "error") { assert.equal(result.error.code, code); assert.ok(!result.error.message.includes("PRIVATE")); }
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = previous; }
});
test("replay response is accepted normally and evaluation reports zero new provider executions", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const { context } = JSON.parse(init!.body as string);
    return new Response(JSON.stringify({ title: "Cached", cards: context.chunks.map((c: { id: string }) => ({ front: `Q ${c.id}`, back: "A", sourceChunkIds: [c.id] })) }),
      { status: 200, headers: { "x-interval-idempotency-replay": "true", "x-interval-provider-executions": "0" } });
  };
  try {
    const provider = createBackendProvider({ getAccessToken: async () => "token", getBaseUrl: () => "https://example.invalid" });
    const result = await generateStudyDeck(provider, { sourceTitle: "Source", normalizedContent: content, options });
    assert.equal(result.status, "ready"); if (result.status === "ready") { assert.equal(result.idempotencyReplay, true); assert.equal(result.providerExecutionCount, 0); }
    const evaluation = await runEvaluationCase({ provider, evalCase: { fixtureId: "txt-factual-rich", scope: "bounded", difficulty: "balanced", tier: "large" } });
    assert.equal(evaluation.providerExecutionCount, 0);
  } finally { globalThis.fetch = previous; }
});
test("new recovery copy resolves in all 13 locales", () => {
  for (const locale of SUPPORTED_LOCALES) for (const key of ["requestConflict", "requestProcessing", "requestUnknown", "requestStorage"] as const) {
    const copy = translate(locale, `generateDeck.error.${key}`); assert.ok(copy && !copy.includes("generateDeck.") && !copy.includes("{{"));
  }
});

test("a keyed network loss, gateway timeout or unreadable success is an ambiguous outcome, with no retry", async () => {
  const previous = globalThis.fetch;
  const backend = createBackendProvider({ getAccessToken: async () => "token", getBaseUrl: () => "https://example.invalid" });
  try {
    for (const mode of ["network", "gateway", "body"]) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; if (mode === "network") throw new Error("lost"); return new Response(mode === "body" ? "bad JSON" : "gateway timeout", { status: mode === "gateway" ? 504 : 200 }); };
      const result = await generateStudyDeck(backend, { sourceTitle: "Source", normalizedContent: content, options });
      assert.equal(result.status, "error"); if (result.status === "error") assert.equal(result.error.code, "request-outcome-unknown");
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = previous; }
});
test("secure native UUID source is used and missing all secure sources fails closed", () => {
  const crypto = Object.getOwnPropertyDescriptor(globalThis, "crypto"), expo = Object.getOwnPropertyDescriptor(globalThis, "expo");
  try {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
    Object.defineProperty(globalThis, "expo", { configurable: true, value: { uuidv4: () => "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" } });
    assert.equal(generateProviderRequestId(), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    Object.defineProperty(globalThis, "expo", { configurable: true, value: undefined });
    assert.throws(() => generateProviderRequestId(), /Secure request identity/);
  } finally {
    if (crypto) Object.defineProperty(globalThis, "crypto", crypto); else Reflect.deleteProperty(globalThis, "crypto");
    if (expo) Object.defineProperty(globalThis, "expo", expo); else Reflect.deleteProperty(globalThis, "expo");
  }
});
