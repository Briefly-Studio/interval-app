import { test } from "node:test";
import assert from "node:assert/strict";
import { createBackendProvider } from "./backendProvider";
import type { GenerateStudyDeckRequest, GenerationContext } from "./types";

// Deterministic, network-free, credential-free — backendProvider.ts takes its access-token
// getter and base URL as injected dependencies specifically so this file never needs AuthService
// or getEnvironmentConfig (both native-module-backed and unloadable under plain `node --test` —
// confirmed directly). The real fetch call underneath (src/cloud/ai/http.ts, unmocked here) is
// exercised against a fake globalThis.fetch, giving full coverage of the real integration between
// this file and the HTTP layer, not just this file's own logic in isolation.

function baseRequest(overrides: Partial<GenerateStudyDeckRequest> = {}): GenerateStudyDeckRequest {
  return {
    sourceId: "src-1",
    sourceTitle: "Test Source",
    normalizationVersion: 1,
    generationContractVersion: 1,
    selectedChunkIds: ["a"],
    requestedCardCount: 5,
    targetMinimumCardCount: 3,
    options: { cardCount: "medium", difficulty: "balanced", cardStyle: "question-answer" },
    ...overrides,
  };
}

function baseContext(): GenerationContext {
  const chunks = [{ id: "a", index: 0, text: "hello", approxSize: 5, provenance: {} }];
  return { chunks, totalChars: 5, chunkCount: 1, fullSourceIncluded: true, excludedChunkIds: [], excludedChunkCount: 0 };
}

async function withFakeFetch(fakeFetch: typeof fetch, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const deps = { getAccessToken: async () => "test-token", getBaseUrl: () => "https://api.example.invalid" };

test("createBackendProvider: id is stable and provider-neutral (never names a model/vendor)", () => {
  const provider = createBackendProvider(deps);
  assert.equal(provider.id, "interval-backend-v1");
  assert.doesNotMatch(provider.id, /bedrock|nova|claude|openai|anthropic/i);
});

test("generate: success — a well-formed backend response is returned as raw, untouched", async () => {
  await withFakeFetch(
    (async () => new Response(JSON.stringify({ title: "Biology Basics", cards: [] }), { status: 200 })) as typeof fetch,
    async () => {
      const outcome = await createBackendProvider(deps).generate({ request: baseRequest(), context: baseContext() });
      assert.equal(outcome.status, "ok");
      if (outcome.status === "ok") assert.deepEqual(outcome.raw, { title: "Biology Basics", cards: [] });
    }
  );
});

test("generate: auth/token failure — no access token maps to provider-unavailable without any network attempt", async () => {
  let fetchCalled = false;
  await withFakeFetch(
    (async () => {
      fetchCalled = true;
      throw new Error("fetch should never be called");
    }) as typeof fetch,
    async () => {
      const noTokenDeps = { getAccessToken: async () => null, getBaseUrl: () => "https://api.example.invalid" };
      const outcome = await createBackendProvider(noTokenDeps).generate({ request: baseRequest(), context: baseContext() });
      assert.equal(outcome.status, "error");
      if (outcome.status === "error") assert.equal(outcome.error.code, "provider-unavailable");
      assert.equal(fetchCalled, false);
    }
  );
});

test("generate: network failure — an unreachable server maps to provider-unavailable", async () => {
  await withFakeFetch(
    (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as typeof fetch,
    async () => {
      const outcome = await createBackendProvider(deps).generate({ request: baseRequest(), context: baseContext() });
      assert.equal(outcome.status, "error");
      if (outcome.status === "error") {
        assert.equal(outcome.error.code, "provider-unavailable");
        assert.doesNotMatch(outcome.error.message, /ENOTFOUND/);
      }
    }
  );
});

test("generate: HTTP error mapping — a recognized GenerationErrorCode in the response body is trusted directly", async () => {
  await withFakeFetch(
    (async () => new Response(JSON.stringify({ error: "generation-timeout" }), { status: 502 })) as typeof fetch,
    async () => {
      const outcome = await createBackendProvider(deps).generate({ request: baseRequest(), context: baseContext() });
      assert.equal(outcome.status, "error");
      if (outcome.status === "error") assert.equal(outcome.error.code, "generation-timeout");
    }
  );
});

test("generate: HTTP error mapping — 429 with no recognizable body code falls back to rate-limited by status", async () => {
  await withFakeFetch(
    (async () => new Response("", { status: 429 })) as typeof fetch,
    async () => {
      const outcome = await createBackendProvider(deps).generate({ request: baseRequest(), context: baseContext() });
      assert.equal(outcome.status, "error");
      if (outcome.status === "error") assert.equal(outcome.error.code, "rate-limited");
    }
  );
});

test("generate: HTTP error mapping — 422 with no recognizable body code falls back to validation-failed by status", async () => {
  await withFakeFetch(
    (async () => new Response("", { status: 422 })) as typeof fetch,
    async () => {
      const outcome = await createBackendProvider(deps).generate({ request: baseRequest(), context: baseContext() });
      assert.equal(outcome.status, "error");
      if (outcome.status === "error") assert.equal(outcome.error.code, "validation-failed");
    }
  );
});

test("generate: HTTP error mapping — 401 (unauthenticated, no recognizable body code) falls back to provider-unavailable", async () => {
  await withFakeFetch(
    (async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })) as typeof fetch,
    async () => {
      const outcome = await createBackendProvider(deps).generate({ request: baseRequest(), context: baseContext() });
      assert.equal(outcome.status, "error");
      // "unauthorized" is not a GenerationErrorCode — must not be forwarded as-is.
      if (outcome.status === "error") assert.equal(outcome.error.code, "provider-unavailable");
    }
  );
});

test("generate: never forwards a raw/unrecognized server-sent error string as if it were a trusted code", async () => {
  await withFakeFetch(
    (async () => new Response(JSON.stringify({ error: "some-made-up-code-the-server-should-not-invent" }), { status: 500 })) as typeof fetch,
    async () => {
      const outcome = await createBackendProvider(deps).generate({ request: baseRequest(), context: baseContext() });
      assert.equal(outcome.status, "error");
      if (outcome.status === "error") assert.equal(outcome.error.code, "provider-unavailable");
    }
  );
});
