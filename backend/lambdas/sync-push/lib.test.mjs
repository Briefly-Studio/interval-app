// Focused unit tests for backend/lambdas/sync-push/lib.mjs — the pure request/change/outcome
// logic that sits under the sync-push handler. Run with `npm run test:sync` (Node's built-in
// test runner; no framework, no dependency). Excluded from the deployed Lambda package (see
// infra/lib/interval-sync-stack.ts's syncAssetExclude).

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CHANGES_PER_PUSH,
  PUSH_CONCURRENCY,
  chunk,
  classifyChange,
  decidePushOutcome,
  getUserSub,
  makeChangeKey,
  validatePushRequest,
} from "./lib.mjs";
import {
  PUSH_BATCH_SIZE,
  ackCount,
  isAcked,
  parseAckList,
  partitionPushChanges,
  pushBatchesSequentially,
} from "../../../src/cloud/sync/pushHelpers.mjs";

const validChange = (over = {}) => ({
  id: "deck-1",
  entity: "deck",
  op: "upsert",
  ts: "2026-08-31T00:00:00.000Z",
  record: { id: "deck-1", rev: 3, updatedAt: "2026-08-31T00:00:00.000Z" },
  ...over,
});

test("validatePushRequest accepts a well-formed small request", () => {
  const r = validatePushRequest({ deviceId: "dev-abc", changes: [validChange(), validChange({ id: "deck-2" })] });
  assert.equal(r.ok, true);
  assert.equal(r.deviceId, "dev-abc");
  assert.equal(r.changes.length, 2);
});

test("validatePushRequest accepts an empty changes array", () => {
  const r = validatePushRequest({ deviceId: "dev-abc", changes: [] });
  assert.equal(r.ok, true);
});

