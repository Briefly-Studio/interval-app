// Runs the REAL SyncService and provenance storage adapter. Only native/auth/transport
// boundaries are mocked; backend classification, change keys and cursor selection are real.
import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import type { WorkspaceScope } from "../../storage/workspaceScope";
import type { CardRecord } from "../../models/card";
import type { DeckRecord } from "../../models/deck";
import type { GenerateDeckSession } from "../../domain/ai/generateDeckSession";
import type { Change } from "./types";
import { classifyChange, makeChangeKey } from "../../../backend/lambdas/sync-push/lib.mjs";
import { nextCursorForPage } from "../../../backend/lambdas/sync-pull/lib.mjs";
import { upgradeGeneratedCardProvenance } from "../../models/generatedCardProvenance";
import { upgradeLibrarySource } from "../../models/librarySource";
import { generatedCardProvenanceKey } from "../../storage/generatedCardProvenanceKeys";

let device="A", environment="development", envFails=false, scope:WorkspaceScope={kind:"user",sub:"user-1"};
let storage=new Map<string,string>(), decks=new Map<string,DeckRecord[]>(), cards=new Map<string,CardRecord[]>();
let remote=new Map<string,Change>(), log=new Map<string,{change:Change;seq:number}>();
let outgoing:Change[]=[];
let clock=0, failProvenanceWrite=false, nextSeq=0;
// Models the real backend's server-assigned ingestion-order `seq` (see
// docs/sync-cursor-semantics.md) — NOT the change's own domain `ts`/`changeKey`. This is what
// lets this fake backend actually exercise the fixed cursor behavior rather than the old,
// buggy ts-ordered one.
const seq=()=>++nextSeq;
let duringPush:(()=>Promise<void>)|undefined;
const clone=<T>(value:T):T=>structuredClone(value);
const time=()=>new Date(Date.UTC(2026,0,1,0,0,++clock)).toISOString();
const location=(s:WorkspaceScope)=>`${device}|${s.kind==="user"?s.sub:"guest"}`;
const key=(s:WorkspaceScope,d:string)=>`${location(s)}|${d}`;
const storageKey=(k:string)=>`${device}|${k}`;
const moduleUrl=(path:string)=>new URL(path,import.meta.url).href;

mock.module("@react-native-async-storage/async-storage",{defaultExport:{
  getItem:async(k:string)=>storage.get(storageKey(k))??null,
  setItem:async(k:string,v:string)=>{if(failProvenanceWrite&&k.includes("generatedCardProvenance"))throw new Error("private failure");storage.set(storageKey(k),v);},
}});
mock.module(moduleUrl("../../auth/AuthService.ts"),{namedExports:{AuthService:{getActiveScope:async()=>scope,getAccessToken:async()=>"fake-token"}}});
mock.module(moduleUrl("../../config/environment.ts"),{namedExports:{getEnvironmentConfig:()=>{if(envFails)throw new Error("no config");return {environment};}}});
mock.module(moduleUrl("../../storage/device.ts"),{namedExports:{getDeviceId:async()=>device}});
mock.module(moduleUrl("../../storage/decks.ts"),{namedExports:{
  getDecksAll:async(s:WorkspaceScope)=>clone(decks.get(location(s))??[]),
  setDecks:async(s:WorkspaceScope,v:DeckRecord[])=>{decks.set(location(s),clone(v));},
  addDeck:async(s:WorkspaceScope,v:DeckRecord)=>{decks.set(location(s),[...(decks.get(location(s))??[]),clone(v)]);},
}});
mock.module(moduleUrl("../../storage/cards.ts"),{namedExports:{getCardsAll:async(s:WorkspaceScope,d:string)=>clone(cards.get(key(s,d))??[]),
  deleteCardsForDeck:async(s:WorkspaceScope,d:string)=>{cards.delete(key(s,d));},
  setCards:async(s:WorkspaceScope,d:string,v:CardRecord[])=>{cards.set(key(s,d),clone(v));}}});
