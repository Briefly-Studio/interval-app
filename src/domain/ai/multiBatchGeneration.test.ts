import { test } from "node:test";
import assert from "node:assert/strict";

import type { ModelProvider, ModelProviderInput, ModelProviderOutcome } from "./aiService";
import type { BatchPlan } from "./batchPlanning";
import { planGenerationBatches } from "./batchPlanning";
import { DEFAULT_GENERATION_OPTIONS } from "./generationOptions";
import { runMultiBatchGeneration, type MultiBatchProgress } from "./multiBatchGeneration";
import type { NormalizedChunk, NormalizedSourceContent } from "../normalization/types";

function makeChunk(id: string, index: number): NormalizedChunk {
  return { id, index, text: `Chunk ${id} content`, approxSize: 100, provenance: {} };
}

function makeContent(chunks: NormalizedChunk[]): NormalizedSourceContent {
  return {
    sourceId: "src-1",
    sourceType: "text",
    title: "Test Source",
    contentKind: "text",
    chunks,
    metadata: {},
    extraction: { status: "ready", adapter: "text-v1" },
    normalizationVersion: 1,
  };
}

function planFor(chunks: NormalizedChunk[], charBudget = 1000): BatchPlan & { status: "ok" } {
  const plan = planGenerationBatches(chunks, { charBudget });
  if (plan.status !== "ok") throw new Error("test setup produced an unplannable fixture");
  return plan;
}

/** One card per chunk in the given context, capped at requestedCardCount — deterministic,
 * mirrors mockProvider.ts's own honesty (never fabricates beyond what it was given). */
function succeedHandler(input: ModelProviderInput): ModelProviderOutcome {
  const cards = input.context.chunks.slice(0, input.request.requestedCardCount).map((chunk, i) => ({
    front: `Q${input.context.chunks[0]?.id}-${i}`,
    back: `A${i}`,
    sourceChunkIds: [chunk.id],
  }));
  return { status: "ok", raw: { title: "Generated", cards } };
}

function makeProvider(handlers: ((input: ModelProviderInput) => ModelProviderOutcome)[]): ModelProvider & { callCount: () => number } {
  let calls = 0;
  return {
    id: "fake-provider",
    async generate(input) {
      const handler = handlers[Math.min(calls, handlers.length - 1)];
      calls++;
      return handler(input);
    },
    callCount: () => calls,
  };
}

test("all batches succeed: combined draft has one card per chunk, in order, authoritative status derived from the total", () => {
  return (async () => {
    const chunks = Array.from({ length: 6 }, (_, i) => makeChunk(`c${i}`, i));
    const content = makeContent(chunks);
    const plan = planFor(chunks, 200); // 100 chars/chunk -> 2 per batch -> 3 batches
    const provider = makeProvider([succeedHandler, succeedHandler, succeedHandler]);

    const outcome = await runMultiBatchGeneration({
      provider,
      normalizedContent: content,
      sourceTitle: "Test Source",
      options: { ...DEFAULT_GENERATION_OPTIONS, cardCount: "medium" },
      plan,
    });

    assert.equal(outcome.status, "ready");
    if (outcome.status === "ready") {
      assert.equal(outcome.draft.cards.length, 6);
      assert.equal(outcome.draft.generation.resultingCardCount, 6);
      assert.equal(outcome.draft.generation.selectedChunkIds.length, 6);
      assert.equal(provider.callCount(), 3);
    }
  })();
});

test("second batch fails: orchestration fails, first batch's work is never saved/returned as success", () => {
  return (async () => {
    const chunks = Array.from({ length: 6 }, (_, i) => makeChunk(`c${i}`, i));
    const content = makeContent(chunks);
    const plan = planFor(chunks, 200); // 3 batches
    const failing = (): ModelProviderOutcome => ({ status: "error", error: { code: "provider-unavailable", message: "down" } });
    const provider = makeProvider([succeedHandler, failing, succeedHandler]);

    const outcome = await runMultiBatchGeneration({
      provider,
      normalizedContent: content,
      sourceTitle: "Test Source",
      options: { ...DEFAULT_GENERATION_OPTIONS, cardCount: "medium" },
      plan,
    });

    assert.equal(outcome.status, "error");
    if (outcome.status === "error") {
      assert.equal(outcome.error.code, "provider-unavailable");
      assert.equal(outcome.failedAtBatchIndex, 1);
      assert.equal(outcome.completedBatchCount, 1);
    }
    // The third batch must never have been reached once the second failed.
    assert.equal(provider.callCount(), 2);
  })();
});

