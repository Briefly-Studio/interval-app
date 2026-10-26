// Focused unit tests for backend/lambdas/sync-push/lib.mjs — the pure request/change/outcome
// logic that sits under the sync-push handler. Run with `npm run test:sync` (Node's built-in
// test runner; no framework, no dependency). Excluded from the deployed Lambda package (see
// infra/lib/interval-sync-stack.ts's syncAssetExclude).

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CHANGES_PER_PUSH,
  MAX_SEQUENCE_ASSIGNMENT_ATTEMPTS,
  PUSH_CONCURRENCY,
  SEQUENCE_COUNTER_SK,
  appendChangeLogLegacy,
  assignSequenceAndAppendChangeLog,
  buildSequenceTransactItems,
  chunk,
  classifyChange,
  classifySequenceTransactionCancellation,
  decidePushOutcome,
  getUserSub,
  makeChangeKey,
  resolveMaintenanceMode,
  resolveSyncCursorMode,
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
// Sequence assignment — the sync-cursor-hardening root fix (docs/sync-cursor-semantics.md),
// REWORKED to a transactional (TransactWriteItems) design after a pre-founder-QA review found
// the original plain-counter-increment design unsound (see lib.mjs's own header comment for the
// full two-part analysis: GSI eventual consistency AND an independent write-order race).
//
// FakeTransactDdbClient models exactly the atomic-all-or-nothing conditional-write semantics
// DynamoDB actually provides for TransactWriteItems (every item's condition is checked BEFORE any
// write is applied; if any fails, NONE are applied) — not a general DynamoDB emulator, just this
// file's exact usage, same scoping discipline as rateLimiter.test.mjs's own FakeDdbClient.
// ---------------------------------------------------------------------------

class FakeGetCommandCtor {
  constructor(input) {
    this.kind = "get";
    this.input = input;
  }
}
class FakeTransactWriteCommandCtor {
  constructor(input) {
    this.kind = "transact";
    this.input = input;
  }
}

function resolveAttrName(token, names) {
  return token.startsWith("#") ? names?.[token] : token;
}

