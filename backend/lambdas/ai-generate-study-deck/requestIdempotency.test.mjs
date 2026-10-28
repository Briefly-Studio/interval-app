import "../../../scripts/ai-test-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { handleGenerateStudyDeck } from "./index.mjs";
import { requestFingerprint, resolveIdempotencyMode, IDEMPOTENCY } from "./requestIdempotency.mjs";
import { FakeDocumentClient } from "./testing/idempotencyFake.mjs";

function payload(requestId = randomUUID()) {
  return { request: { requestId, generationAttemptId: randomUUID(), sourceId: "source", sourceTitle: "PRIVATE TITLE", normalizationVersion: 1,
    generationContractVersion: 1, requestedCardCount: 5, targetMinimumCardCount: 3, selectedChunkIds: ["a"],
    options: { cardCount: "small", difficulty: "balanced", cardStyle: "question-answer" } },
    context: { chunks: [{ id: "a", text: "PRIVATE SOURCE TEXT" }] } };
}
const event = (body, sub = "user") => ({ body: JSON.stringify(body), requestContext: { authorizer: { jwt: { claims: { sub } } } } });
function setup(overrides = {}) {
  let executions = 0;
  const db = new FakeDocumentClient();
  const deps = { dynamoClient: db, rateLimitTableName: "rate", idempotencyTableName: "idem", idempotencyMode: "required", now: new Date("2026-10-26T12:00:00Z"),
    provider: async () => { executions++; return { status: "ok", raw: { title: `Deck ${executions}`, cards: [{ front: "PRIVATE CARD", back: "Answer", sourceChunkIds: ["a"] }] }, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }; }, ...overrides };
  return { db, deps, executions: () => executions, send: (body, sub) => handleGenerateStudyDeck(event(body, sub), deps) };
}
const code = result => JSON.parse(result.body).error;