test("last batch fails: still an honest failure, not presented as whole-source success", () => {
  return (async () => {
    const chunks = Array.from({ length: 6 }, (_, i) => makeChunk(`c${i}`, i));
    const content = makeContent(chunks);
    const plan = planFor(chunks, 200);
    const failing = (): ModelProviderOutcome => ({ status: "error", error: { code: "daily-limit-reached", message: "quota" } });
    const provider = makeProvider([succeedHandler, succeedHandler, failing]);

    const outcome = await runMultiBatchGeneration({
      provider,
      normalizedContent: content,
      sourceTitle: "Test Source",
      options: { ...DEFAULT_GENERATION_OPTIONS, cardCount: "medium" },
      plan,
    });

    assert.equal(outcome.status, "error");
    if (outcome.status === "error") {
      assert.equal(outcome.error.code, "daily-limit-reached");
      assert.equal(outcome.failedAtBatchIndex, 2);
      assert.equal(outcome.completedBatchCount, 2);
    }
  })();
});

test("cancellation before the first batch starts: zero provider calls made", () => {
  return (async () => {
    const chunks = Array.from({ length: 4 }, (_, i) => makeChunk(`c${i}`, i));
    const content = makeContent(chunks);
    const plan = planFor(chunks, 200);
    const provider = makeProvider([succeedHandler, succeedHandler]);

    const outcome = await runMultiBatchGeneration({
      provider,
      normalizedContent: content,
      sourceTitle: "Test Source",
      options: { ...DEFAULT_GENERATION_OPTIONS, cardCount: "medium" },
      plan,
      isCanceled: () => true,
    });

    assert.equal(outcome.status, "canceled");
    if (outcome.status === "canceled") {
      assert.equal(outcome.completedBatchCount, 0);
      assert.equal(typeof outcome.totalDurationMs, "number");
    }
    assert.equal(provider.callCount(), 0);
  })();
});

test("cancellation between batches: already-completed batches' work is discarded, no further batches start", () => {
  return (async () => {
    const chunks = Array.from({ length: 6 }, (_, i) => makeChunk(`c${i}`, i));
    const content = makeContent(chunks);
    const plan = planFor(chunks, 200); // 3 batches
    const provider = makeProvider([succeedHandler, succeedHandler, succeedHandler]);

    // isCanceled is checked against the provider's OWN call count directly (not derived from
    // onProgress timing, which fires BEFORE each batch's call, not after) — this is what makes
    // "canceled after exactly 1 completed batch, before the 2nd starts" an exact, non-flaky
    // condition rather than one that depends on callback ordering.
    const outcome = await runMultiBatchGeneration({
      provider,
      normalizedContent: content,
      sourceTitle: "Test Source",
      options: { ...DEFAULT_GENERATION_OPTIONS, cardCount: "medium" },
      plan,
      isCanceled: () => provider.callCount() >= 1,
    });

    assert.equal(outcome.status, "canceled");
    // Canceled after batch 1 completed but before batch 2 started.
    assert.equal(provider.callCount(), 1);
  })();
});

test("progress callback reports preparing, each batch in order, then combining", () => {
  return (async () => {
    const chunks = Array.from({ length: 4 }, (_, i) => makeChunk(`c${i}`, i));
    const content = makeContent(chunks);
    const plan = planFor(chunks, 200); // 2 batches
    const provider = makeProvider([succeedHandler, succeedHandler]);
    const progress: MultiBatchProgress[] = [];

    await runMultiBatchGeneration({
      provider,
      normalizedContent: content,
      sourceTitle: "Test Source",
      options: { ...DEFAULT_GENERATION_OPTIONS, cardCount: "medium" },
      plan,
      onProgress: (p) => progress.push(p),
    });

    assert.deepEqual(progress, [
      { phase: "preparing" },
      { phase: "batch", batchIndex: 1, batchCount: 2 },
      { phase: "batch", batchIndex: 2, batchCount: 2 },
      { phase: "combining" },
      { phase: "preparingReview" },
    ]);
  })();
});

