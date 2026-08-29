import { test } from "node:test";
import assert from "node:assert/strict";
import { handler } from "./index.mjs";

function makeEvent(body, sub = "user-123") {
  return {
    body: JSON.stringify(body),
    requestContext: sub ? { authorizer: { jwt: { claims: { sub } } } } : {},
  };
}

function baseRequest(overrides = {}) {
  return {
    sourceId: "src-1",
    generationContractVersion: 1,
    requestedCardCount: 5,
    selectedChunkIds: ["a", "b"],
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

test("accepts a well-formed request and reaches the provider seam (unavailable in this skeleton)", async () => {
  const res = await handler(makeEvent({ request: baseRequest(), context: baseContext() }));
  assert.equal(res.statusCode, 502);
  assert.equal(JSON.parse(res.body).error, "provider-unavailable");
});
