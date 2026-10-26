import assert from "node:assert/strict";
import { test } from "node:test";
import { upgradeGeneratedCardProvenance, MAX_PROVENANCE_CHUNK_IDS } from "../../models/generatedCardProvenance";
import { partitionProvenancePushChanges, PROVENANCE_PUSH_BYTE_BUDGET } from "./generatedCardProvenanceSyncPayload";
import type { Change } from "./types";

test("maximum-sized provenance remains below DynamoDB item size and pushes split by bytes/count",()=>{
  const p=upgradeGeneratedCardProvenance({cardId:"c",deckId:"d",sourceId:"s",generatedAt:"2026-01-01T00:00:00.000Z",
    sourceChunkIds:Array.from({length:MAX_PROVENANCE_CHUNK_IDS},(_,i)=>`chunk_${i}`.padEnd(64,"x"))})!;
  assert.ok(Buffer.byteLength(JSON.stringify(p))+2048<400*1024);
  const changes:Change[]=Array.from({length:501},(_,i)=>({entity:"generatedCardProvenance",id:`c${i}`,op:"upsert",record:{...p,id:`c${i}`,cardId:`c${i}`},ts:p.updatedAt}));
  const batches=partitionProvenancePushChanges(changes);
  assert.ok(batches.length>2);assert.deepEqual(batches.flat(),changes);
  for(const batch of batches){assert.ok(batch.length<=500);assert.ok(Buffer.byteLength(JSON.stringify({deviceId:"device",changes:batch}))<PROVENANCE_PUSH_BYTE_BUDGET);}
});
test("non-provenance batches retain count-based behavior; empty input stays empty",()=>{
  assert.deepEqual(partitionProvenancePushChanges([]),[]);
  const p=upgradeGeneratedCardProvenance({cardId:"c",deckId:"d",sourceId:"s",sourceChunkIds:["a"],generatedAt:"2026-01-01T00:00:00.000Z"})!;
  const changes=Array.from({length:501},()=>({entity:"reviewEvent",record:p} as unknown as Change));
  assert.deepEqual(partitionProvenancePushChanges(changes).map(b=>b.length),[500,1]);
});