test("validatePushRequest rejects a missing deviceId with 400", () => {
  const r = validatePushRequest({ changes: [] });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test("validatePushRequest rejects a non-array changes with 400", () => {
  const r = validatePushRequest({ deviceId: "dev-abc", changes: "nope" });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test("validatePushRequest rejects an over-cap change count with a deterministic 413", () => {
  const changes = Array.from({ length: MAX_CHANGES_PER_PUSH + 1 }, (_, i) => validChange({ id: `d${i}` }));
  const r = validatePushRequest({ deviceId: "dev-abc", changes });
  assert.equal(r.ok, false);
  assert.equal(r.status, 413);
  assert.equal(r.limit, MAX_CHANGES_PER_PUSH);
  assert.equal(r.received, MAX_CHANGES_PER_PUSH + 1);
});

test("validatePushRequest allows exactly the cap", () => {
  const changes = Array.from({ length: MAX_CHANGES_PER_PUSH }, (_, i) => validChange({ id: `d${i}` }));
  assert.equal(validatePushRequest({ deviceId: "dev-abc", changes }).ok, true);
});

test("classifyChange extracts fields and the incoming revision", () => {
  const c = classifyChange(validChange());
  assert.equal(c.ok, true);
  assert.equal(c.id, "deck-1");
  assert.equal(c.entity, "deck");
  assert.equal(c.op, "upsert");
  assert.equal(c.incomingRev, 3);
});

test("classifyChange rejects a change missing id/entity/op/ts as invalid_change_shape, still carrying entity/id when present", () => {
  for (const missing of ["id", "entity", "op", "ts"]) {
    const bad = validChange();
    delete bad[missing];
    const c = classifyChange(bad);
    assert.equal(c.ok, false, `missing ${missing}`);
    assert.equal(c.reason, "invalid_change_shape");
    // entity/id are always present on the result so the response can key the rejection.
    assert.equal(typeof c.entity, "string");
    assert.equal(typeof c.id, "string");
    if (missing !== "entity") assert.equal(c.entity, "deck");
    if (missing !== "id") assert.equal(c.id, "deck-1");
  }
});

test("classifyChange treats a missing/non-numeric rev as 0 (oldest), never bypassing the check", () => {
  assert.equal(classifyChange(validChange({ record: { id: "deck-1" } })).incomingRev, 0);
  assert.equal(classifyChange(validChange({ record: { id: "deck-1", rev: "5" } })).incomingRev, 0);
  assert.equal(classifyChange(validChange({ record: { id: "deck-1", rev: NaN } })).incomingRev, 0);
  assert.equal(classifyChange(validChange({ record: null })).incomingRev, 0);
});

test("classifyChange passes a delete op through unchanged (tombstones are ordinary changes)", () => {
  const c = classifyChange(validChange({ op: "delete", record: { id: "deck-1", rev: 5, deletedAt: "2026-08-31T00:00:00.000Z" } }));
  assert.equal(c.ok, true);
  assert.equal(c.op, "delete");
  assert.equal(c.incomingRev, 5);
  assert.equal(makeChangeKey(c, "dev-abc"), "2026-08-31T00:00:00.000Z|dev-abc|deck|deck-1|delete");
});

// The rev conflict check itself lives in the DynamoDB ConditionExpression (integration-level).
// decidePushOutcome covers what the handler does with each of that condition's outcomes:
test("decidePushOutcome: an older-rev push (snapshot condition fails) is rejected, not accepted", () => {
  // handler passes e.name from a ConditionalCheckFailedException on the Records UpdateItem
  const r = decidePushOutcome({ recordUpdated: false, recordError: "ConditionalCheckFailedException" });
  assert.equal(r.status, "rejected");
});

test("decidePushOutcome: an equal-rev retry (snapshot condition passes, log row already there) is accepted", () => {
  const r = decidePushOutcome({ recordUpdated: true, changelogDuplicate: true });
  assert.equal(r.status, "accepted");
});

test("makeChangeKey is deterministic and delimited", () => {
  const c = classifyChange(validChange());
  const k1 = makeChangeKey(c, "dev-abc");
  const k2 = makeChangeKey(c, "dev-abc");
  assert.equal(k1, k2);
  assert.equal(k1, "2026-08-31T00:00:00.000Z|dev-abc|deck|deck-1|upsert");
});

test("decidePushOutcome: a record is accepted only when the snapshot updated AND the log row is present", () => {
  assert.deepEqual(decidePushOutcome({ recordUpdated: true, changelogWritten: true }), { status: "accepted" });
  assert.deepEqual(decidePushOutcome({ recordUpdated: true, changelogDuplicate: true }), { status: "accepted" });
});

test("decidePushOutcome: a failed snapshot update is rejected with its error name", () => {
  const r = decidePushOutcome({ recordUpdated: false, recordError: "ConditionalCheckFailedException" });
  assert.equal(r.status, "rejected");
  assert.equal(r.reason, "ConditionalCheckFailedException");
});

test("decidePushOutcome: snapshot updated but a real change-log write failure is NOT acknowledged (torn state → retry)", () => {
  const r = decidePushOutcome({ recordUpdated: true, changelogError: "ProvisionedThroughputExceededException" });
  assert.equal(r.status, "rejected");
  assert.match(r.reason, /^changelog_write_failed:/);
});

test("chunk splits in order and preserves every element", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 10), []);
  assert.deepEqual(chunk([1, 2, 3], 0), [[1, 2, 3]]);
  const big = Array.from({ length: 45 }, (_, i) => i);
  const batches = chunk(big, PUSH_CONCURRENCY);
  assert.equal(batches.flat().length, 45);
  assert.deepEqual(batches.flat(), big);
  assert.ok(batches.every((b) => b.length <= PUSH_CONCURRENCY));
});

test("getUserSub reads v2 JWT claims, v1 claims, loose sub, else null", () => {
  assert.equal(getUserSub({ requestContext: { authorizer: { jwt: { claims: { sub: "s2" } } } } }), "s2");
  assert.equal(getUserSub({ requestContext: { authorizer: { claims: { sub: "s1" } } } }), "s1");
  assert.equal(getUserSub({ requestContext: { authorizer: { sub: "s0" } } }), "s0");
  assert.equal(getUserSub({}), null);
  assert.equal(getUserSub({ requestContext: { authorizer: { jwt: { claims: { sub: "" } } } } }), null);
});

// ---------------------------------------------------------------------------
// Client push helpers (src/cloud/sync/pushHelpers.mjs) — audit findings 1 & 2
// ---------------------------------------------------------------------------

test("client PUSH_BATCH_SIZE never exceeds the server MAX_CHANGES_PER_PUSH (parity)", () => {
  assert.ok(
    PUSH_BATCH_SIZE <= MAX_CHANGES_PER_PUSH,
    `client PUSH_BATCH_SIZE=${PUSH_BATCH_SIZE} must be <= server MAX_CHANGES_PER_PUSH=${MAX_CHANGES_PER_PUSH}`
  );
});

test("partitionPushChanges: batch counts and total preservation for the boundary sizes", () => {
  const cases = [
    [0, []],
    [1, [1]],
    [499, [499]],
    [500, [500]],
    [501, [500, 1]],
    [1000, [500, 500]],
    [1200, [500, 500, 200]],
  ];
  for (const [n, expectedSizes] of cases) {
    const changes = Array.from({ length: n }, (_, i) => ({ id: `c${i}` }));
    const batches = partitionPushChanges(changes);
    assert.deepEqual(batches.map((b) => b.length), expectedSizes, `n=${n}`);
    assert.deepEqual(batches.flat(), changes, `n=${n} preserves order and every element`);
    assert.ok(batches.every((b) => b.length <= PUSH_BATCH_SIZE), `n=${n} no batch over the cap`);
  }
});

test("partitionPushChanges: an explicit smaller size is honored; a bad size falls back to PUSH_BATCH_SIZE", () => {
  const changes = Array.from({ length: 7 }, (_, i) => i);
  assert.deepEqual(partitionPushChanges(changes, 3).map((b) => b.length), [3, 3, 1]);
  assert.deepEqual(partitionPushChanges(changes, 0).map((b) => b.length), [7]);
  assert.deepEqual(partitionPushChanges(changes, -5).map((b) => b.length), [7]);
});

test("parseAckList: canonical {entity,id} items are grouped by entity; malformed items are dropped", () => {
  const ack = parseAckList([
    { entity: "deck", id: "123" },
    { entity: "card", id: "999" },
    { entity: "card", id: "999" }, // dedupe
    "legacy-bare-string", // dropped — no entity attribution
    { id: "no-entity" }, // dropped
    { entity: "deck" }, // dropped
    null,
  ]);
  assert.equal(ackCount(ack), 2);
  assert.ok(isAcked(ack, "deck", "123"));
  assert.ok(isAcked(ack, "card", "999"));
  assert.equal(isAcked(ack, "card", "123"), false);
  assert.equal(isAcked(ack, "deck", "legacy-bare-string"), false);
});

test("parseAckList: non-array input yields an empty result", () => {
  assert.equal(ackCount(parseAckList(undefined)), 0);
  assert.equal(ackCount(parseAckList("nope")), 0);
  assert.equal(ackCount(parseAckList({ accepted: [] })), 0);
});

test("pushBatchesSequentially: all batches succeed — callback runs once per batch, in order", async () => {
  const seen = [];
  const r = await pushBatchesSequentially([["a"], ["b"], ["c"]], async (batch) => {
    seen.push(batch[0]);
  });
  assert.deepEqual(seen, ["a", "b", "c"]);
  assert.deepEqual(r, { completed: 3, aborted: false });
});

test("pushBatchesSequentially: a batch failure stops the loop — later batches are NEVER sent", async () => {
  const seen = [];
  await assert.rejects(
    pushBatchesSequentially([["b1"], ["b2"], ["b3"]], async (batch) => {
      seen.push(batch[0]);
      if (batch[0] === "b2") throw new Error("HTTP 500 on batch 2");
    }),
    /batch 2/
  );
  assert.deepEqual(seen, ["b1", "b2"]); // b3 never attempted
});

test("pushBatchesSequentially: batch 1 succeeds, batch 2 fails — batch 1's work is already done", async () => {
  const marked = [];
  await assert.rejects(
    pushBatchesSequentially([["b1"], ["b2"], ["b3"]], async (batch) => {
      if (batch[0] === "b1") {
        marked.push("b1-clean"); // simulates markClean for batch 1
        return;
      }
      throw new Error("network error on batch 2");
    })
  );
  assert.deepEqual(marked, ["b1-clean"]); // persisted; not rolled back
});

test("pushBatchesSequentially: callback returning 'abort' stops cleanly without sending later batches", async () => {
  const seen = [];
  const r = await pushBatchesSequentially([["b1"], ["b2"], ["b3"]], async (batch) => {
    seen.push(batch[0]);
    if (batch[0] === "b2") return "abort";
  });
  assert.deepEqual(seen, ["b1", "b2"]);
  assert.deepEqual(r, { completed: 1, aborted: true }); // b1 completed, b2 aborted, b3 not sent
});

test("cross-entity: server accepts deck:123 and rejects card:123 — only the deck is acknowledged", () => {
  // Mirrors SyncService's acknowledgedFor() targeting.
  const outgoing = [
    { entity: "deck", id: "123", record: { rev: 4 } },
    { entity: "card", id: "123", record: { rev: 2 } },
  ];
  const accepted = parseAckList([{ entity: "deck", id: "123" }]);
  const rejected = parseAckList([{ entity: "card", id: "123", reason: "ConditionalCheckFailedException" }]);

  const ackedFor = (entity) =>
    outgoing.filter((c) => c.entity === entity && isAcked(accepted, entity, c.id)).map((c) => c.id);

  assert.deepEqual(ackedFor("deck"), ["123"]);
  assert.deepEqual(ackedFor("card"), []); // NOT marked clean despite sharing the id
  assert.ok(isAcked(rejected, "card", "123"));
  assert.equal(isAcked(rejected, "deck", "123"), false);
});