test("first execution claims, marks quota once and persists exact response before success; retries replay", async () => {
  const s = setup(), body = payload();
  const first = await s.send(body), second = await s.send(body);
  assert.equal(first.statusCode, 200); assert.equal(second.statusCode, 200); assert.equal(second.body, first.body);
  assert.equal(s.executions(), 1); assert.equal(s.db.count(), 1);
  assert.equal(second.headers["x-interval-provider-executions"], "0"); assert.equal(first.headers["x-interval-provider-executions"], "1");
  const record = s.db.get("idem", { PK: "U#user", SK: `R#${body.request.requestId}` });
  assert.equal(record.status, "succeeded"); assert.equal(record.responseBody, first.body); assert.equal(record.quotaCharged, true);
  assert.equal(record.ttl, Math.floor(s.deps.now.getTime() / 1000) + IDEMPOTENCY.retentionSeconds);
  assert.equal(record.ttl, record.expiresAt); assert.equal(record.leaseExpiresAt, record.createdAt + 60);
  assert.ok(!JSON.stringify(record).includes("PRIVATE SOURCE TEXT")); assert.ok(!JSON.stringify(record).includes("PRIVATE TITLE"));
});
test("simultaneous same-key requests have one winner; in-progress precedes generic concurrency", async () => {
  let release, started;
  const gate = new Promise(r => { release = r; }), began = new Promise(r => { started = r; });
  let calls = 0;
  const s = setup({ provider: async () => { calls++; started(); await gate; return { status: "ok", raw: { title: "Deck", cards: [{ front: "Q", back: "A", sourceChunkIds: ["a"] }] } }; } });
  const body = payload(), pending = s.send(body); await began;
  const duplicates = await Promise.all(Array.from({ length: 10 }, () => s.send(body)));
  assert.ok(duplicates.every(r => code(r) === "request-in-progress")); assert.equal(calls, 1); assert.equal(s.db.count(), 1);
  const other = await s.send(payload()); assert.equal(code(other), "generation-in-progress"); assert.equal(s.db.count(), 1);
  release(); assert.equal((await pending).statusCode, 200);
});
test("same ID with changed source, options, language or model conflicts without quota", async () => {
  const s = setup(), body = payload(); await s.send(body);
  for (const change of [b => { b.context.chunks[0].text = "altered"; }, b => { b.request.options.difficulty = "advanced"; }, b => { b.request.language = "es"; }, b => { b.request.requestedCardCount = 6; }]) {
    const other = structuredClone(body); change(other); assert.equal(code(await s.send(other)), "idempotency-conflict");
  }
  assert.equal(s.executions(), 1); assert.equal(s.db.count(), 1);
  assert.notEqual(requestFingerprint(body.request, body.context, "model1"), requestFingerprint(body.request, body.context, "model2"));
});
test("canonical object key ordering is stable; ordered chunk content still matters", () => {
  const body = payload(), reversed = Object.fromEntries(Object.entries(body.request).reverse());
  reversed.options = Object.fromEntries(Object.entries(body.request.options).reverse());
  assert.equal(requestFingerprint(body.request, body.context, "m"), requestFingerprint(reversed, body.context, "m"));
  assert.equal(requestFingerprint(body.request, body.context, "m"), requestFingerprint({ ...body.request, requestId: randomUUID(), generationAttemptId: randomUUID() }, body.context, "m"));
  assert.notEqual(requestFingerprint(body.request, { chunks: [{ id: "a", text: "A" }, { id: "b", text: "B" }] }, "m"), requestFingerprint(body.request, { chunks: [{ id: "b", text: "B" }, { id: "a", text: "A" }] }, "m"));
});
test("authenticated sub isolates same request ID; spoofed account fields never pick partition", async () => {
  const s = setup(), body = payload();
  const a = await s.send(body, "alice"), b = await s.send(body, "bob");
  assert.notEqual(a.body, b.body); assert.equal(s.executions(), 2); assert.equal(s.db.count("alice"), 1); assert.equal(s.db.count("bob"), 1);
  assert.equal((await s.send(body, "alice")).body, a.body);
  const spoof = payload(); spoof.request.accountId = "alice";
  assert.equal((await s.send(spoof, "bob")).statusCode, 200);
  assert.equal(s.db.count("alice"), 1);
});
test("invalid IDs and unauthorized/malformed input create no records or quota", async () => {
  const s = setup();
  for (const id of [undefined, "", "x".repeat(1000), "U#other\nR#attack", 7, "not-a-uuid"]) {
    const body = payload(); body.request.requestId = id; assert.equal((await s.send(body)).statusCode, 400);
  }
  assert.equal((await handleGenerateStudyDeck({ body: JSON.stringify(payload()) }, s.deps)).statusCode, 401);
  assert.equal((await s.send({ request: {}, context: {} })).statusCode, 400);
  assert.equal(s.db.items.size, 0); assert.equal(s.executions(), 0);
});
test("quota sequence A/replay A/B/in-progress B/conflict charges exactly two", async () => {
  const s = setup(), a = payload(); await s.send(a); assert.equal(s.db.count(), 1);
  await s.send(a); assert.equal(s.db.count(), 1);
  let release, started; const gate = new Promise(r => { release = r; }), began = new Promise(r => { started = r; });
  const original = s.deps.provider;
  s.deps.provider = async (...args) => { started(); await gate; return original(...args); };
  const b = payload(), pending = s.send(b); await began;
  assert.equal(s.db.count(), 2); assert.equal(code(await s.send(b)), "request-in-progress");
  const altered = structuredClone(b); altered.request.options.difficulty = "basic";
  assert.equal(code(await s.send(altered)), "idempotency-conflict"); assert.equal(s.db.count(), 2);
  release(); await pending; assert.equal(s.executions(), 2);
});
test("daily rejection releases pre-provider claim; no extra charge and safe same-key retry after reset", async () => {
  const s = setup(), body = payload();
  s.db.put("rate", { PK: "U#user", SK: "QUOTA#2026-10-26", count: 20 });
  assert.equal(code(await s.send(body)), "daily-limit-reached"); assert.equal(s.executions(), 0); assert.equal(s.db.count(), 20);
  assert.equal(s.db.get("idem", { PK: "U#user", SK: `R#${body.request.requestId}` }), undefined);
  s.deps.now = new Date("2026-10-27T12:00:00Z"); assert.equal((await s.send(body)).statusCode, 200); assert.equal(s.db.count("user", "2026-10-27"), 1);
});
test("expired pre-provider and provider-started claims are conservative unknown, never reclaimed", async () => {
  for (const state of ["claimed", "provider_started"]) {
    const s = setup(), body = payload(), epoch = Math.floor(s.deps.now.getTime() / 1000);
    s.db.put("idem", { PK: "U#user", SK: `R#${body.request.requestId}`, status: state, fingerprint: requestFingerprint(body.request, body.context, process.env.BEDROCK_MODEL_ID ?? "unconfigured"), leaseExpiresAt: epoch - 1, expiresAt: epoch + 1000 });
    assert.equal(code(await s.send(body)), "request-outcome-unknown"); assert.equal(s.executions(), 0); assert.equal(s.db.count(), 0);
  }
});
test("response finalization failure after provider remains ambiguous; same key never executes again", async () => {
  const s = setup(), body = payload(); s.db.failFinalize = true;
  assert.equal(code(await s.send(body)), "request-outcome-unknown"); assert.equal(s.executions(), 1); assert.equal(s.db.count(), 1);
  s.db.failFinalize = false; s.deps.now = new Date(s.deps.now.getTime() + 61000);
  assert.equal(code(await s.send(body)), "request-outcome-unknown"); assert.equal(s.executions(), 1);
});
test("lost success-persistence acknowledgement replays committed authoritative result", async () => {
  const s = setup(), body = payload(); s.db.finalizationCommittedButLost = true;
  assert.equal(code(await s.send(body)), "request-outcome-unknown");
  assert.equal((await s.send(body)).statusCode, 200); assert.equal(s.executions(), 1); assert.equal(s.db.count(), 1);
});
test("admission transaction ambiguous after commit never double-charges or invokes blindly", async () => {
  const s = setup(), body = payload(); s.db.transactionCommittedButLost = true;
  assert.equal(code(await s.send(body)), "request-outcome-unknown"); assert.equal(s.executions(), 0); assert.equal(s.db.count(), 1);
  s.deps.now = new Date(s.deps.now.getTime() + 61000);
  assert.equal(code(await s.send(body)), "request-outcome-unknown"); assert.equal(s.db.count(), 1);
});
test("claim/read storage errors fail closed without provider or quota", async () => {
  const s = setup(), body = payload(); s.db.failClaim = true;
  assert.equal(code(await s.send(body)), "idempotency-storage-failure"); assert.equal(s.db.count(), 0);
  s.db.failClaim = false; await s.send(body); s.db.failRead = true;
  assert.equal(code(await s.send(body)), "idempotency-storage-failure"); assert.equal(s.executions(), 1);
});
test("provider timeout and thrown network outcomes cannot trigger same-key re-execution", async () => {
  for (const provider of [async () => ({ status: "error", code: "generation-timeout" }), async () => { throw new Error("PRIVATE NETWORK ERROR"); }]) {
    let calls = 0; const s = setup({ provider: async () => { calls++; return provider(); } }), body = payload();
    assert.equal(code(await s.send(body)), "request-outcome-unknown");
    await s.send(body); assert.equal(calls, 1); assert.equal(s.db.count(), 1);
  }
});
test("definitive validation/provider failures replay without new execution or quota", async () => {
  for (const outcome of [{ status: "ok", raw: { title: "Bad", cards: [] } }, { status: "error", code: "rate-limited", message: "Try later" }]) {
    let calls = 0; const s = setup({ provider: async () => { calls++; return outcome; } }), body = payload();
    const first = await s.send(body), second = await s.send(body);
    assert.equal(first.body, second.body); assert.ok(first.statusCode >= 400); assert.equal(calls, 1); assert.equal(s.db.count(), 1);
  }
});
test("oversized authoritative response is never truncated or returned as replay-safe", async () => {
  const s = setup(), body = payload();
  const hugeId = "a".repeat(IDEMPOTENCY.maxResponseBytes + 1);
  body.request.selectedChunkIds = [hugeId]; body.context.chunks[0].id = hugeId;
  s.deps.provider = async () => ({ status: "ok", raw: { title: "Deck", cards: [{ front: "Q", back: "A", sourceChunkIds: [hugeId] }] } });
  assert.equal(code(await s.send(body)), "request-outcome-unknown"); assert.equal(s.db.count(), 1);
  const record = s.db.get("idem", { PK: "U#user", SK: `R#${body.request.requestId}` });
  assert.equal(record.responseBody, undefined); assert.equal(record.status, "provider_started");
});

