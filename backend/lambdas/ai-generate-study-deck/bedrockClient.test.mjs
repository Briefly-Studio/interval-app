import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildConverseParams,
  buildGenerationPrompt,
  classifyBedrockError,
  extractModelText,
  parseModelJson,
  runGeneration,
} from "./bedrockClient.mjs";

// Deterministic, network-free, credential-free, dependency-free of the real AWS SDK — this file
// never imports "@aws-sdk/client-bedrock-runtime". Every "client"/"CommandCtor" below is a plain
// hand-built fake; see this file's own fakes for exactly what each test simulates.

function baseRequest(overrides = {}) {
  return {
    sourceId: "src-1",
    sourceTitle: "Intro to Testing",
    normalizationVersion: 1,
    generationContractVersion: 1,
    selectedChunkIds: ["a", "b"],
    requestedCardCount: 5,
    options: { cardCount: "medium", difficulty: "balanced", cardStyle: "question-answer" },
    ...overrides,
  };
}

function baseContext(chunks) {
  const list = chunks ?? [
    { id: "a", text: "Photosynthesis converts light into chemical energy." },
    { id: "b", text: "Mitochondria produce ATP." },
  ];
  return {
    chunks: list,
    totalChars: list.reduce((sum, c) => sum + c.text.length, 0),
    chunkCount: list.length,
    fullSourceIncluded: true,
    excludedChunkIds: [],
    excludedChunkCount: 0,
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

test("buildGenerationPrompt: untrusted-source framing, real chunk ids, and option values are all present", () => {
  const request = baseRequest();
  const context = baseContext();
  const { system, user } = buildGenerationPrompt(request, context);

  assert.match(system, /untrusted reference material/);
  assert.match(system, /ignore it/);
  assert.match(system, /ONLY a single JSON object/);
  assert.match(system, /"a","b"|\["a","b"\]/);
  assert.match(system, /balanced/);
  assert.match(system, /question-answer/);
  assert.match(user, /Photosynthesis/);
  assert.match(user, /\[chunk id: a\]/);
});

test("buildGenerationPrompt: includes a language instruction only when request.language is set", () => {
  const withLanguage = buildGenerationPrompt(baseRequest({ language: "es" }), baseContext());
  assert.match(withLanguage.system, /Write the title and every card.*es/s);

  const withoutLanguage = buildGenerationPrompt(baseRequest(), baseContext());
  assert.doesNotMatch(withoutLanguage.system, /Write the title and every card/);
});

test("buildConverseParams: shape matches the Bedrock Converse API contract", () => {
  const params = buildConverseParams("test-model-id", baseRequest(), baseContext());
  assert.equal(params.modelId, "test-model-id");
  assert.equal(params.system.length, 1);
  assert.equal(typeof params.system[0].text, "string");
  assert.equal(params.messages.length, 1);
  assert.equal(params.messages[0].role, "user");
  assert.equal(typeof params.messages[0].content[0].text, "string");
  assert.equal(typeof params.inferenceConfig.maxTokens, "number");
  assert.equal(typeof params.inferenceConfig.temperature, "number");
});

test("extractModelText: reads the text part out of a well-formed Converse response", () => {
  const text = extractModelText(converseResponseWithText('{"title":"T","cards":[]}'));
  assert.equal(text, '{"title":"T","cards":[]}');
});

test("extractModelText: returns null for a missing/malformed response shape, never throws", () => {
  assert.equal(extractModelText(null), null);
  assert.equal(extractModelText({}), null);
  assert.equal(extractModelText({ output: {} }), null);
  assert.equal(extractModelText({ output: { message: { content: "not-an-array" } } }), null);
  assert.equal(extractModelText({ output: { message: { content: [{ notText: true }] } } }), null);
});

test("parseModelJson: parses well-formed JSON text", () => {
  const result = parseModelJson('{"title":"T","cards":[]}');
  assert.equal(result.status, "ok");
  assert.deepEqual(result.value, { title: "T", cards: [] });
});

test("parseModelJson: strips a markdown code fence before parsing", () => {
  const result = parseModelJson('```json\n{"title":"T","cards":[]}\n```');
  assert.equal(result.status, "ok");
  assert.deepEqual(result.value, { title: "T", cards: [] });
});

test("parseModelJson: non-JSON text is a parse error, never thrown", () => {
  const result = parseModelJson("Sure! Here are your flashcards: ...");
  assert.equal(result.status, "error");
});

test("parseModelJson: null/non-string input is a parse error, never thrown", () => {
  assert.equal(parseModelJson(null).status, "error");
  assert.equal(parseModelJson(undefined).status, "error");
});

test("classifyBedrockError: throttling maps to rate-limited", () => {
  assert.equal(classifyBedrockError({ name: "ThrottlingException" }).code, "rate-limited");
});

test("classifyBedrockError: our own abort and Bedrock's own model-timeout both map to generation-timeout", () => {
  assert.equal(classifyBedrockError({ name: "AbortError" }).code, "generation-timeout");
  assert.equal(classifyBedrockError({ name: "ModelTimeoutException" }).code, "generation-timeout");
});

test("classifyBedrockError: service/config/unexpected errors all map to the safe provider-unavailable catch-all", () => {
  for (const name of ["ServiceUnavailableException", "ModelNotReadyException", "InternalServerException", "ResourceNotFoundException", "AccessDeniedException", "ValidationException", "SomethingNeverSeenBefore"]) {
    assert.equal(classifyBedrockError({ name }).code, "provider-unavailable");
  }
  // No name at all (e.g. a non-Error thrown value) must not throw and must still classify safely.
  assert.equal(classifyBedrockError({}).code, "provider-unavailable");
  assert.equal(classifyBedrockError(null).code, "provider-unavailable");
});

test("runGeneration: a well-formed Converse response round-trips to a parsed raw object (adapter success path)", async () => {
  const fakeClient = { send: async () => converseResponseWithText('{"title":"Biology Basics","cards":[{"front":"Q","back":"A","sourceChunkIds":["a"]}]}') };
  const result = await runGeneration(fakeClient, FakeCommand, "test-model-id", baseRequest(), baseContext());
  assert.equal(result.status, "ok");
  assert.deepEqual(result.raw, { title: "Biology Basics", cards: [{ front: "Q", back: "A", sourceChunkIds: ["a"] }] });
});

test("runGeneration: malformed (non-JSON) model text maps to malformed-model-output", async () => {
  const fakeClient = { send: async () => converseResponseWithText("not json at all") };
  const result = await runGeneration(fakeClient, FakeCommand, "test-model-id", baseRequest(), baseContext());
  assert.equal(result.status, "error");
  assert.equal(result.code, "malformed-model-output");
});

test("runGeneration: JSON that parses but has the wrong schema is passed through untouched — the adapter never judges schema validity itself", async () => {
  const fakeClient = { send: async () => converseResponseWithText('{"nope": true}') };
  const result = await runGeneration(fakeClient, FakeCommand, "test-model-id", baseRequest(), baseContext());
  assert.equal(result.status, "ok");
  assert.deepEqual(result.raw, { nope: true });
});

test("runGeneration: a thrown ThrottlingException maps to rate-limited", async () => {
  const fakeClient = {
    send: async () => {
      const error = new Error("rate exceeded");
      error.name = "ThrottlingException";
      throw error;
    },
  };
  const result = await runGeneration(fakeClient, FakeCommand, "test-model-id", baseRequest(), baseContext());
  assert.equal(result.status, "error");
  assert.equal(result.code, "rate-limited");
});

test("runGeneration: a client call that never resolves is aborted by our own bounded timeout and maps to generation-timeout", async () => {
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
  // A tiny timeout, not the real 20_000ms default — keeps this test fast and still exercises the
  // real AbortController wiring end to end.
  const result = await runGeneration(fakeClient, FakeCommand, "test-model-id", baseRequest(), baseContext(), 10);
  assert.equal(result.status, "error");
  assert.equal(result.code, "generation-timeout");
});

test("runGeneration: an unrecognized thrown error maps safely to provider-unavailable, never leaking the raw error", async () => {
  const fakeClient = {
    send: async () => {
      throw new Error("some internal AWS detail that must never reach the client");
    },
  };
  const result = await runGeneration(fakeClient, FakeCommand, "test-model-id", baseRequest(), baseContext());
  assert.equal(result.status, "error");
  assert.equal(result.code, "provider-unavailable");
});
