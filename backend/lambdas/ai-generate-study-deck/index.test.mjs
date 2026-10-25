import { test } from "node:test";
import assert from "node:assert/strict";
import { handleGenerateStudyDeck, handler } from "./index.mjs";

// Loading this file requires "@aws-sdk/client-bedrock-runtime" and "@aws-sdk/client-dynamodb" /
// "@aws-sdk/lib-dynamodb" to be resolvable (index.mjs constructs the real clients at module scope
// — see its header comment) — but no test below ever makes a real call through either. The
// guard-clause tests exercise the real, unmodified code path (no BEDROCK_MODEL_ID set, which is
// the real, deterministic state of every CI/local environment in this repository today); every
// other provider-level test injects a fake Bedrock client/command AND a fake rate-limit
// client/table via `deps`, exactly as bedrockClient.test.mjs does for the pure adapter logic and
// rateLimiter.test.mjs does for the pure limiter logic. No network access, no AWS credentials,
// and no live Bedrock or DynamoDB call occurs anywhere in this file.

// Minimal in-memory fake DynamoDB — same exact semantics as rateLimiter.test.mjs's own fake
// (duplicated here deliberately, not imported — "no shared module between Lambdas" extends to
// each Lambda's own test helpers staying self-contained, same as this file's existing FakeCommand/
// makeEvent/baseRequest not being imported from bedrockClient.test.mjs either).
class FakeDdbClient {
  constructor() {
    this.items = new Map();
  }
  key(k) {
    return `${k.PK}|${k.SK}`;
  }
  conditionalCheckFailed() {
    const err = new Error("The conditional request failed");
    err.name = "ConditionalCheckFailedException";
    return err;
  }
  async send(command) {
    const { kind, input } = command;
    if (kind === "update") {
      const k = this.key(input.Key);
      const existing = this.items.get(k);
      const count = existing?.count ?? 0;
      const limit = input.ExpressionAttributeValues[":limit"];
      if (count >= limit) throw this.conditionalCheckFailed();
      this.items.set(k, { ...input.Key, count: count + 1, ttl: existing?.ttl ?? input.ExpressionAttributeValues[":ttl"] });
      return {};
    }
    if (kind === "put") {
      const k = this.key(input.Item);
      const existing = this.items.get(k);
      const now = input.ExpressionAttributeValues[":now"];
      if (existing && !(now > existing.expiresAt)) throw this.conditionalCheckFailed();
      this.items.set(k, input.Item);
      return {};
    }
    if (kind === "delete") {
      const k = this.key(input.Key);
      const existing = this.items.get(k);
      const token = input.ExpressionAttributeValues[":token"];
      if (!existing || existing.leaseToken !== token) throw this.conditionalCheckFailed();
      this.items.delete(k);
      return {};
    }
    throw new Error(`unrecognized fake command kind: ${kind}`);
  }
}

class FakeUpdateCommand {
  constructor(input) {
    this.kind = "update";
    this.input = input;
  }
}
class FakePutCommand {
  constructor(input) {
    this.kind = "put";
    this.input = input;
  }
}
class FakeDeleteCommand {
  constructor(input) {
    this.kind = "delete";
    this.input = input;
  }
}

// A fresh fake rate-limit store per call — tests that need to observe quota/lease behavior across
// multiple requests for the SAME (simulated) user pass the SAME object explicitly instead.
function rateLimitDeps(overrides = {}) {
  return {
    dynamoClient: new FakeDdbClient(),
    rateLimitTableName: "fake-ai-rate-limits",
    PutCommandCtor: FakePutCommand,
    UpdateCommandCtor: FakeUpdateCommand,
    DeleteCommandCtor: FakeDeleteCommand,
    now: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

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
  const res = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), rateLimitDeps());
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
    const res = await handleGenerateStudyDeck(
      makeEvent({ request: baseRequest(), context: baseContext() }),
      { client: fakeClient, CommandCtor: FakeCommand, ...rateLimitDeps() }
    );
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
    const res = await handleGenerateStudyDeck(
      makeEvent({ request: baseRequest(), context: baseContext() }),
      { client: fakeClient, CommandCtor: FakeCommand, ...rateLimitDeps() }
    );
    assert.equal(res.statusCode, 502);
    assert.equal(JSON.parse(res.body).error, "malformed-model-output");
  });
});