mock.module(moduleUrl("../../storage/librarySources.ts"),{namedExports:{getLibrarySources:async()=>[],setLibrarySources:async()=>{}}});
mock.module(moduleUrl("../../storage/sourceCollections.ts"),{namedExports:{getSourceCollections:async()=>[],setSourceCollections:async()=>{}}});
mock.module(moduleUrl("../../storage/sessions.ts"),{namedExports:{getSessions:async()=>[],setSessions:async()=>{}}});
mock.module(moduleUrl("../../storage/reviewEvents.ts"),{namedExports:{getReviewEventsForDeck:async()=>[],setReviewEventsForDeck:async()=>{}}});
mock.module(moduleUrl("../../storage/cardScheduling.ts"),{namedExports:{upsertCardScheduling:async()=>{}}});
mock.module(moduleUrl("../../domain/normalization/normalizeSource.ts"),{namedExports:{normalizeSource:async()=>({content:{chunks:[{id:"chunk_a"},{id:"chunk_b"}]}})}});
mock.module(moduleUrl("./http.ts"),{namedExports:{
  pushChanges:async(_token:string,body:{deviceId:string;changes:Change[]})=>{
    outgoing.push(...clone(body.changes));
    const accepted:{entity:string;id:string}[]=[],rejected:{entity:string;id:string}[]=[];
    for(const change of body.changes){
      const c=classifyChange(change); assert.equal(c.ok,true);
      const id=`${change.entity}|${change.id}`;
      const current=remote.get(id);
      if(current&&(current.record.rev??0)>c.incomingRev){rejected.push({entity:change.entity,id:change.id});continue;}
      remote.set(id,clone(change));
      // Server-assigned seq, never the change's own ts — the same root fix
      // docs/sync-cursor-semantics.md describes for the real backend. A retried push of the
      // exact same change (same changeKey) is still idempotent: the counter is only consumed
      // on first insertion.
      const ck=makeChangeKey(c,body.deviceId); if(!log.has(ck))log.set(ck,{change:clone(change),seq:seq()});
      accepted.push({entity:change.entity,id:change.id});
    }
    if(duringPush){const callback=duringPush;duringPush=undefined;await callback();}
    return {accepted,rejected};
  },
  pullChanges:async(_token:string,body:{cursor?:string})=>{
    const cursorSeq=body.cursor&&/^\d+$/.test(body.cursor)?Number(body.cursor):0;
    const rows=[...log.values()].filter((r)=>r.seq>cursorSeq).sort((a,b)=>a.seq-b.seq);
    return {changes:clone(rows.map((r)=>r.change)),cursor:nextCursorForPage(rows,body.cursor).cursor};
  },
  describeSyncFailure:()=>"test-category",getSyncDiagnosticCode:()=>"test-category",isSyncNetworkError:()=>false,
}});

const {SyncService}=await import("./SyncService");
const store=await import("../../storage/generatedCardProvenance");
const {loadSourceCoverage}=await import("../../domain/sourceCoverageService");
const {validateChange}=await import("./validateChange");
const {isGeneratedCardProvenanceSyncEnabled}=await import("./generatedCardProvenanceSyncCapability");
const source=upgradeLibrarySource({id:"source-1",sourceType:"text",displayTitle:"Source"});
const legacy=(cardId="card-1",chunk="chunk_a")=>({cardId,deckId:"deck-1",sourceId:source.id,sourceChunkIds:[chunk],generatedAt:time()});
function saveCard(id="card-1"){
  const ts=time();
  decks.set(location(scope),[{id:"deck-1",title:"Deck",createdAt:ts,updatedAt:ts,rev:1,dirty:true}]);
  const c:CardRecord={id,deckId:"deck-1",front:"Question",back:"Answer",difficulty:"medium",createdAt:Date.parse(ts),updatedAt:ts,rev:1,dirty:true};
  cards.set(key(scope,"deck-1"),[...(cards.get(key(scope,"deck-1"))??[]),c]);
}
const coverage=()=>loadSourceCoverage(scope,source);
beforeEach(()=>{device="A";environment="development";envFails=false;scope={kind:"user",sub:"user-1"};clock=0;nextSeq=0;
  storage=new Map();decks=new Map();cards=new Map();remote=new Map();log=new Map();outgoing=[];duringPush=undefined;failProvenanceWrite=false;});