test("logs contain safe categories/counts, never cached result, source/title or errors", async () => {
  const original = console.log, logs = []; console.log = (...args) => logs.push(args);
  try { const s = setup(), body = payload(); await s.send(body); await s.send(body); }
  finally { console.log = original; }
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|access.token|Authorization|responseBody/);
});
test("expiry refuses old cached content even before asynchronous TTL deletion", async () => {
  const s = setup(), body = payload(); await s.send(body);
  s.deps.now = new Date(s.deps.now.getTime() + 86401000);
  assert.equal(code(await s.send(body)), "request-outcome-unknown"); assert.equal(s.executions(), 1);
});
test("compatibility modes preserve old clients, require keys only when selected, fail closed on typo", async () => {
  assert.equal(resolveIdempotencyMode(undefined), "legacy"); assert.equal(resolveIdempotencyMode("typo"), "required");
  const s = setup({ idempotencyMode: "optional" }), body = payload(); delete body.request.requestId;
  assert.equal((await s.send(body)).statusCode, 200);
  s.deps.idempotencyMode = "required"; assert.equal((await s.send(body)).statusCode, 400);
  s.deps.idempotencyMode = "legacy"; assert.equal((await s.send(body)).statusCode, 200);
});

test("flagship A/B response lost/B replay/C: four HTTP attempts, three provider executions and quota", async () => {
  const { runMultiBatchGeneration } = await import("../../../src/domain/ai/multiBatchGeneration.ts");
  const { createBackendProvider } = await import("../../../src/domain/ai/backendProvider.ts");
  const s = setup(); let modelCalls = 0, attempts = 0, lost = false;
  const requestIds = [], attemptIds = [];
  s.deps.provider = async (request, context) => {
    modelCalls++;
    return { status: "ok", raw: { title: "Combined", cards: context.chunks.map(c => ({ front: `Q ${c.id}`, back: `A ${c.id}`, sourceChunkIds: [c.id] })) }, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
  };
  const previous = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body); attempts++; requestIds.push(body.request.requestId); attemptIds.push(body.request.generationAttemptId);
    const result = await s.send(body);
    if (attempts === 2 && !lost) { lost = true; throw new Error("HTTP response lost after success"); }
    return new Response(result.body, { status: result.statusCode, headers: result.headers });
  };
  try {
    const backend = createBackendProvider({ getAccessToken: async () => "test-token", getBaseUrl: () => "https://example.invalid" });
    // Explicit test-only transport retry of the SAME prepared input. Production adds no loop.
    const provider = { id: backend.id, async generate(input) {
      let outcome = await backend.generate(input);
      if (outcome.status === "error" && lost && attempts === 2) outcome = await backend.generate(input);
      return outcome;
    } };
    const chunks = Array.from({ length: 3 }, (_, index) => ({ id: `c${index}`, index, text: `Text ${index}`, approxSize: 6, provenance: {} }));
    const content = { sourceId: "s", sourceType: "text", title: "Source", contentKind: "text", chunks, metadata: {}, normalizationVersion: 1, extraction: { status: "ready", adapter: "test" } };
    const plan = { status: "ok", totalCandidateChunks: 3, batches: chunks.map((c, index) => ({ index, chunkIds: [c.id], totalChars: c.approxSize })) };
    const result = await runMultiBatchGeneration({ provider, normalizedContent: content, sourceTitle: "Source", options: { cardCount: "medium", difficulty: "balanced", cardStyle: "question-answer" }, plan });
    assert.equal(result.status, "ready"); assert.equal(modelCalls, 3); assert.equal(s.db.count(), 3); assert.equal(attempts, 4);
    assert.equal(new Set(requestIds).size, 3); assert.equal(requestIds[1], requestIds[2]); assert.equal(new Set(attemptIds).size, 1);
    assert.deepEqual(result.draft.cards.map(c => c.sourceChunkIds), [["c0"], ["c1"], ["c2"]]);
    assert.equal(result.draft.generation.fullSourceIncluded, true); assert.equal(result.draft.generation.requestedCardCount, 15);
    assert.equal(result.draft.generation.generationStatus, "insufficient-distinct-content");
  } finally { globalThis.fetch = previous; }
});

