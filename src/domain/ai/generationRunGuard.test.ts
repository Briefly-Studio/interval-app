import assert from "node:assert/strict";
import { test } from "node:test";
import { createGenerationRunGuard } from "./generationRunGuard";

test("double Generate and a second route cannot start while consent or a request is pending",()=>{
  const guard=createGenerationRunGuard(),run=guard.start()!;
  assert.equal(guard.start(),null);
  run.cancel();run.cancel();assert.equal(run.isCanceled(),true);
  assert.equal(guard.start(),null); // in-flight request still holds the lease
  run.finish();const next=guard.start()!;assert.ok(next);
  run.finish();assert.equal(guard.start(),null); // late cleanup cannot release a newer lease
  next.finish();assert.ok(guard.start());
});

test("blur/background invalidation stays canceled on foreground, until a new explicit attempt",()=>{
  const guard=createGenerationRunGuard(),run=guard.start()!;
  run.cancel();assert.equal(run.isCanceled(),true);
  assert.equal(guard.start(),null);
  run.finish();const next=guard.start()!;assert.equal(next.isCanceled(),false);next.finish();
});