test("offline save → collect/push/markClean → B pulls; coverage and persisted restart match",async()=>{
  saveCard();await store.recordGeneratedCardProvenance(scope,[legacy()]);
  assert.equal((await coverage()).coveredChunkCount,1);
  assert.equal(await SyncService.getPendingDirtyCount(scope),3);
  await SyncService.syncOnce();
  const sent=outgoing.find(c=>c.entity==="generatedCardProvenance")!;
  assert.ok(sent); assert.equal("dirty" in sent.record,false); assert.equal("front" in sent.record,false);
  assert.equal((await store.getGeneratedCardProvenance(scope))[0].dirty,false);
  const a=await coverage();device="B";assert.equal((await coverage()).coveredChunkCount,0);
  await SyncService.syncOnce();assert.deepEqual(await coverage(),a);
  const persisted=storage.get(storageKey(generatedCardProvenanceKey(scope)));
  assert.ok(persisted);await SyncService.syncOnce();assert.equal(storage.get(storageKey(generatedCardProvenanceKey(scope))),persisted);
});

test("B offline, A and B independently generate different cards; both aggregate after reconnect",async()=>{
  saveCard();await store.recordGeneratedCardProvenance(scope,[legacy()]);await SyncService.syncOnce();
  device="B";saveCard("card-2");await store.recordGeneratedCardProvenance(scope,[legacy("card-2","chunk_b")]);
  assert.equal((await coverage()).coveredChunkCount,1);await SyncService.syncOnce();
  assert.equal((await coverage()).coveredChunkCount,2);device="A";await SyncService.syncOnce();
  assert.equal((await coverage()).coveredChunkCount,2);
});

test("synced card/deck tombstones dominate retained provenance; restores reactivate it",async()=>{
  saveCard();await store.recordGeneratedCardProvenance(scope,[legacy()]);await SyncService.syncOnce();
  device="B";await SyncService.syncOnce();device="A";
  let c=cards.get(key(scope,"deck-1"))![0];
  c={...c,deletedAt:time(),updatedAt:time(),rev:c.rev+1,dirty:true};cards.set(key(scope,"deck-1"),[c]);
  assert.equal((await coverage()).coveredChunkCount,0);await SyncService.syncOnce();device="B";await SyncService.syncOnce();
  assert.equal((await coverage()).coveredChunkCount,0);assert.equal((await store.getGeneratedCardProvenance(scope)).length,1);
  device="A";c={...c,deletedAt:undefined,rev:c.rev+1,updatedAt:time(),dirty:true};cards.set(key(scope,"deck-1"),[c]);
  await SyncService.syncOnce();device="B";await SyncService.syncOnce();assert.equal((await coverage()).coveredChunkCount,1);
  device="A";let d=decks.get(location(scope))![0];d={...d,deletedAt:time(),rev:d.rev+1,updatedAt:time(),dirty:true};decks.set(location(scope),[d]);
  await SyncService.syncOnce();device="B";await SyncService.syncOnce();assert.equal((await coverage()).coveredChunkCount,0);
  device="A";d={...d,deletedAt:undefined,rev:d.rev+1,updatedAt:time(),dirty:true};decks.set(location(scope),[d]);
  await SyncService.syncOnce();device="B";await SyncService.syncOnce();assert.equal((await coverage()).coveredChunkCount,1);
});

