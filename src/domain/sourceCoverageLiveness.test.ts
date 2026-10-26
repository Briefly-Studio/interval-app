import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceCoverageWithLiveRecords as coverage } from "./sourceCoverageLiveness";
import type { GeneratedCardProvenance } from "../models/generatedCardProvenance";

const chunks=["chunk_a","chunk_b"];
const p:GeneratedCardProvenance={cardId:"c",deckId:"d",sourceId:"s",sourceChunkIds:["chunk_a"],generatedAt:"2026-01-01T00:00:00.000Z"};
const card={id:"c",deckId:"d",rev:1,updatedAt:p.generatedAt};
const deck={id:"d"};
test("card before provenance, provenance before card, and missing source chunks are harmless",()=>{
  assert.equal(coverage(chunks,[],[deck],[card]).coveredChunkCount,0);
  assert.equal(coverage(chunks,[p],[deck],[]).coveredChunkCount,0);
  assert.equal(coverage([], [p],[deck],[card]).coveredChunkCount,0);
  assert.equal(coverage(chunks,[p],[deck],[card]).coveredChunkCount,1);
});
test("active provenance AND live card AND live deck required; restore reactivates",()=>{
  assert.equal(coverage(chunks,[{...p,deletedAt:p.generatedAt}],[deck],[card]).coveredChunkCount,0);
  assert.equal(coverage(chunks,[p],[deck],[{...card,deletedAt:p.generatedAt}]).coveredChunkCount,0);
  assert.equal(coverage(chunks,[p],[{...deck,deletedAt:p.generatedAt}],[card]).coveredChunkCount,0);
  assert.equal(coverage(chunks,[p],[],[card]).coveredChunkCount,0);
  assert.equal(coverage(chunks,[p],[deck],[card]).coveredChunkCount,1);
});
test("recovery deck restore follows newer card location while retaining original provenance",()=>{
  const restored={...card,deckId:"recovery",rev:3};
  const old={...card,rev:2,deletedAt:p.generatedAt};
  assert.equal(coverage(chunks,[p],[{...deck,deletedAt:p.generatedAt},{id:"recovery"}],[old,restored]).coveredChunkCount,1);
  assert.deepEqual(coverage(chunks,[p],[deck,{id:"recovery"}],[old,restored]),coverage(chunks,[p],[deck,{id:"recovery"}],[restored,old]));
});
test("unknown chunks ignored and equivalent multi-device sets produce identical aggregate union",()=>{
  const b={...p,cardId:"c2",sourceChunkIds:["chunk_b","stale_chunk"]};
  const c2={...card,id:"c2"};
  const a=coverage(chunks,[p,b],[deck],[card,c2]);
  const remote=coverage(chunks,[b,p],[deck],[c2,card]);
  assert.deepEqual(a,remote); assert.equal(a.coveredChunkCount,2);
});

test("duplicate equal-revision card locations have a deterministic tie-break",()=>{
  const other={...card,deckId:"z"};
  const decks=[deck,{id:"z",deletedAt:p.generatedAt}];
  assert.deepEqual(coverage(chunks,[p],decks,[card,other]),coverage(chunks,[p],decks,[other,card]));
});
