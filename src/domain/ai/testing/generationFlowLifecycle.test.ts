import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import type { NormalizedSourceContent } from "../../normalization/types";
import type { ModelProvider } from "../aiService";
import { upgradeLibrarySource } from "../../../models/librarySource";

let content:NormalizedSourceContent,calls=0,gate:Promise<void>|undefined;
const provider:ModelProvider={id:"fake",async generate(input){calls++;return {status:"ok",raw:{title:"Draft",cards:[{front:`Question ${input.context.chunks[0].id}`,back:"Answer",sourceChunkIds:[input.context.chunks[0].id]}]}};}};
mock.module(new URL("../../normalization/normalizeSource.ts",import.meta.url).href,{namedExports:{normalizeSource:async()=>{await gate;return {status:"ready",content};}}});
mock.module(new URL("../providerSelection.ts",import.meta.url).href,{namedExports:{selectModelProvider:()=>provider}});
mock.module(new URL("../../sourceCoverageService.ts",import.meta.url).href,{namedExports:{loadSourceCoverage:async()=>({uncoveredChunkIds:content.chunks.map(c=>c.id)})}});
const {runGenerateDeckFlow}=await import("../generateDeckFlow");
const {getGenerateDeckSession,clearGenerateDeckSession}=await import("../generateDeckSession");
const source=upgradeLibrarySource({id:"s",sourceType:"text",displayTitle:"Source"});
const scope={kind:"guest" as const};
const options={cardCount:"medium" as const,difficulty:"balanced" as const,cardStyle:"question-answer" as const};
beforeEach(()=>{calls=0;gate=undefined;clearGenerateDeckSession();content={sourceId:"s",sourceType:"text",title:"Source",contentKind:"text",metadata:{},normalizationVersion:1,extraction:{status:"ready",adapter:"text-v1"},
  chunks:Array.from({length:5},(_,i)=>({id:`c${i}`,index:i,text:`${i} source text`,approxSize:12_000,provenance:{}}))};});

test("fresh actual plan is approved before quota calls; rejecting it creates no session",async()=>{
  const result=await runGenerateDeckFlow(source,options,scope,{type:"entireSource"},{onPlanReady:async plan=>{
    assert.equal(calls,0);assert.equal(plan.stepCount,3);assert.equal(plan.sectionCount,5);return false;}});
  assert.equal(result.status,"canceled");assert.equal(calls,0);assert.equal(getGenerateDeckSession(),null);
});
test("Automatic stays one call with no multi-step progress or whole-source claim for a large source",async()=>{
  const progress:unknown[]=[];
  const result=await runGenerateDeckFlow(source,options,scope,{type:"automatic"},{onProgress:p=>progress.push(p),onPlanReady:async plan=>{assert.equal(plan.stepCount,1);return true;}});
  assert.equal(result.status,"ready");assert.equal(calls,1);assert.deepEqual(progress,[]);
  assert.equal(getGenerateDeckSession()!.coverage.fullSourceIncluded,false);
});
test("small restrictive scope stays one call",async()=>{
  content={...content,chunks:content.chunks.slice(0,1)};
  assert.equal((await runGenerateDeckFlow(source,options,scope,{type:"entireSource"})).status,"ready");assert.equal(calls,1);
});
test("late cancellation cannot publish review or leave the earlier draft session",async()=>{
  await runGenerateDeckFlow(source,options,scope);
  assert.ok(getGenerateDeckSession());let canceled=false;
  const result=await runGenerateDeckFlow(source,options,scope,{type:"entireSource"},{isCanceled:()=>canceled,onProgress:p=>{if(p.phase==="preparingReview")canceled=true;}});
  assert.equal(result.status,"canceled");assert.equal(getGenerateDeckSession(),null);
});
test("navigation cancellation while preparing prevents any provider call",async()=>{
  let release!:()=>void;gate=new Promise<void>(resolve=>{release=resolve;});let canceled=false;
  const pending=runGenerateDeckFlow(source,options,scope,{type:"entireSource"},{isCanceled:()=>canceled});
  canceled=true;release();assert.equal((await pending).status,"canceled");assert.equal(calls,0);assert.equal(getGenerateDeckSession(),null);
});
test("successful full selection publishes only after every sequential step",async()=>{
  const result=await runGenerateDeckFlow(source,options,scope,{type:"entireSource"});
  assert.equal(result.status,"ready");assert.equal(calls,3);assert.equal(getGenerateDeckSession()!.coverage.fullSourceIncluded,true);
  assert.equal(getGenerateDeckSession()!.generatedCardCount,3); // processed is not saved-card coverage
});
test("a structureNode generation records scopeType/structureNodeType on the session, never a nodeId or title",async()=>{
  const {extractSourceStructure}=await import("../../sourceStructure");
  content={sourceId:"s",sourceType:"docx",title:"Source",contentKind:"structured-text",metadata:{},normalizationVersion:1,extraction:{status:"ready",adapter:"docx-v1"},
    chunks:[{id:"h0",index:0,text:"IAM",approxSize:3,provenance:{headingLevel:1},blockType:"heading"},
      {id:"c0",index:1,text:"IAM body text",approxSize:13,provenance:{}}]};
  const structure=extractSourceStructure(content);
  const nodeId=structure.nodes[0].id;
  const result=await runGenerateDeckFlow(source,options,scope,{type:"structureNode",nodeId,structureSnapshot:structure});
  assert.equal(result.status,"ready");
  assert.equal(getGenerateDeckSession()!.scopeType,"structureNode");
  assert.equal(getGenerateDeckSession()!.structureNodeType,"heading");
});
test("a stale structureNode selection is rejected as a scope-error, never silently falling back to Automatic",async()=>{
  const {extractSourceStructure}=await import("../../sourceStructure");
  content={sourceId:"s",sourceType:"docx",title:"Source",contentKind:"structured-text",metadata:{},normalizationVersion:1,extraction:{status:"ready",adapter:"docx-v1"},
    chunks:[{id:"h0",index:0,text:"IAM",approxSize:3,provenance:{headingLevel:1},blockType:"heading"}]};
  const staleStructure=extractSourceStructure(content);
  // The source changes AFTER the snapshot was captured (e.g. re-attached) — the fresh
  // normalization runGenerateDeckFlow re-derives no longer matches the stale snapshot.
  content={...content,chunks:[{id:"h0b",index:0,text:"Changed",approxSize:7,provenance:{headingLevel:1},blockType:"heading"}]};
  const result=await runGenerateDeckFlow(source,options,scope,{type:"structureNode",nodeId:staleStructure.nodes[0].id,structureSnapshot:staleStructure});
  assert.deepEqual(result,{status:"scope-error",code:"structure-node-stale"});
  assert.equal(getGenerateDeckSession(),null);
});
