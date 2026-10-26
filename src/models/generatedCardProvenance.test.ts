import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_PROVENANCE_CHUNK_IDS, parseGeneratedCardProvenanceRecord, upgradeGeneratedCardProvenance } from "./generatedCardProvenance";

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

test("strict synced record rejects malformed IDs, timestamp, revision, flags, and arbitrary content", () => {
  const record=upgradeGeneratedCardProvenance(valid)!;
  for(const patch of [
    {id:"other"},{cardId:"../card"},{deckId:" "},{sourceId:""},{sourceId:"x".repeat(129)},
    {generatedAt:"yesterday"},{generatedAt:"2026-02-30T00:00:00.000Z"},{updatedAt:"invalid"},
    {rev:0},{rev:-1},{rev:1.5},{rev:Infinity},{dirty:"true"},{deletedAt:"bad"},{lastSyncedAt:"bad"},
    {normalizationVersion:0},{normalizationVersion:1.5},{sourceText:"private"},
    {sourceChunkIds:[]},{sourceChunkIds:["x".repeat(65)]},{sourceChunkIds:["bad/path"]},
    {sourceChunkIds:Array(MAX_PROVENANCE_CHUNK_IDS+1).fill("chunk_a")},
  ]) assert.equal(parseGeneratedCardProvenanceRecord({...record,...patch}),null,JSON.stringify(patch).slice(0,90));
  assert.deepEqual(upgradeGeneratedCardProvenance(record),record);
  assert.equal(record.normalizationVersion,undefined);
});

test("valid tombstone/optional normalization version and deduplicated remote chunk ids",()=>{
  const r=upgradeGeneratedCardProvenance(valid)!;
  assert.deepEqual(parseGeneratedCardProvenanceRecord({...r,deletedAt:r.updatedAt,normalizationVersion:1,sourceChunkIds:["chunk_b","chunk_a","chunk_a"]})?.sourceChunkIds,["chunk_a","chunk_b"]);
});
