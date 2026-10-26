import assert from "node:assert/strict";
import { test } from "node:test";
import { createGeneratedCardProvenanceStore } from "./generatedCardProvenanceStore";
import { generatedCardProvenanceKey } from "./generatedCardProvenanceKeys";
import type { WorkspaceScope } from "./workspaceScope";
import { upgradeGeneratedCardProvenance } from "../models/generatedCardProvenance";

const a: WorkspaceScope = {kind:"user",sub:"a"}, b: WorkspaceScope = {kind:"user",sub:"b"}, guest: WorkspaceScope = {kind:"guest"};
const legacy = {cardId:"card-1",deckId:"deck-1",sourceId:"source-1",sourceChunkIds:["chunk_a"],generatedAt:"2026-01-01T00:00:00.000Z"};
function setup() {
  const data = new Map<string,string>();
  let failRead = false, failWrite = false, writes = 0;
  const storage = {getItem: async (key:string) => {if(failRead) throw new Error("private-read-error"); return data.get(key) ?? null;},
    setItem: async (key:string,value:string) => {if(failWrite) throw new Error("private-write-error"); writes++; data.set(key,value);}};
  return {data, store:createGeneratedCardProvenanceStore(storage), storage, readsFail:()=>{failRead=true;}, writesFail:()=>{failWrite=true;}, writes:()=>writes};
}

test("lazy migration preserves legacy metadata, persists once, dirty rev 1 and restart-safe", async () => {
  const s=setup(); s.data.set(generatedCardProvenanceKey(a),JSON.stringify([legacy]));
  const records=await s.store.get(a);
  assert.deepEqual(records[0],{...legacy,id:legacy.cardId,rev:1,updatedAt:legacy.generatedAt,dirty:true});
  assert.deepEqual(await s.store.get(a),records);
  assert.equal(s.writes(),1);
  assert.deepEqual(await createGeneratedCardProvenanceStore(s.storage).get(a),records);
});

test("malformed entries ignored, duplicates collapse without cross-source union", async () => {
  const s=setup();
  s.data.set(generatedCardProvenanceKey(a),JSON.stringify([null,{},legacy,{...legacy,sourceChunkIds:["chunk_b"]},{...legacy,sourceId:"source-2"}]));
  const records=await s.store.get(a);
  assert.equal(records.length,1);
  assert.equal(records[0].dirty,true);
  assert.ok(records[0].sourceChunkIds.length<=2);
  const before=JSON.stringify(records);
  assert.equal(JSON.stringify(await s.store.get(a)),before);
});

test("account and guest keys stay isolated, including URI-escaped sub values", async () => {
  const s=setup(); await s.store.record(a,[legacy]);
  assert.deepEqual(await s.store.get(b),[]); assert.deepEqual(await s.store.get(guest),[]);
  assert.notEqual(generatedCardProvenanceKey({kind:"user",sub:"a.b/guest"}), generatedCardProvenanceKey(guest));
  await s.store.record(guest,[{...legacy,cardId:"guest-card"}]);
  assert.equal((await s.store.get(a))[0].cardId,"card-1");
});

test("local append, remote apply and exact-revision acknowledgement serialize without lost writes", async () => {
  const s=setup(); await s.store.record(a,[legacy]);
  await Promise.all([
    s.store.record(a,[{...legacy,cardId:"card-2"}]),
    s.store.apply(a,[upgradeGeneratedCardProvenance({...legacy,cardId:"card-3"})!],legacy.generatedAt),
    s.store.markClean(a,new Map([["card-1",1]]),legacy.generatedAt),
  ]);
  assert.equal((await s.store.get(a)).length,3);
  assert.equal((await s.store.byCard(a,"card-1"))?.dirty,false);
  assert.equal((await s.store.byCard(a,"card-2"))?.dirty,true);
  assert.equal((await s.store.byCard(a,"card-3"))?.dirty,false);
});

test("delete/restore sidecar keeps metadata and stale acknowledgement cannot clean newer rev", async () => {
  const s=setup(); await s.store.record(a,[legacy]);
  await s.store.setDeleted(a,legacy.cardId,true,legacy.generatedAt);
  assert.deepEqual(await s.store.forSource(a,legacy.sourceId),[]);
  await s.store.markClean(a,new Map([[legacy.cardId,1]]),legacy.generatedAt);
  assert.equal((await s.store.byCard(a,legacy.cardId))?.dirty,true);
  await s.store.setDeleted(a,legacy.cardId,false,legacy.generatedAt);
  const restored=(await s.store.forSource(a,legacy.sourceId))[0];
  assert.equal(restored.rev,3); assert.deepEqual(restored.sourceChunkIds,legacy.sourceChunkIds);
  await s.store.markClean(a,new Map([[legacy.cardId,3]]),legacy.generatedAt);
  assert.equal((await s.store.byCard(a,legacy.cardId))?.dirty,false);
});

test("read failures and malformed JSON cannot become empty data and erase provenance", async () => {
  const s=setup(); await s.store.record(a,[legacy]); const original=s.data.get(generatedCardProvenanceKey(a));
  s.readsFail(); await assert.rejects(s.store.record(a,[{...legacy,cardId:"card-2"}]));
  assert.equal(s.data.get(generatedCardProvenanceKey(a)),original);
  const bad=setup(); bad.data.set(generatedCardProvenanceKey(a),"invalid-json");
  await assert.rejects(bad.store.get(a),/invalid-local-json/);
  assert.equal(bad.data.get(generatedCardProvenanceKey(a)),"invalid-json");
});

test("write failures propagate and a failed transaction never poisons later queued operations", async () => {
  const s=setup(); s.writesFail(); await assert.rejects(s.store.record(a,[legacy]));
  const good=setup();
  await assert.rejects(good.store.record(a,[{...legacy,sourceChunkIds:[]}]),/invalid-local-entry/);
  await good.store.record(a,[legacy]); assert.equal((await good.store.get(a)).length,1);
});