test("same-card conflict publishes dirty repair and converges server plus both devices",async()=>{
  saveCard();await store.recordGeneratedCardProvenance(scope,[legacy()]);await SyncService.syncOnce();
  device="B";await store.recordGeneratedCardProvenance(scope,[{...legacy(),generatedAt:"2026-01-01T00:00:03.000Z",sourceChunkIds:["chunk_b"]}]);
  await SyncService.syncOnce();assert.deepEqual((await store.getGeneratedCardProvenance(scope))[0].sourceChunkIds,["chunk_a","chunk_b"]);
  assert.equal((await store.getGeneratedCardProvenance(scope))[0].dirty,true);
  await SyncService.syncOnce();device="A";await SyncService.syncOnce();await SyncService.syncOnce();
  device="B";await SyncService.syncOnce();
  assert.equal((await store.getGeneratedCardProvenance(scope))[0].dirty,false);
  assert.equal((await coverage()).coveredChunkCount,2);
  assert.equal((remote.get("generatedCardProvenance|card-1")!.record as {sourceChunkIds:string[]}).sourceChunkIds.length,2);
});

test("markClean checks exact revision and account after an in-flight push",async()=>{
  await store.recordGeneratedCardProvenance(scope,[legacy()]);
  duringPush=async()=>{await store.setGeneratedCardProvenanceDeleted(scope,"card-1",true,time());};
  await SyncService.syncOnce();
  assert.equal((await store.getGeneratedCardProvenance(scope))[0].dirty,true);
  assert.ok((await store.getGeneratedCardProvenance(scope))[0].deletedAt);
  duringPush=async()=>{scope={kind:"user",sub:"user-2"};};
  await SyncService.syncOnce();assert.deepEqual(await store.getGeneratedCardProvenance(scope),[]);
  scope={kind:"user",sub:"user-1"};assert.equal((await store.getGeneratedCardProvenance(scope))[0].dirty,true);
});

test("Development/Staging enabled; Production, unknown config, and guest never send provenance",async()=>{
  await store.recordGeneratedCardProvenance(scope,[legacy()]);
  environment="production";assert.equal(isGeneratedCardProvenanceSyncEnabled(),false);assert.equal(await SyncService.getPendingDirtyCount(scope),0);
  const remoteP=upgradeGeneratedCardProvenance(legacy("remote-card"))!;
  log.set(remoteP.updatedAt,{change:{entity:"generatedCardProvenance",id:remoteP.id,op:"upsert",ts:remoteP.updatedAt,record:remoteP},seq:seq()});
  await SyncService.syncOnce();assert.equal(outgoing.length,0);assert.equal((await store.getGeneratedCardProvenance(scope)).length,1);
  environment="staging";assert.equal(isGeneratedCardProvenanceSyncEnabled(),true);assert.equal(await SyncService.getPendingDirtyCount(scope),1);
  envFails=true;assert.equal(isGeneratedCardProvenanceSyncEnabled(),false);envFails=false;
  scope={kind:"guest"};await store.recordGeneratedCardProvenance(scope,[legacy("guest-card")]);await SyncService.syncOnce();assert.equal(outgoing.length,0);
});

test("remote validation enforces stable identity, timestamps, bounded shape and tombstone operation",async()=>{
  const p=upgradeGeneratedCardProvenance(legacy())!;
  const change={id:p.id,entity:"generatedCardProvenance",op:"upsert",record:p,ts:p.updatedAt};
  assert.equal(validateChange(change).ok,true);
  for(const patch of [{id:"wrong"},{op:"delete"},{ts:time()},{record:{...p,sourceText:"private"}},{record:{...p,cardId:"wrong"}}])assert.equal(validateChange({...change,...patch}).ok,false);
  assert.equal(validateChange({...change,op:"delete",record:{...p,deletedAt:p.updatedAt}}).ok,true);
  log.set(p.updatedAt,{change:{...change,record:{...p,sourceChunkIds:[]} as typeof p} as Change,seq:seq()});
  const warnings:unknown[][]=[];const warn=mock.method(console,"warn",(...args:unknown[])=>{warnings.push(args);});
  await SyncService.syncOnce();warn.mock.restore();
  assert.deepEqual(await store.getGeneratedCardProvenance(scope),[]);assert.ok(warnings.length);
});