test("aggregate status is insufficient-distinct-content when the combined total falls short of the ORIGINAL target minimum, even though every individual batch 'succeeded'", () => {
  return (async () => {
    // Medium: targetMinimum 10, ceiling 15. 3 sparse batches each producing only 1 card -> 3 total.
    const chunks = Array.from({ length: 3 }, (_, i) => makeChunk(`c${i}`, i));
    const content = makeContent(chunks);
    const plan = planFor(chunks, 100); // 1 chunk per batch -> 3 batches
    const sparseHandler = (input: ModelProviderInput): ModelProviderOutcome => ({
      status: "ok",
      raw: { title: "Generated", cards: [{ front: `Q-${input.context.chunks[0].id}`, back: "A", sourceChunkIds: [input.context.chunks[0].id] }] },
    });
    const provider = makeProvider([sparseHandler, sparseHandler, sparseHandler]);

    const outcome = await runMultiBatchGeneration({
      provider,
      normalizedContent: content,
      sourceTitle: "Test Source",
      options: { ...DEFAULT_GENERATION_OPTIONS, cardCount: "medium" },
      plan,
    });

    assert.equal(outcome.status, "ready");
    if (outcome.status === "ready") {
      assert.equal(outcome.draft.generation.resultingCardCount, 3);
      assert.equal(outcome.draft.generation.targetMinimumCardCount, 10);
      assert.equal(outcome.draft.generation.generationStatus, "insufficient-distinct-content");
    }
  })();
});

test("aggregate status is complete when the combined total meets the ORIGINAL target minimum, drawn across multiple batches", () => {
  return (async () => {
    // Small: targetMinimum 5, ceiling 8. 4 batches each contributing >=1 card, totaling >= 5.
    const chunks = Array.from({ length: 4 }, (_, i) => makeChunk(`c${i}`, i));
    const content = makeContent(chunks);
    const plan = planFor(chunks, 100); // 4 batches of 1 chunk each
    const twoCardHandler = (input: ModelProviderInput): ModelProviderOutcome => ({
      status: "ok",
      raw: {
        title: "Generated",
        cards: [
          { front: `Q1-${input.context.chunks[0].id}`, back: "A", sourceChunkIds: [input.context.chunks[0].id] },
          { front: `Q2-${input.context.chunks[0].id}`, back: "A", sourceChunkIds: [input.context.chunks[0].id] },
        ],
      },
    });
    const provider = makeProvider([twoCardHandler, twoCardHandler, twoCardHandler, twoCardHandler]);

    const outcome = await runMultiBatchGeneration({
      provider,
      normalizedContent: content,
      sourceTitle: "Test Source",
      options: { ...DEFAULT_GENERATION_OPTIONS, cardCount: "small" },
      plan,
    });

    assert.equal(outcome.status, "ready");
    if (outcome.status === "ready") {
      assert.ok(outcome.draft.generation.resultingCardCount >= 5);
      assert.equal(outcome.draft.generation.generationStatus, "complete");
    }
  })();
});

test("exact duplicates across batches are removed from the combined draft, with unioned provenance", () => {
  return (async () => {
    const chunks = Array.from({ length: 4 }, (_, i) => makeChunk(`c${i}`, i));
    const content = makeContent(chunks);
    const plan = planFor(chunks, 200); // 2 batches of 2 chunks each
    const duplicateHandler = (input: ModelProviderInput): ModelProviderOutcome => ({
      status: "ok",
      raw: {
        title: "Generated",
        // Every batch produces the exact SAME card, from its own chunks — a worst-case
        // cross-batch duplicate scenario.
        cards: [{ front: "Same question", back: "Same answer", sourceChunkIds: input.context.chunks.map((c) => c.id) }],
      },
    });
    const provider = makeProvider([duplicateHandler, duplicateHandler]);

    const outcome = await runMultiBatchGeneration({
      provider,
      normalizedContent: content,
      sourceTitle: "Test Source",
      options: { ...DEFAULT_GENERATION_OPTIONS, cardCount: "medium" },
      plan,
    });

    assert.equal(outcome.status, "ready");
    if (outcome.status === "ready") {
      assert.equal(outcome.draft.cards.length, 1);
      assert.equal(outcome.draft.generation.resultingCardCount, 1);
      assert.equal(outcome.draft.generation.generationStatus, "insufficient-distinct-content");
      // Provenance from both batches' identical cards is unioned, never silently dropped.
      assert.deepEqual(new Set(outcome.draft.cards[0].sourceChunkIds), new Set(["c0", "c1", "c2", "c3"]));
    }
  })();
});

test("output card ordering is stable (first-seen/source order), not re-sorted or shuffled", () => {
  return (async () => {
    const chunks = Array.from({ length: 4 }, (_, i) => makeChunk(`c${i}`, i));
    const content = makeContent(chunks);
    const plan = planFor(chunks, 100); // 4 batches, 1 chunk each
    const provider = makeProvider([succeedHandler, succeedHandler, succeedHandler, succeedHandler]);

    const outcome = await runMultiBatchGeneration({
      provider,
      normalizedContent: content,
      sourceTitle: "Test Source",
      options: { ...DEFAULT_GENERATION_OPTIONS, cardCount: "medium" },
      plan,
    });

    assert.equal(outcome.status, "ready");
    if (outcome.status === "ready") {
      const citedChunks = outcome.draft.cards.map((c) => c.sourceChunkIds[0]);
      assert.deepEqual(citedChunks, ["c0", "c1", "c2", "c3"]);
    }
  })();
});