test("an unconfigured provider or missing idempotency store cannot consume quota", async () => {
  const s = setup({ idempotencyTableName: "" });
  assert.equal(code(await s.send(payload())), "idempotency-storage-failure"); assert.equal(s.db.count(), 0);
  const previous = process.env.BEDROCK_MODEL_ID; delete process.env.BEDROCK_MODEL_ID;
  try {
    const unconfigured = setup({ provider: undefined });
    assert.equal(code(await unconfigured.send(payload())), "provider-unavailable"); assert.equal(unconfigured.db.count(), 0);
    assert.ok(![...unconfigured.db.items.values()].some(i => i.status === "claimed"));
  } finally { if (previous === undefined) delete process.env.BEDROCK_MODEL_ID; else process.env.BEDROCK_MODEL_ID = previous; }
});
test("success finalization is fenced by owner; stale owner cannot publish authoritative success", async () => {
  const s = setup(), body = payload();
  s.deps.provider = async () => {
    const key = { PK: "U#user", SK: `R#${body.request.requestId}` };
    s.db.put("idem", { ...s.db.get("idem", key), owner: "different-owner" });
    return { status: "ok", raw: { title: "Deck", cards: [{ front: "Q", back: "A", sourceChunkIds: ["a"] }] } };
  };
  assert.equal(code(await s.send(body)), "request-outcome-unknown"); assert.equal(s.db.count(), 1);
  assert.equal(s.db.get("idem", { PK: "U#user", SK: `R#${body.request.requestId}` }).responseBody, undefined);
});