test("end-to-end: well-formed JSON with an invalid schema still passes through the EXISTING response validation and is rejected as 422", async () => {
  await withModelId(async () => {
    const fakeClient = { send: async () => converseResponseWithText(JSON.stringify({ nope: true })) };
    const res = await handleGenerateStudyDeck(
      makeEvent({ request: baseRequest(), context: baseContext() }),
      { client: fakeClient, CommandCtor: FakeCommand, ...rateLimitDeps() }
    );
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
    const res = await handleGenerateStudyDeck(
      makeEvent({ request: baseRequest(), context: baseContext() }),
      { client: fakeClient, CommandCtor: FakeCommand, ...rateLimitDeps() }
    );
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
    const res = await handleGenerateStudyDeck(
      makeEvent({ request: baseRequest(), context: baseContext() }),
      { client: fakeClient, CommandCtor: FakeCommand, ...rateLimitDeps() }
    );
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
      ...rateLimitDeps(),
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
    const res = await handleGenerateStudyDeck(
      makeEvent({ request: baseRequest(), context: baseContext() }),
      { client: fakeClient, CommandCtor: FakeCommand, ...rateLimitDeps() }
    );
    assert.equal(res.statusCode, 502);
    const json = JSON.parse(res.body);
    assert.equal(json.error, "provider-unavailable");
    assert.doesNotMatch(json.message, /internal AWS detail/);
  });
});

// ---- Rate limiting / concurrency / metering integration (handler-level) ----
// rateLimiter.test.mjs covers the pure limiter logic exhaustively; these tests cover the
// HANDLER's wiring of it — error-code mapping, charging point, and lease release timing.

function successClient(title = "Deck") {
  return {
    send: async () =>
      converseResponseWithText(JSON.stringify({ title, cards: [{ front: "Q", back: "A", sourceChunkIds: ["a"] }] })),
  };
}

function throttleClient() {
  return {
    send: async () => {
      const error = new Error("throttled");
      error.name = "ThrottlingException";
      throw error;
    },
  };
}

test("rate limit: the 21st request in one UTC day is rejected with daily-limit-reached, never reaching the provider", async () => {
  await withModelId(async () => {
    const shared = rateLimitDeps();
    for (let i = 0; i < 20; i++) {
      const res = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), {
        client: successClient(),
        CommandCtor: FakeCommand,
        ...shared,
      });
      assert.equal(res.statusCode, 200, `request ${i + 1} should succeed`);
    }

    let providerCalled = false;
    const trackingClient = { send: async () => ((providerCalled = true), successClient().send()) };
    const res = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), {
      client: trackingClient,
      CommandCtor: FakeCommand,
      ...shared,
    });
    assert.equal(res.statusCode, 429);
    assert.equal(JSON.parse(res.body).error, "daily-limit-reached");
    assert.equal(providerCalled, false, "the 21st request must be rejected before ever calling the provider");
  });
});

test("rate limit: a request on the next UTC day is allowed again after the daily limit was reached", async () => {
  await withModelId(async () => {
    const day1 = rateLimitDeps({ now: new Date("2026-01-01T23:00:00.000Z") });
    for (let i = 0; i < 20; i++) {
      await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), {
        client: successClient(),
        CommandCtor: FakeCommand,
        ...day1,
      });
    }
    const denied = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), {
      client: successClient(),
      CommandCtor: FakeCommand,
      ...day1,
    });
    assert.equal(JSON.parse(denied.body).error, "daily-limit-reached");

    // Same dynamoClient (same user's stored state), new UTC day.
    const day2 = { ...day1, now: new Date("2026-01-02T00:00:00.000Z") };
    const res = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), {
      client: successClient(),
      CommandCtor: FakeCommand,
      ...day2,
    });
    assert.equal(res.statusCode, 200);
  });
});

test("rate limit: a second simultaneous request for the same user is rejected with generation-in-progress", async () => {
  await withModelId(async () => {
    const shared = rateLimitDeps();
    // A client whose send() never resolves on its own — simulates request A still being
    // in-flight when request B arrives (A's own lease is still held).
    let releaseA;
    const neverResolvingClient = { send: () => new Promise((resolve) => { releaseA = resolve; }) };

    const pendingA = handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), {
      client: neverResolvingClient,
      CommandCtor: FakeCommand,
      ...shared,
    });

    // Give A's handler a tick to acquire its lease before B is sent.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const resB = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), {
      client: successClient(),
      CommandCtor: FakeCommand,
      ...shared,
    });
    assert.equal(resB.statusCode, 429);
    assert.equal(JSON.parse(resB.body).error, "generation-in-progress");

    // Let A finish so it doesn't leak into another test.
    releaseA(converseResponseWithText(JSON.stringify({ title: "A", cards: [] })));
    await pendingA;
  });
});

