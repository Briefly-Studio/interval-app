import { test } from "node:test";
import assert from "node:assert/strict";
import { AiHttpError, AiNetworkError, generateStudyDeckRemote, getAiHttpBody, getAiHttpStatus, isAiNetworkError } from "./http";
import type { GenerateStudyDeckRequest, GenerationContext } from "../../domain/ai/types";

// Deterministic, network-free — every test below replaces globalThis.fetch with a fake for the
// duration of that one test, restoring the original immediately after (try/finally), so no test
// can leak a fake fetch into another test or module. http.ts imports nothing from this
// repository's RN/Expo-backed config/auth layers (see its own header comment), so this file loads
// and runs under the plain `node --test` runner with zero native-module dependency.

function baseRequest(overrides: Partial<GenerateStudyDeckRequest> = {}): GenerateStudyDeckRequest {
  return {
    sourceId: "src-1",
    sourceTitle: "Test Source",
    normalizationVersion: 1,
    generationContractVersion: 1,
    selectedChunkIds: ["a"],
    requestedCardCount: 5,
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

test("generateStudyDeckRemote: sends the right method, URL, headers, and JSON body", async () => {
  await withFakeFetch(
    (async (url: string, init: RequestInit) => {
      assert.equal(url, "https://api.example.invalid/ai/generate-study-deck");
      assert.equal(init.method, "POST");
      assert.equal((init.headers as Record<string, string>)["content-type"], "application/json");
      assert.equal((init.headers as Record<string, string>).Authorization, "Bearer test-token");
      const sentBody = JSON.parse(init.body as string);
      assert.equal(sentBody.request.sourceId, "src-1");
      assert.equal(sentBody.context.chunks[0].id, "a");
      return new Response(JSON.stringify({ title: "T", cards: [] }), { status: 200 });
    }) as typeof fetch,
    async () => {
      const result = await generateStudyDeckRemote("https://api.example.invalid", "test-token", baseRequest(), baseContext());
      assert.deepEqual(result, { title: "T", cards: [] });
    }
  );
});

test("generateStudyDeckRemote: a fetch rejection becomes an AiNetworkError, never an unhandled throw type", async () => {
  await withFakeFetch(
    (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as typeof fetch,
    async () => {
      await assert.rejects(
        () => generateStudyDeckRemote("https://api.example.invalid", "test-token", baseRequest(), baseContext()),
        (error: unknown) => {
          assert.ok(error instanceof AiNetworkError);
          assert.ok(isAiNetworkError(error));
          return true;
        }
      );
    }
  );
});

test("generateStudyDeckRemote: a non-ok response becomes an AiHttpError carrying the status and parsed body", async () => {
  await withFakeFetch(
    (async () => new Response(JSON.stringify({ error: "rate-limited" }), { status: 429 })) as typeof fetch,
    async () => {
      await assert.rejects(
        () => generateStudyDeckRemote("https://api.example.invalid", "test-token", baseRequest(), baseContext()),
        (error: unknown) => {
          assert.ok(error instanceof AiHttpError);
          assert.equal(getAiHttpStatus(error), 429);
          assert.deepEqual(getAiHttpBody(error), { error: "rate-limited" });
          return true;
        }
      );
    }
  );
});

test("generateStudyDeckRemote: a non-ok response with a non-JSON body still throws AiHttpError, with an undefined body", async () => {
  await withFakeFetch(
    (async () => new Response("not json", { status: 500 })) as typeof fetch,
    async () => {
      await assert.rejects(
        () => generateStudyDeckRemote("https://api.example.invalid", "test-token", baseRequest(), baseContext()),
        (error: unknown) => {
          assert.ok(error instanceof AiHttpError);
          assert.equal(getAiHttpStatus(error), 500);
          assert.equal(getAiHttpBody(error), undefined);
          return true;
        }
      );
    }
  );
});

test("getAiHttpStatus / getAiHttpBody / isAiNetworkError return safe defaults for an unrelated error", () => {
  const unrelated = new Error("something else");
  assert.equal(getAiHttpStatus(unrelated), undefined);
  assert.equal(getAiHttpBody(unrelated), undefined);
  assert.equal(isAiNetworkError(unrelated), false);
});