test("fullSourceIncluded is true only when every chunk of the TRUE full source was considered across all batches", () => {
  return (async () => {
    // Only 3 of 5 total source chunks are in this plan (e.g. a page-range selection) — even
    // though every chunk IN the plan is fully processed, fullSourceIncluded must stay false,
    // because it is relative to the whole normalized source, not just the selected scope.
    const allChunks = Array.from({ length: 5 }, (_, i) => makeChunk(`c${i}`, i));
    const content = makeContent(allChunks);
    const selectedChunks = allChunks.slice(0, 3);
    const plan = planFor(selectedChunks, 400); // fits in 1 batch (3 * 100 <= 400)
    const provider = makeProvider([succeedHandler]);

    const outcome = await runMultiBatchGeneration({
      provider,
      normalizedContent: content,
      sourceTitle: "Test Source",
      options: { ...DEFAULT_GENERATION_OPTIONS, cardCount: "medium" },
      plan,
    });

    assert.equal(outcome.status, "ready");
    if (outcome.status === "ready") {
      assert.equal(outcome.draft.generation.fullSourceIncluded, false);
      assert.equal(outcome.draft.generation.excludedChunkCount, 2);
    }
  })();
});

test("fullSourceIncluded is true when the plan covers every chunk of the full source across all batches", () => {
  return (async () => {
    const chunks = Array.from({ length: 6 }, (_, i) => makeChunk(`c${i}`, i));
    const content = makeContent(chunks);
    const plan = planFor(chunks, 200); // 3 batches, but covers everything
    const provider = makeProvider([succeedHandler, succeedHandler, succeedHandler]);

    const outcome = await runMultiBatchGeneration({
      provider,
      normalizedContent: content,
      sourceTitle: "Test Source",
      options: { ...DEFAULT_GENERATION_OPTIONS, cardCount: "medium" },
      plan,
    });

    assert.equal(outcome.status, "ready");
    if (outcome.status === "ready") {
      assert.equal(outcome.draft.generation.fullSourceIncluded, true);
      assert.equal(outcome.draft.generation.excludedChunkCount, 0);
    }
  })();
});

test("batches are run strictly sequentially, never concurrently", () => {
  return (async () => {
    const chunks = Array.from({ length: 4 }, (_, i) => makeChunk(`c${i}`, i));
    const content = makeContent(chunks);
    const plan = planFor(chunks, 200); // 2 batches
    let inFlight = 0;
    let maxConcurrent = 0;
    const trackingProvider: ModelProvider = {
      id: "tracking",
      async generate(input) {
        inFlight++;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return succeedHandler(input);
      },
    };

    await runMultiBatchGeneration({
      provider: trackingProvider,
      normalizedContent: content,
      sourceTitle: "Test Source",
      options: { ...DEFAULT_GENERATION_OPTIONS, cardCount: "medium" },
      plan,
    });

    assert.equal(maxConcurrent, 1);
  })();
});

// Deferred requests make cancellation order deterministic without timers or live AI usage.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

for (const finalIndex of [0, 1, 2]) {
  test(`cancel during request ${finalIndex + 1}, including final request, never returns a draft`, async () => {
    const chunks = Array.from({length:3},(_,i)=>makeChunk(`c${i}`,i));
    const request = deferred<ModelProviderOutcome>(), started = deferred<void>();
    let calls = 0, canceled = false;
    const provider: ModelProvider = {id:"deferred", async generate(input) {
      const index = calls++;
      if (index === finalIndex) { started.resolve(); return request.promise; }
      return succeedHandler(input);
    }};
    const pending = runMultiBatchGeneration({provider,normalizedContent:makeContent(chunks),sourceTitle:"Source",
      options:DEFAULT_GENERATION_OPTIONS,plan:planFor(chunks,100),isCanceled:()=>canceled});
    await started.promise;
    canceled = true; canceled = true; // repeated native Cancel events are harmless
    request.resolve({status:"ok",raw:{title:"Draft",cards:[{front:"Final",back:"Answer",sourceChunkIds:[`c${finalIndex}`]}]}});
    const outcome = await pending;
    assert.equal(outcome.status,"canceled"); assert.equal(calls,finalIndex+1);
    assert.equal("draft" in outcome,false);
  });
}