test("saveDraftDeck remains offline/best-effort when provenance persistence fails",async()=>{
  const {saveDraftDeck}=await import("../../domain/ai/generateDeckSave");
  const session={attemptId:"test-attempt",sourceId:source.id,sourceScope:scope,deckTitle:"Generated",cards:[{id:"draft",front:"Question",back:"Answer",sourceChunkIds:["chunk_a"]}],options:{cardCount:"small",difficulty:"balanced",cardStyle:"question-answer"},generatedCardCount:1,editedCardIds:[]} as unknown as GenerateDeckSession;
  failProvenanceWrite=true;const result=await saveDraftDeck(scope,session);
  assert.equal(result.status,"saved");assert.equal(decks.get(location(scope))?.length,1);
  assert.equal(outgoing.length,0);assert.equal([...cards.values()][0].length,1);
  assert.equal("sourceChunkIds" in [...cards.values()][0][0],false);
  assert.equal("sourceId" in decks.get(location(scope))![0],false);
});

test("FIXED (was a known backend limit): backdated provenance is delivered to an already-advanced cursor WITHOUT full replay (docs/sync-cursor-semantics.md)",async()=>{
  saveCard();const oldLink=legacy();await SyncService.syncOnce();
  device="B";await SyncService.syncOnce();
  const deck=decks.get(location(scope))![0];
  decks.set(location(scope),[{...deck,rev:deck.rev+1,updatedAt:time(),dirty:true}]);
  await SyncService.syncOnce(); // B's cursor has advanced — but past a SERVER-ORDERING position,
  // never past oldLink's own (older) domain timestamp, since the fake backend above now orders
  // by server-assigned seq, exactly like the real one.
  device="A";await store.recordGeneratedCardProvenance(scope,[oldLink]);await SyncService.syncOnce();
  assert.equal((await coverage()).coveredChunkCount,1);
  // B's very next ORDINARY incremental pull receives the backdated change — no cursor reset,
  // no Force Resync, no full replay. This is the exact scenario that used to fail before the
  // sync-cursor-hardening fix (see this test's previous name/body in git history).
  device="B";await SyncService.syncOnce();
  assert.equal((await coverage()).coveredChunkCount,1,"backdated provenance must be visible after an ordinary incremental pull, not only after a full replay");
});

test("same-id card acknowledgements cannot mark rejected provenance clean",async()=>{
  saveCard();await store.recordGeneratedCardProvenance(scope,[legacy()]);
  const p=upgradeGeneratedCardProvenance(legacy())!;
  // Newer remote provenance rejects local rev 1; absent log models the rejection boundary.
  remote.set("generatedCardProvenance|card-1",{entity:"generatedCardProvenance",id:p.id,op:"upsert",ts:p.updatedAt,record:{...p,rev:10}});
  await SyncService.syncOnce();
  assert.equal(cards.get(key(scope,"deck-1"))![0].dirty,false);
  assert.equal((await store.getGeneratedCardProvenance(scope))[0].dirty,true);
});

test("coverage service finds recovery-deck restore even while original-deck card is stale/live",async()=>{
  saveCard();await store.recordGeneratedCardProvenance(scope,[legacy()]);
  const original=cards.get(key(scope,"deck-1"))![0];
  const old=decks.get(location(scope))![0];
  decks.set(location(scope),[{...old,deletedAt:time()},{...old,id:"recovery",rev:2}]);
  cards.set(key(scope,"recovery"),[{...original,deckId:"recovery",rev:3,updatedAt:time()}]);
  assert.equal((await coverage()).coveredChunkCount,1);
});
