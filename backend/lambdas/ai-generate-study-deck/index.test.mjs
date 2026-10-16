import { test } from "node:test";
import assert from "node:assert/strict";
import { handleGenerateStudyDeck, handler } from "./index.mjs";

// Loading this file requires "@aws-sdk/client-bedrock-runtime" to be resolvable (index.mjs
// constructs the real client at module scope — see its header comment) — but no test below ever
// makes a real call through it. The guard-clause tests exercise the real, unmodified code path
// (no BEDROCK_MODEL_ID set, which is the real, deterministic state of every CI/local environment
// in this repository today); every other provider-level test injects a fake client/command via
// `deps`, exactly as bedrockClient.test.mjs does for the pure adapter logic. No network access,
// no AWS credentials, and no live Bedrock call occurs anywhere in this file.

function makeEvent(body, sub = "user-123") {
  return {
    body: JSON.stringify(body),
    requestContext: sub ? { authorizer: { jwt: { claims: { sub } } } } : {},
  };
}

function baseRequest(overrides = {}) {
  return {
    sourceId: "src-1",
    sourceTitle: "Test Source",
    generationContractVersion: 1,
    requestedCardCount: 5,
    selectedChunkIds: ["a", "b"],
    options: { cardCount: "medium", difficulty: "balanced", cardStyle: "question-answer" },
    ...overrides,
  };
}

function baseContext(chunks) {
  const list = chunks ?? [
    { id: "a", text: "hello" },
    { id: "b", text: "world" },
  ];
  return {
    chunks: list,
    totalChars: list.reduce((sum, c) => sum + c.text.length, 0),
  };
}

function converseResponseWithText(text) {
  return { output: { message: { role: "assistant", content: [{ text }] } } };
}

class FakeCommand {
  constructor(params) {
    this.input = params;
  }
}

// The end-to-end tests below exercise callModelProvider's real body past its "not configured"
// guard clause, so they need BEDROCK_MODEL_ID set for the duration of one test only — restored
// (deleted) immediately after, via try/finally, so it can never leak into another test in this
// file (including the "not configured" test above, which explicitly depends on it being unset).
async function withModelId(fn) {
  process.env.BEDROCK_MODEL_ID = "test-model-id";
  try {
    await fn();
  } finally {
    delete process.env.BEDROCK_MODEL_ID;
  }
}

test("rejects an unauthenticated request", async () => {
  const res = await handler(makeEvent({ request: baseRequest(), context: baseContext() }, null));
  assert.equal(res.statusCode, 401);
});

test("rejects invalid JSON", async () => {
  const res = await handler({ body: "{not json", requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } } });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, "invalid-json");
});

// Regression test: a client understating totalChars must not bypass the context-size ceiling —
// the Lambda must recompute size from the actual chunk text, never trust the client-supplied
// totalChars field.
test("rejects a request whose real chunk text exceeds the size ceiling even when totalChars claims otherwise", async () => {
  const hugeText = "x".repeat(70_000);
  const body = {
    request: baseRequest({ selectedChunkIds: ["a"] }),
    context: { chunks: [{ id: "a", text: hugeText }], totalChars: 0 },
  };
  const res = await handler(makeEvent(body));
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, "context-too-large");
});

// Regression test: request.selectedChunkIds must match the actual context.chunks ids — a client
// must not be able to claim it selected different chunks than the ones actually sent as context.
test("rejects a request whose selectedChunkIds do not match the actual context chunk ids", async () => {
  const body = {
    request: baseRequest({ selectedChunkIds: ["a", "does-not-exist"] }),
    context: baseContext(),
  };
  const res = await handler(makeEvent(body));
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, "malformed-request");
});

test("accepts a well-formed request but returns provider-unavailable when BEDROCK_MODEL_ID is not configured", async () => {
  // Real, deterministic behavior of the guard clause in callModelProvider — not a stub return
  // value. No CI/local environment in this repository sets BEDROCK_MODEL_ID (that's a Phase B
  // CDK environment variable, not configured anywhere in this batch), so this is the actual
  // production behavior today, not a test-only simulation, and makes zero network attempt.
  assert.equal(process.env.BEDROCK_MODEL_ID, undefined);
  const res = await handler(makeEvent({ request: baseRequest(), context: baseContext() }));
  assert.equal(res.statusCode, 502);
  assert.equal(JSON.parse(res.body).error, "provider-unavailable");
});