function evalConditionClause(clause, existing, names, values) {
  const trimmed = clause.trim();
  const notExists = /^attribute_not_exists\((#?\w+)\)$/.exec(trimmed);
  if (notExists) {
    const attr = resolveAttrName(notExists[1], names);
    return existing === undefined || existing[attr] === undefined;
  }
  const eq = /^(#?\w+)\s*=\s*(:\w+)$/.exec(trimmed);
  if (eq) {
    const attr = resolveAttrName(eq[1], names);
    return existing !== undefined && existing[attr] === values?.[eq[2]];
  }
  throw new Error(`fake: unsupported condition clause: ${clause}`);
}

function evalCondition(expr, existing, names, values) {
  if (!expr) return true;
  if (expr.includes(" OR ")) return expr.split(" OR ").some((p) => evalCondition(p, existing, names, values));
  if (expr.includes(" AND ")) return expr.split(" AND ").every((p) => evalCondition(p, existing, names, values));
  return evalConditionClause(expr, existing, names, values);
}

class FakeTransactDdbClient {
  constructor() {
    this.tables = new Map();
  }
  table(name) {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name);
  }
  key(k) {
    return k.SK !== undefined ? `${k.PK}|${k.SK}` : `${k.PK}|seq#${k.seq}`;
  }
  async send(command) {
    const { kind, input } = command;
    if (kind === "get") {
      return { Item: this.table(input.TableName).get(this.key(input.Key)) };
    }
    if (kind === "transact") {
      const checks = input.TransactItems.map((item) => {
        const op = item.Put ? "Put" : "Update";
        const spec = item.Put ?? item.Update;
        const table = this.table(spec.TableName);
        const k = op === "Put" ? this.key(spec.Item) : this.key(spec.Key);
        const existing = table.get(k);
        const passes = evalCondition(spec.ConditionExpression, existing, spec.ExpressionAttributeNames, spec.ExpressionAttributeValues);
        return { op, spec, table, key: k, passes };
      });
      if (checks.some((c) => !c.passes)) {
        const err = new Error("The conditional request failed");
        err.name = "TransactionCanceledException";
        err.CancellationReasons = checks.map((c) => ({ Code: c.passes ? "None" : "ConditionalCheckFailed" }));
        throw err;
      }
      // Atomicity: every condition already passed above — apply all writes now, none individually.
      for (const c of checks) {
        if (c.op === "Put") {
          c.table.set(c.key, { ...c.spec.Item });
        } else {
          const existing = c.table.get(c.key) ?? {};
          const [, placeholder] = /^SET\s+(#\w+)\s*=/.exec(c.spec.UpdateExpression) ?? [];
          const attrName = c.spec.ExpressionAttributeNames?.[placeholder];
          const valuePlaceholder = c.spec.UpdateExpression.split("=")[1].trim();
          const value = c.spec.ExpressionAttributeValues?.[valuePlaceholder];
          c.table.set(c.key, { ...existing, ...c.spec.Key, [attrName]: value });
        }
      }
      return {};
    }
    throw new Error(`unrecognized fake command kind: ${kind}`);
  }
}

function changeFor(id, over = {}) {
  return { id, entity: "card", op: "upsert", ts: "2026-08-31T00:00:00.000Z", record: { id, rev: 1 }, ...over };
}

async function assign(client, { ownerPk = "U#alice", id = "x", deviceId = "dev-A", maxAttempts } = {}) {
  const c = changeFor(id);
  const changeKey = makeChangeKey({ ...c }, deviceId);
  return assignSequenceAndAppendChangeLog({
    client,
    GetCommandCtor: FakeGetCommandCtor,
    TransactWriteCommandCtor: FakeTransactWriteCommandCtor,
    changesTable: "Changes",
    changeStreamTable: "ChangeStream",
    ownerPk,
    changeKey,
    deviceId,
    c,
    ...(maxAttempts !== undefined ? { maxAttempts } : {}),
  });
}

test("buildSequenceTransactItems: exact three-action shape, atomic by construction", () => {
  const items = buildSequenceTransactItems({
    changesTable: "Changes",
    changeStreamTable: "ChangeStream",
    ownerPk: "U#alice",
    changeKey: "k1",
    deviceId: "dev-A",
    c: { id: "x", entity: "card", op: "upsert", ts: "2026-01-01T00:00:00.000Z", record: { id: "x", rev: 1 } },
    currentSeqValue: 4,
    nextSeq: 5,
  });
  assert.equal(items.length, 3);
  assert.equal(items[0].Put.TableName, "Changes");
  assert.equal(items[0].Put.Item.SK, "C#k1");
  assert.equal(items[0].Put.Item.seq, 5);
  assert.equal(items[0].Put.ConditionExpression, "attribute_not_exists(PK) AND attribute_not_exists(SK)");
  assert.equal(items[1].Update.TableName, "Changes");
  assert.equal(items[1].Update.Key.SK, SEQUENCE_COUNTER_SK);
  assert.deepEqual(items[1].Update.ExpressionAttributeValues, { ":next": 5, ":current": 4 });
  assert.equal(items[2].Put.TableName, "ChangeStream");
  assert.deepEqual(items[2].Put.Item, { PK: "U#alice", seq: 5, id: "x", entity: "card", op: "upsert", ts: "2026-01-01T00:00:00.000Z", record: { id: "x", rev: 1 } });
});

test("classifySequenceTransactionCancellation: distinguishes idempotency duplicate, counter contention, and neither", () => {
  assert.deepEqual(
    classifySequenceTransactionCancellation([{ Code: "ConditionalCheckFailed" }, { Code: "None" }, { Code: "None" }]),
    { idempotencyDuplicate: true, counterContention: false }
  );
  assert.deepEqual(
    classifySequenceTransactionCancellation([{ Code: "None" }, { Code: "ConditionalCheckFailed" }, { Code: "None" }]),
    { idempotencyDuplicate: false, counterContention: true }
  );
  assert.deepEqual(
    classifySequenceTransactionCancellation([{ Code: "None" }, { Code: "None" }, { Code: "ConditionalCheckFailed" }]),
    { idempotencyDuplicate: false, counterContention: false }
  );
  assert.deepEqual(classifySequenceTransactionCancellation(undefined), { idempotencyDuplicate: false, counterContention: false });
});

test("assignSequenceAndAppendChangeLog: first-ever counter initialization for a user assigns seq=1", async () => {
  const client = new FakeTransactDdbClient();
  const result = await assign(client);
  assert.deepEqual(result, { seq: 1, duplicate: false });
});

test("assignSequenceAndAppendChangeLog: strictly increasing across repeated calls for the SAME user", async () => {
  const client = new FakeTransactDdbClient();
  const seqs = [];
  for (let i = 0; i < 5; i++) seqs.push((await assign(client, { id: `c${i}` })).seq);
  assert.deepEqual(seqs, [1, 2, 3, 4, 5]);
});

test("assignSequenceAndAppendChangeLog: independent, non-interfering counters per user", async () => {
  const client = new FakeTransactDdbClient();
  const a1 = await assign(client, { ownerPk: "U#alice", id: "a1" });
  const b1 = await assign(client, { ownerPk: "U#bob", id: "b1" });
  const a2 = await assign(client, { ownerPk: "U#alice", id: "a2" });
  assert.deepEqual([a1.seq, b1.seq, a2.seq], [1, 1, 2]);
});

test("assignSequenceAndAppendChangeLog: no seq is ever claimed without its stream row having also committed", async () => {
  const client = new FakeTransactDdbClient();
  const result = await assign(client, { id: "x" });
  assert.equal(result.seq, 1);
  const counter = client.table("Changes").get(`U#alice|${SEQUENCE_COUNTER_SK}`);
  const streamRow = client.table("ChangeStream").get("U#alice|seq#1");
  assert.equal(counter.seqValue, 1);
  assert.ok(streamRow, "the stream row must exist the instant the counter reflects its seq");
  assert.equal(streamRow.id, "x");
});

test("assignSequenceAndAppendChangeLog: an unexpected cancellation (not idempotency, not counter contention) throws without advancing anything", async () => {
  const client = new FakeTransactDdbClient();
  // Pre-populate a conflicting stream row at the seq this call is about to claim, forcing item 2's
  // own defensive condition to fail while items 0/1 would otherwise have passed.
  client.table("ChangeStream").set("U#alice|seq#1", { PK: "U#alice", seq: 1, id: "already-there" });
  await assert.rejects(assign(client, { id: "x" }), /conditional request failed/i);
  assert.equal(client.table("Changes").get(`U#alice|${SEQUENCE_COUNTER_SK}`), undefined, "counter must not advance when the transaction overall failed");
});

test("assignSequenceAndAppendChangeLog: a benign duplicate (retried push, same changeKey) wastes ZERO sequence numbers", async () => {
  const client = new FakeTransactDdbClient();
  const first = await assign(client, { id: "retry-me" });
  assert.deepEqual(first, { seq: 1, duplicate: false });

  const retry = await assign(client, { id: "retry-me" }); // identical id/deviceId/ts -> identical changeKey
  assert.deepEqual(retry, { seq: null, duplicate: true });

  const counter = client.table("Changes").get(`U#alice|${SEQUENCE_COUNTER_SK}`);
  assert.equal(counter.seqValue, 1, "the duplicate attempt must not have advanced the counter at all");
  assert.equal(client.table("ChangeStream").size, 1, "the duplicate attempt must not have written a second stream row");
});

test("assignSequenceAndAppendChangeLog: concurrent writers racing for the next seq — the loser retries and receives the NEXT seq, never colliding", async () => {
  class RaceOnceClient extends FakeTransactDdbClient {
    constructor() {
      super();
      this.raced = false;
    }
    async send(command) {
      if (command.kind === "get" && !this.raced) {
        this.raced = true;
        const result = await super.send(command);
        // Simulate a DIFFERENT device's push winning the race for seq=1 between our read and our
        // own transaction attempt.
        this.table("Changes").set(`U#alice|${SEQUENCE_COUNTER_SK}`, { PK: "U#alice", SK: SEQUENCE_COUNTER_SK, seqValue: 1 });
        return result;
      }
      return super.send(command);
    }
  }
  const client = new RaceOnceClient();
  const result = await assign(client, { id: "loser" });
  assert.deepEqual(result, { seq: 2, duplicate: false }, "the retried attempt must land on seq 2, never seq 1 (already taken) and never skip to 3");
  assert.ok(client.table("ChangeStream").get("U#alice|seq#2"));
});

test("assignSequenceAndAppendChangeLog: exhausts bounded retries under SUSTAINED contention and throws, never fabricating or skipping a seq", async () => {
  class AlwaysRacingClient extends FakeTransactDdbClient {
    async send(command) {
      if (command.kind === "get") {
        const result = await super.send(command);
        // Every single read is immediately followed by "someone else" advancing the counter
        // again, so this attempt's own transaction can never win — sustained contention.
        const existing = this.table("Changes").get(`U#alice|${SEQUENCE_COUNTER_SK}`);
        const bumped = (existing?.seqValue ?? 0) + 1;
        this.table("Changes").set(`U#alice|${SEQUENCE_COUNTER_SK}`, { PK: "U#alice", SK: SEQUENCE_COUNTER_SK, seqValue: bumped });
        return result;
      }
      return super.send(command);
    }
  }
  const client = new AlwaysRacingClient();
  await assert.rejects(
    assign(client, { id: "x", maxAttempts: 3 }),
    (e) => e.name === "SequenceAssignmentContentionExhausted"
  );
});

test("assignSequenceAndAppendChangeLog: a storage error propagates (never silently returns a fabricated seq)", async () => {
  const throwingClient = { send: async () => { throw new Error("simulated DynamoDB outage"); } };
  await assert.rejects(assign(throwingClient, { id: "x" }), /simulated DynamoDB outage/);
});

test("MAX_SEQUENCE_ASSIGNMENT_ATTEMPTS is a small, bounded, no-sleep retry count", () => {
  assert.ok(Number.isInteger(MAX_SEQUENCE_ASSIGNMENT_ATTEMPTS) && MAX_SEQUENCE_ASSIGNMENT_ATTEMPTS > 0 && MAX_SEQUENCE_ASSIGNMENT_ATTEMPTS <= 20);
});

// ---------------------------------------------------------------------------
// Dual-mode rollout flags (post-deployability audit) — resolveSyncCursorMode/
// resolveMaintenanceMode must fail closed, and appendChangeLogLegacy must reproduce the exact
// pre-this-fix write shape. See lib.mjs's own header comment's "Dual-mode rollout" section.
// ---------------------------------------------------------------------------

test("resolveSyncCursorMode: only the exact literal 'v2' activates v2 — everything else, including near-misses, resolves to legacy", () => {
  assert.equal(resolveSyncCursorMode("v2"), "v2");
  for (const bad of [undefined, null, "", "V2", "v3", " v2", "v2 ", "legacy", "true"]) {
    assert.equal(resolveSyncCursorMode(bad), "legacy", `expected legacy for ${JSON.stringify(bad)}`);
  }
});

test("resolveMaintenanceMode: only the exact literal 'true' activates maintenance — everything else, including near-misses, resolves to false", () => {
  assert.equal(resolveMaintenanceMode("true"), true);
  for (const bad of [undefined, null, "", "TRUE", "True", " true", "true ", "1", "yes", "false"]) {
    assert.equal(resolveMaintenanceMode(bad), false, `expected false for ${JSON.stringify(bad)}`);
  }
});

class FakeLegacyPutCommandCtor {
  constructor(input) {
    this.input = input;
  }
}
class FakeLegacyDdbClient {
  constructor() {
    this.items = new Map();
  }
  key(k) {
    return `${k.PK}|${k.SK}`;
  }
  async send(command) {
    const { input } = command;
    const k = this.key(input.Item);
    if (input.ConditionExpression && this.items.has(k)) {
      const err = new Error("The conditional request failed");
      err.name = "ConditionalCheckFailedException";
      throw err;
    }
    this.items.set(k, { ...input.Item });
    return {};
  }
}

test("appendChangeLogLegacy: writes the exact pre-this-fix shape — no seq attribute, no transaction", async () => {
  const client = new FakeLegacyDdbClient();
  const c = { id: "x", entity: "card", op: "upsert", ts: "2026-01-01T00:00:00.000Z", record: { id: "x", rev: 1 } };
  await appendChangeLogLegacy({ client, PutCommandCtor: FakeLegacyPutCommandCtor, changesTable: "Changes", ownerPk: "U#alice", changeKey: "k1", deviceId: "dev-A", c });
  const stored = client.items.get("U#alice|C#k1");
  assert.ok(stored);
  assert.equal(stored.seq, undefined, "legacy writes must never carry a seq attribute");
  assert.deepEqual(stored, { PK: "U#alice", SK: "C#k1", changeKey: "k1", deviceId: "dev-A", id: "x", entity: "card", op: "upsert", ts: c.ts, record: c.record });
});

test("appendChangeLogLegacy: a retried push (same changeKey) throws ConditionalCheckFailedException — the caller treats this as a benign duplicate", async () => {
  const client = new FakeLegacyDdbClient();
  const c = { id: "x", entity: "card", op: "upsert", ts: "2026-01-01T00:00:00.000Z", record: { id: "x", rev: 1 } };
  await appendChangeLogLegacy({ client, PutCommandCtor: FakeLegacyPutCommandCtor, changesTable: "Changes", ownerPk: "U#alice", changeKey: "k1", deviceId: "dev-A", c });
  await assert.rejects(
    appendChangeLogLegacy({ client, PutCommandCtor: FakeLegacyPutCommandCtor, changesTable: "Changes", ownerPk: "U#alice", changeKey: "k1", deviceId: "dev-A", c }),
    (e) => e.name === "ConditionalCheckFailedException"
  );
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