test("successful replay is free at daily cap and across UTC reset within retention", async () => {
  const s = setup(), body = payload(), first = await s.send(body);
  s.db.put("rate", { PK: "U#user", SK: "QUOTA#2026-10-26", count: 20 });
  assert.equal((await s.send(body)).body, first.body); assert.equal(s.db.count(), 20);
  s.deps.now = new Date("2026-10-27T00:01:00Z");
  assert.equal((await s.send(body)).body, first.body); assert.equal(s.db.count("user", "2026-10-27"), 0); assert.equal(s.executions(), 1);
});

test("ambiguous real SDK transport failure stays unknown for the same key, with one quota and wire attempt", async () => {
  const { ConverseCommand } = await import("@aws-sdk/client-bedrock-runtime");
  const { createBedrockRuntimeClient } = await import("./index.mjs");
  const { runGeneration } = await import("./bedrockClient.mjs");
  let attempts = 0;
  const client = createBedrockRuntimeClient({ region: "us-east-2", credentials: { accessKeyId: "test", secretAccessKey: "test" },
    requestHandler: { async handle() { attempts++; throw Object.assign(new Error("Simulated response loss"), { code: "ECONNRESET" }); }, destroy() {} } });
  const s = setup({ provider: (request, context) => runGeneration(client, ConverseCommand, "test-model", request, context, 2000) });
  try {
    const body = payload();
    assert.equal(code(await s.send(body)), "request-outcome-unknown");
    assert.equal(code(await s.send(body)), "request-outcome-unknown");
    assert.equal(attempts, 1); assert.equal(s.db.count(), 1);
  } finally { client.destroy(); }
});