for (const phase of ["preparing","batch","combining","preparingReview"] as const) {
  test(`cancellation from ${phase} progress callback wins before dispatch/publication`, async()=>{
    const chunks=[makeChunk("c0",0),makeChunk("c1",1)];
    let canceled=false;
    const provider=makeProvider([succeedHandler]);
    const result=await runMultiBatchGeneration({provider,normalizedContent:makeContent(chunks),sourceTitle:"Source",
      options:DEFAULT_GENERATION_OPTIONS,plan:planFor(chunks,100),isCanceled:()=>canceled,
      onProgress:p=>{if(p.phase===phase)canceled=true;}});
    assert.equal(result.status,"canceled");
    assert.equal(provider.callCount(),phase==="preparing"||phase==="batch"?0:2);
  });
}

test("cancel and provider rejection at the same boundary settles as canceled, not an error",async()=>{
  const chunks=[makeChunk("c0",0),makeChunk("c1",1)];
  let canceled=false;
  const provider:ModelProvider={id:"network",async generate(){canceled=true;throw new Error("private network error");}};
  const outcome=await runMultiBatchGeneration({provider,normalizedContent:makeContent(chunks),sourceTitle:"Source",
    options:DEFAULT_GENERATION_OPTIONS,plan:planFor(chunks,100),isCanceled:()=>canceled});
  assert.equal(outcome.status,"canceled");
  if(outcome.status==="canceled"){assert.equal(outcome.completedBatchCount,0);assert.equal(typeof outcome.totalDurationMs,"number");}
});

for (const code of ["daily-limit-reached","generation-in-progress","provider-unavailable","generation-timeout","validation-failed"] as const) {
  for (const failedAt of [0,1,2]) {
    test(`${code} at step ${failedAt+1} aborts the complete run with exact failure context`,async()=>{
      const chunks=Array.from({length:3},(_,i)=>makeChunk(`c${i}`,i));
      let calls=0;
      const provider:ModelProvider={id:"failure-matrix",async generate(input){
        return calls++===failedAt?{status:"error",error:{code,message:"Safe category"}}:succeedHandler(input);
      }};
      const result=await runMultiBatchGeneration({provider,normalizedContent:makeContent(chunks),sourceTitle:"Source",
        options:DEFAULT_GENERATION_OPTIONS,plan:planFor(chunks,100)});
      assert.equal(result.status,"error");
      if(result.status==="error"){assert.equal(result.error.code,code);assert.equal(result.completedBatchCount,failedAt);}
      assert.equal(calls,failedAt+1); assert.equal("draft" in result,false);
    });
  }
}

test("network loss between steps is sanitized and stops later calls",async()=>{
  const chunks=Array.from({length:3},(_,i)=>makeChunk(`c${i}`,i));let calls=0;
  const provider:ModelProvider={id:"network",async generate(input){if(calls++===1)throw new Error("private-network-message");return succeedHandler(input);}};
  const result=await runMultiBatchGeneration({provider,normalizedContent:makeContent(chunks),sourceTitle:"Source",options:DEFAULT_GENERATION_OPTIONS,plan:planFor(chunks,100)});
  assert.equal(result.status,"error");assert.equal(calls,2);assert.equal(JSON.stringify(result).includes("private-network-message"),false);
});

test("a plan is not proof of processing: context-excluded sections fail instead of claiming whole source",async()=>{
  const chunks=[{...makeChunk("c0",0),approxSize:20_000},{...makeChunk("c1",1),approxSize:10_000}];
  const provider=makeProvider([succeedHandler]);
  const result=await runMultiBatchGeneration({provider,normalizedContent:makeContent(chunks),sourceTitle:"Source",
    options:DEFAULT_GENERATION_OPTIONS,plan:planFor(chunks,40_000)});
  assert.equal(result.status,"error");if(result.status==="error")assert.equal(result.error.code,"context-too-large");
});

test("invalid duplicate/unknown/empty/over-limit plans are rejected before any provider call",async()=>{
  const chunks=[makeChunk("c0",0)]; const valid=planFor(chunks);
  const plans=[{...valid,batches:[]},{...valid,batches:[{index:0,chunkIds:["unknown"],approxChars:1}]},
    {...valid,batches:[{index:0,chunkIds:["c0","c0"],approxChars:1}],totalCandidateChunks:2},
    {...valid,batches:Array.from({length:9},(_,i)=>({index:i,chunkIds:["c0"],approxChars:1}))}];
  for(const plan of plans){const provider=makeProvider([succeedHandler]);
    const result=await runMultiBatchGeneration({provider,normalizedContent:makeContent(chunks),sourceTitle:"Source",options:DEFAULT_GENERATION_OPTIONS,plan});
    assert.equal(result.status,"error");assert.equal(provider.callCount(),0);
  }
});
