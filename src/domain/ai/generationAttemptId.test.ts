import assert from "node:assert/strict";
import test from "node:test";

import { generateAttemptId } from "./generationAttemptId";

test("generateAttemptId: v4-shaped hex string with hyphens in the expected positions", () => {
  const id = generateAttemptId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("generateAttemptId: never collides across a large sample (OS/Web Crypto UUIDs)", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) seen.add(generateAttemptId());
  assert.equal(seen.size, 2000);
});

test("generateAttemptId: contains no source/card content — it's pure random hex, nothing derived from any input", () => {
  // No input is even accepted — the function takes zero parameters, so there is nothing it
  // could leak. This test exists to document that invariant explicitly.
  assert.equal(generateAttemptId.length, 0);
});