test("end-to-end: a well-formed Bedrock response (injected fake client) produces a 200 with validated cards", async () => {
  await withModelId(async () => {
    const fakeClient = {
      send: async () =>
        converseResponseWithText(
          JSON.stringify({ title: "Biology Basics", cards: [{ front: "What is ATP?", back: "Energy currency of the cell.", sourceChunkIds: ["a"] }] })
        ),
    };
    const res = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), { client: fakeClient, CommandCtor: FakeCommand });
    assert.equal(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.equal(json.title, "Biology Basics");
    assert.equal(json.cards.length, 1);
    assert.equal(json.generation.generationContractVersion, 1);
  });
});

test("end-to-end: malformed (non-JSON) model output maps to a 502 malformed-model-output, bypassing response validation", async () => {
  await withModelId(async () => {
    const fakeClient = { send: async () => converseResponseWithText("not json at all") };
    const res = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), { client: fakeClient, CommandCtor: FakeCommand });
    assert.equal(res.statusCode, 502);
    assert.equal(JSON.parse(res.body).error, "malformed-model-output");
  });
});

test("end-to-end: well-formed JSON with an invalid schema still passes through the EXISTING response validation and is rejected as 422", async () => {
  await withModelId(async () => {
    const fakeClient = { send: async () => converseResponseWithText(JSON.stringify({ nope: true })) };
    const res = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), { client: fakeClient, CommandCtor: FakeCommand });
    assert.equal(res.statusCode, 422);
    assert.equal(JSON.parse(res.body).error, "validation-failed");
    assert.equal(JSON.parse(res.body).deckIssues[0].code, "malformed-response");
  });
});

test("end-to-end: a card citing an unknown chunk id is still rejected by the existing provenance check", async () => {
  await withModelId(async () => {
    const fakeClient = {
      send: async () =>
        converseResponseWithText(
          JSON.stringify({ title: "Deck", cards: [{ front: "Q", back: "A", sourceChunkIds: ["not-a-real-chunk-id"] }] })
        ),
    };
    const res = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), { client: fakeClient, CommandCtor: FakeCommand });
    assert.equal(res.statusCode, 422);
    const json = JSON.parse(res.body);
    assert.equal(json.error, "validation-failed");
    assert.equal(json.deckIssues[0].code, "no-valid-cards");
    assert.equal(json.cardIssues[0].code, "unknown-chunk-id");
  });
});

test("end-to-end: a thrown ThrottlingException maps to a 502 rate-limited, never leaking the raw exception", async () => {
  await withModelId(async () => {
    const fakeClient = {
      send: async () => {
        const error = new Error("some AWS-internal throttling detail");
        error.name = "ThrottlingException";
        throw error;
      },
    };
    const res = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), { client: fakeClient, CommandCtor: FakeCommand });
    assert.equal(res.statusCode, 502);
    const json = JSON.parse(res.body);
    assert.equal(json.error, "rate-limited");
    assert.doesNotMatch(json.message, /AWS-internal/);
  });
});

test("end-to-end: a client call that never resolves is aborted by the bounded timeout and maps to a 502 generation-timeout", async () => {
  await withModelId(async () => {
    const fakeClient = {
      send: (_command, options) =>
        new Promise((_resolve, reject) => {
          options.abortSignal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    };
    const res = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), {
      client: fakeClient,
      CommandCtor: FakeCommand,
      timeoutMs: 10,
    });
    assert.equal(res.statusCode, 502);
    assert.equal(JSON.parse(res.body).error, "generation-timeout");
  });
});

test("end-to-end: an unrecognized provider failure maps safely to a 502 provider-unavailable, never leaking the raw exception", async () => {
  await withModelId(async () => {
    const fakeClient = {
      send: async () => {
        throw new Error("some internal AWS detail that must never reach the client");
      },
    };
    const res = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), { client: fakeClient, CommandCtor: FakeCommand });
    assert.equal(res.statusCode, 502);
    const json = JSON.parse(res.body);
    assert.equal(json.error, "provider-unavailable");
    assert.doesNotMatch(json.message, /internal AWS detail/);
  });
});
