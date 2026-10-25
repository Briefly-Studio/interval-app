import { test } from "node:test";
import assert from "node:assert/strict";

import { upgradeGeneratedCardProvenance } from "./generatedCardProvenance";

const valid = {
  cardId: "card-1",
  deckId: "deck-1",
  sourceId: "source-1",
  sourceChunkIds: ["chunk_a", "chunk_b"],
  generatedAt: "2026-01-10T00:00:00.000Z",
};

test("upgradeGeneratedCardProvenance accepts a well-formed entry", () => {
  const upgraded = upgradeGeneratedCardProvenance(valid);
  assert.ok(upgraded);
  assert.deepEqual(upgraded?.sourceChunkIds, ["chunk_a", "chunk_b"]);
});

test("upgradeGeneratedCardProvenance de-duplicates repeated chunk ids", () => {
  const upgraded = upgradeGeneratedCardProvenance({ ...valid, sourceChunkIds: ["chunk_a", "chunk_a", "chunk_b"] });
  assert.deepEqual(upgraded?.sourceChunkIds, ["chunk_a", "chunk_b"]);
});

test("upgradeGeneratedCardProvenance drops non-string chunk ids rather than coercing them", () => {
  const upgraded = upgradeGeneratedCardProvenance({ ...valid, sourceChunkIds: ["chunk_a", 42, null, "chunk_b"] });
  assert.deepEqual(upgraded?.sourceChunkIds, ["chunk_a", "chunk_b"]);
});

test("upgradeGeneratedCardProvenance rejects an entry with zero usable chunk ids", () => {
  assert.equal(upgradeGeneratedCardProvenance({ ...valid, sourceChunkIds: [] }), null);
  assert.equal(upgradeGeneratedCardProvenance({ ...valid, sourceChunkIds: [1, 2, 3] }), null);
});

test("upgradeGeneratedCardProvenance rejects missing/malformed required fields", () => {
  assert.equal(upgradeGeneratedCardProvenance(null), null);
  assert.equal(upgradeGeneratedCardProvenance(undefined), null);
  assert.equal(upgradeGeneratedCardProvenance("garbage"), null);
  assert.equal(upgradeGeneratedCardProvenance({ ...valid, cardId: "" }), null);
  assert.equal(upgradeGeneratedCardProvenance({ ...valid, deckId: undefined }), null);
  assert.equal(upgradeGeneratedCardProvenance({ ...valid, sourceId: 5 }), null);
  assert.equal(upgradeGeneratedCardProvenance({ ...valid, generatedAt: "" }), null);
});
