import assert from "node:assert/strict";
import { test } from "node:test";
import { approveGenerationPlan, generationProgressCopy, multiBatchFailureCopy, needsGenerationConfirmation,
  planTooLargeCopy, plannedDailyRequests, summarizeGenerationPlan } from "./generationPresentation";
import { planGenerationBatches } from "./batchPlanning";
import { createGenerationRunGuard } from "./generationRunGuard";
import { pluralize, translate } from "../../i18n/translate";
import { SUPPORTED_LOCALES } from "../../i18n/types";
import type { NormalizedChunk } from "../normalization/types";

const chunks:NormalizedChunk[]=Array.from({length:4},(_,i)=>({id:`c${i}`,index:i,text:"Content",approxSize:100,provenance:{page:i+1}}));
test("one/two steps are lightweight; 3+ require explicit confirmation",()=>{
  for(const n of [1,2])assert.equal(needsGenerationConfirmation(n),false);
  for(const n of [3,4,8])assert.equal(needsGenerationConfirmation(n),true);
});
test("summary counts only selected sections and genuine pages with text",()=>{
  const plan=planGenerationBatches(chunks.slice(1),{charBudget:100});
  assert.deepEqual(summarizeGenerationPlan(chunks,plan),{stepCount:3,sectionCount:3,pagesWithText:3});
  assert.deepEqual(summarizeGenerationPlan(chunks.map(c=>({...c,provenance:{}})),plan),{stepCount:3,sectionCount:3});
  assert.equal(plannedDailyRequests({stepCount:4,sectionCount:193},true),4);
  assert.equal(plannedDailyRequests({stepCount:4,sectionCount:193},false),null);
});
test("progress is real step text, with explicit preparation/combine/review/cancel states",()=>{
  assert.deepEqual(generationProgressCopy({phase:"batch",batchIndex:2,batchCount:5},false),{key:"generateDeck.generatingBatchBody",params:{current:2,total:5}});
  for(const phase of ["preparing","combining","preparingReview"] as const)assert.ok(generationProgressCopy({phase},false).key);
  assert.equal(generationProgressCopy(undefined,true).key,"generateDeck.multi.cancelingBody");
  assert.equal(generationProgressCopy(undefined,false).key,"generateDeck.generatingBody");
});
test("scope-aware limits and mid-run daily limit have distinct recovery copy",()=>{
  assert.equal(planTooLargeCopy("uncovered"),"generateDeck.multi.tooMuchUncovered");
  assert.equal(planTooLargeCopy("pageRange"),"generateDeck.scope.error.planTooLarge");
  assert.equal(multiBatchFailureCopy("daily-limit-reached"),"generateDeck.multi.dailyLimit");
  assert.equal(multiBatchFailureCopy("provider-unavailable"),"generateDeck.multi.failed");
});
test("consent precedes confirmation; either rejection uses no generation calls",async()=>{
  for(const cancelAt of ["consent","confirm",null]){
    const events:string[]=[];const run=createGenerationRunGuard().start()!;
    const accepted=await approveGenerationPlan({needsConsent:true,stepCount:4,isCanceled:run.isCanceled,
      consent:async()=>{events.push("consent");return cancelAt!=="consent";},confirm:async()=>{events.push("confirm");return cancelAt!=="confirm";}});
    if(accepted)events.push("provider");
    assert.deepEqual(events,cancelAt==="consent"?["consent"]:cancelAt==="confirm"?["consent","confirm"]:["consent","confirm","provider"]);
    run.finish();
  }
});
test("accepted consent is not repeated and 1/2-step plans do not confirm",async()=>{
  for(const stepCount of [1,2]){
    const events:string[]=[];
    assert.equal(await approveGenerationPlan({needsConsent:false,stepCount,isCanceled:()=>false,consent:async()=>{events.push("consent");return true;},confirm:async()=>{events.push("confirm");return true;}}),true);
    assert.deepEqual(events,[]);
  }
});
test("cancel during consent prevents confirmation and publication",async()=>{
  let canceled=false,confirmed=false;
  const result=await approveGenerationPlan({needsConsent:true,stepCount:4,isCanceled:()=>canceled,
    consent:async()=>{canceled=true;return true;},confirm:async()=>{confirmed=true;return true;}});
  assert.equal(result,false);assert.equal(confirmed,false);
});
test("all 13 locales resolve progress, planning, recovery and shortfall without placeholders",()=>{
  for(const locale of SUPPORTED_LOCALES){
    for(const key of ["planTitle","confirmTitle","preparing","preparingReview","cancelingBody","canceledTitle","canceledBody","cancelRequestNote","dailyLimit","failed","retry","retryMock","tooMuchUncovered"] as const){
      const value=translate(locale,`generateDeck.multi.${key}`);assert.ok(value&&!value.includes("generateDeck.")&&!value.includes("{{"));
    }
    for(const n of [1,2,3,5,8])for(const key of ["sections","pages","steps","quota"] as const){
      const value=pluralize(locale,`generateDeck.multi.${key}`,n);assert.ok(value&&!value.includes("generateDeck.")&&!value.includes("{{"));
    }
    const label=translate(locale,"generateDeck.generatingBatchBody",{current:2,total:5});assert.ok(label.includes("2")&&label.includes("5"));
  }
});