test("rate limit: the concurrency slot is freed immediately after a successful generation", async () => {
  await withModelId(async () => {
    const shared = rateLimitDeps();
    const first = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), {
      client: successClient(),
      CommandCtor: FakeCommand,
      ...shared,
    });
    assert.equal(first.statusCode, 200);

    const second = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), {
      client: successClient(),
      CommandCtor: FakeCommand,
      ...shared,
    });
    assert.equal(second.statusCode, 200, "the slot must be free again immediately after the first request completed");
  });
});

test("rate limit: the concurrency slot is freed immediately after a HANDLED provider failure (not held for the full lease TTL)", async () => {
  await withModelId(async () => {
    const shared = rateLimitDeps();
    const first = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), {
      client: throttleClient(),
      CommandCtor: FakeCommand,
      ...shared,
    });
    assert.equal(first.statusCode, 502);

    const second = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), {
      client: successClient(),
      CommandCtor: FakeCommand,
      ...shared,
    });
    assert.equal(second.statusCode, 200, "the slot must be free again immediately after the failed attempt completed");
  });
});

test("rate limit: a provider failure still consumes a daily quota unit (charged at attempt time, not at success time)", async () => {
  await withModelId(async () => {
    const shared = rateLimitDeps();
    for (let i = 0; i < 20; i++) {
      const res = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), {
        client: throttleClient(),
        CommandCtor: FakeCommand,
        ...shared,
      });
      assert.equal(res.statusCode, 502, `attempt ${i + 1} should fail at the provider, not the limiter`);
    }
    const denied = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), {
      client: successClient(),
      CommandCtor: FakeCommand,
      ...shared,
    });
    assert.equal(JSON.parse(denied.body).error, "daily-limit-reached", "20 provider failures must still have consumed the full daily quota");
  });
});

test("rate limit: an unauthenticated request never reaches, and never consumes, the rate limiter", async () => {
  const shared = rateLimitDeps();
  for (let i = 0; i < 25; i++) {
    const res = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }, null), { ...shared, client: successClient(), CommandCtor: FakeCommand });
    assert.equal(res.statusCode, 401);
  }
  // The quota was never touched — a real, authenticated request right after must still succeed.
  await withModelId(async () => {
    const res = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), {
      client: successClient(),
      CommandCtor: FakeCommand,
      ...shared,
    });
    assert.equal(res.statusCode, 200);
  });
});

test("rate limit: a malformed request never reaches, and never consumes, the rate limiter", async () => {
  const shared = rateLimitDeps();
  for (let i = 0; i < 25; i++) {
    const res = await handleGenerateStudyDeck(
      makeEvent({ request: baseRequest({ selectedChunkIds: ["a", "does-not-exist"] }), context: baseContext() }),
      { ...shared, client: successClient(), CommandCtor: FakeCommand }
    );
    assert.equal(res.statusCode, 400);
  }
  await withModelId(async () => {
    const res = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), {
      client: successClient(),
      CommandCtor: FakeCommand,
      ...shared,
    });
    assert.equal(res.statusCode, 200);
  });
});

test("rate limit: fails CLOSED (never allows) when the rate-limit table isn't configured, and never calls the provider", async () => {
  await withModelId(async () => {
    let providerCalled = false;
    const trackingClient = { send: async () => ((providerCalled = true), successClient().send()) };
    const res = await handleGenerateStudyDeck(makeEvent({ request: baseRequest(), context: baseContext() }), {
      client: trackingClient,
      CommandCtor: FakeCommand,
      // Deliberately no rateLimitDeps() override and no AI_RATE_LIMIT_TABLE env var — the real,
      // deterministic "not configured" state.
    });
    assert.equal(res.statusCode, 503);
    assert.equal(JSON.parse(res.body).error, "provider-unavailable");
    assert.equal(providerCalled, false, "a limiter that can't determine state must never fail open");
  });
});
