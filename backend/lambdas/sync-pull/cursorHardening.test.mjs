// End-to-end backend integration tests for the sync-cursor-hardening fix
// (docs/sync-cursor-semantics.md) — runs the REAL sync-push AND sync-pull Lambda HANDLER LOGIC
// (via each file's own DI'd `createHandler` factory, not just their pure lib.mjs helpers)
// against a small in-memory fake DynamoDB that models the exact conditional-write/transaction/
// query semantics both handlers actually rely on. This is what lets this file directly reproduce
// the original bug (a backdated offline upload invisible to an already-advanced cursor) and
// prove the fix, across pagination and multi-device convergence, without any real AWS access.
//
// REWORKED (post-review): the fake previously modeled a plain counter increment + a separate
// PutItem, read back through a sparse GSI. It now models `TransactWriteItems` (atomic, all three
// actions succeed or none do) feeding a dedicated `ChangeStream` BASE TABLE queried with
// `ConsistentRead: true` — see sync-push/lib.mjs and sync-pull/lib.mjs's own header comments for
// why the GSI design was unsound and had to be reworked before founder QA.
//
// Imports createHandler from each Lambda's own lib.mjs (constructed here with fake client/
// Command constructors) rather than mocking "@aws-sdk/client-dynamodb"/"@aws-sdk/lib-dynamodb"
// via node:test's mock.module or importing index.mjs directly — those packages are not installed
// anywhere in this repository (this Lambda deliberately ships with no node_modules; the Node.js
// Lambda runtime provides them built in), and merely importing index.mjs (even just for
// createHandler) would evaluate its own top-level AWS SDK imports and fail. lib.mjs has no such
// imports at all. See lib.mjs's own header comment in both directories.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createHandler as createPushHandler } from "../sync-push/lib.mjs";
import { createHandler as createPullHandler } from "./lib.mjs";
import { runConvergenceLoop } from "../../scripts/backfill-change-sequence.mjs";

class FakePutCommand {
  constructor(input) {
    this.kind = "put";
    this.input = input;
  }
}
class FakeGetCommand {
  constructor(input) {
    this.kind = "get";
    this.input = input;
  }
}
class FakeUpdateCommand {
  constructor(input) {
    this.kind = "update";
    this.input = input;
  }
}
class FakeTransactWriteCommand {
  constructor(input) {
    this.kind = "transact";
    this.input = input;
  }
}
class FakeQueryCommand {
  constructor(input) {
    this.kind = "query";
    this.input = input;
  }
}
class FakeScanCommand {
  constructor(input) {
    this.kind = "scan";
    this.input = input;
  }
}

function conditionalCheckFailed() {
  const err = new Error("The conditional request failed");
  err.name = "ConditionalCheckFailedException";
  return err;
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

// Models exactly the conditional-write/transaction/query semantics backend/lambdas/sync-push/
// index.mjs and sync-pull/index.mjs actually use — not a general DynamoDB emulator, just this
// exact usage (same scoping discipline as rateLimiter.test.mjs's own FakeDdbClient). Critically,
// `transact` evaluates EVERY action's condition before applying ANY write (true DynamoDB
// TransactWriteItems atomicity — all or nothing), which is what makes this fake capable of
// proving the fix's correctness invariant rather than merely exercising its happy path.
class FakeDynamoClient {
  constructor() {
    this.tables = new Map();
  }
  table(name) {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name);
  }
  itemKey(k) {
    return k.SK !== undefined ? `${k.PK}|${k.SK}` : `${k.PK}|seq#${k.seq}`;
  }
  async send(command) {
    const { kind, input } = command;

    if (kind === "scan") {
      // Single-page scan — sufficient for this fake's small test tables, matching
      // backend/scripts/backfill-change-sequence.test.mjs's own fake's same simplification.
      return { Items: [...this.table(input.TableName).values()] };
    }

    if (kind === "put") {
      // LEGACY-mode sync-push's appendChangeLogLegacy — a plain conditional PutItem, no
      // transaction, no `seq`, matching the pre-this-fix implementation exactly.
      const table = this.table(input.TableName);
      const k = this.itemKey(input.Item);
      if (
        input.ConditionExpression &&
        !evalCondition(input.ConditionExpression, table.get(k), input.ExpressionAttributeNames, input.ExpressionAttributeValues)
      ) {
        throw conditionalCheckFailed();
      }
      table.set(k, { ...input.Item });
      return {};
    }

    if (kind === "get") {
      return { Item: this.table(input.TableName).get(this.itemKey(input.Key)) };
    }

    if (kind === "update") {
      // Only the Records-table rev-conditional update still uses a standalone UpdateCommand
      // (updateRecordSnapshot) — the sequence counter is now updated exclusively inside a
      // transaction (see "transact" below), never via a standalone UpdateCommand.
      const table = this.table(input.TableName);
      const k = this.itemKey(input.Key);
      const existing = table.get(k);
      const incomingRev = input.ExpressionAttributeValues[":incomingRev"];
      const currentRev = existing?.record?.rev;
      if (existing?.record && !(incomingRev >= currentRev)) throw conditionalCheckFailed();
      table.set(k, {
        ...input.Key,
        entity: input.ExpressionAttributeValues[":entity"],
        id: input.ExpressionAttributeValues[":id"],
        op: input.ExpressionAttributeValues[":op"],
        updatedAt: input.ExpressionAttributeValues[":ts"],
        record: input.ExpressionAttributeValues[":record"],
        lastDeviceId: input.ExpressionAttributeValues[":deviceId"],
        lastChangeKey: input.ExpressionAttributeValues[":changeKey"],
      });
      return {};
    }

    if (kind === "transact") {
      const checks = input.TransactItems.map((item) => {
        const op = item.Put ? "Put" : "Update";
        const spec = item.Put ?? item.Update;
        const table = this.table(spec.TableName);
        const k = op === "Put" ? this.itemKey(spec.Item) : this.itemKey(spec.Key);
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
      // True atomicity: every condition above already passed BEFORE any write below is applied.
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

    if (kind === "query") {
      const table = this.table(input.TableName);
      const pk = input.ExpressionAttributeValues[":pk"];
      let rows = [...table.values()].filter((it) => it.PK === pk);
      const cursor = input.ExpressionAttributeValues[":cursor"];
      if (input.TableName === "ChangeStream") {
        // v2 — ChangeStream's own primary sort key is `seq`; every row has one unconditionally
        // (unlike the sparse GSI this replaces, there is no membership filter to apply here).
        if (cursor !== undefined) rows = rows.filter((it) => it.seq > cursor);
        rows.sort((a, b) => a.seq - b.seq);
      } else {
        // LEGACY — plain SK-ordered scan against Changes, byte-for-byte the pre-this-fix
        // behavior, including the counter sentinel row if one happens to coexist (the fake
        // deliberately does NOT filter it here — isLegacyChangeRow's job, in lib.mjs, is to
        // filter it from the DELIVERED list while nextLegacyCursorForPage still advances past
        // it using the raw item list, exactly like the real implementation).
        if (cursor !== undefined) rows = rows.filter((it) => it.SK > cursor);
        rows.sort((a, b) => (a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0));
      }
      if (typeof input.Limit === "number") rows = rows.slice(0, input.Limit);
      return { Items: rows };
    }

    throw new Error(`unrecognized fake command kind: ${kind}`);
  }
}

// This shared pair is wired to cursorMode: "v2" EXPLICITLY — `createHandler`'s own default is
// now "legacy" (the dual-mode rollout's fail-closed default; see each lib.mjs's header comment),
// and every test in this file below Section 20 was written to reproduce/prove the v2 fix
// specifically. Legacy-mode and mode-transition behavior get their own dedicated, separately
// constructed handlers further down this file.
const sharedClient = new FakeDynamoClient();

const pushHandler = createPushHandler({
  client: sharedClient,
  PutCommandCtor: FakePutCommand,
  GetCommandCtor: FakeGetCommand,
  TransactWriteCommandCtor: FakeTransactWriteCommand,
  UpdateCommandCtor: FakeUpdateCommand,
  recordsTable: "Records",
  changesTable: "Changes",
  changeStreamTable: "ChangeStream",
  cursorMode: "v2",
});

const pullHandler = createPullHandler({
  client: sharedClient,
  QueryCommandCtor: FakeQueryCommand,
  changesTable: "Changes",
  changeStreamTable: "ChangeStream",
  cursorMode: "v2",
});

function authEvent(sub) {
  return { requestContext: { authorizer: { jwt: { claims: { sub } } } } };
}

async function push(sub, deviceId, changes) {
  const res = await pushHandler({ ...authEvent(sub), body: JSON.stringify({ deviceId, changes }) });
  return JSON.parse(res.body);
}

async function pull(sub, cursor, limit) {
  const qs = {};
  if (cursor !== undefined && cursor !== null) qs.cursor = cursor;
  if (limit !== undefined) qs.limit = String(limit);
  const res = await pullHandler({ ...authEvent(sub), queryStringParameters: qs });
  return { status: res.statusCode, ...JSON.parse(res.body) };
}

function change(overrides) {
  return { id: "x", entity: "card", op: "upsert", ts: "2026-01-01T00:00:00.000Z", record: { id: "x", rev: 1 }, ...overrides };
}

let userCounter = 0;
function freshUser() {
  return `user-${++userCounter}`;
}

// ---------------------------------------------------------------------------
// Section 20 — bug reproduction: a backdated offline upload must be delivered to an
// already-advanced cursor, without full replay, for every entity kind.
// ---------------------------------------------------------------------------

for (const entity of ["card", "reviewEvent", "generatedCardProvenance"]) {
  test(`bug reproduction (${entity}): a backdated late upload is delivered to an already-advanced cursor without full replay`, async () => {
    const sub = freshUser();

    // Device B establishes a baseline and advances its cursor via an UNRELATED, recently-timed
    // change.
    await push(sub, "device-B", [change({ id: "recent-1", entity, ts: "2026-06-01T00:00:00.000Z", record: { id: "recent-1", rev: 1 } })]);
    const firstPull = await pull(sub, undefined);
    assert.equal(firstPull.changes.length, 1);
    let cursor = firstPull.cursor;

    // Device A pushes a change with an OLD domain timestamp — created offline days/months
    // "ago" relative to B's own already-advanced cursor position — AFTER B's cursor advanced.
    const pushResult = await push(sub, "device-A", [
      change({ id: "backdated-1", entity, ts: "2026-01-01T00:00:00.000Z", record: { id: "backdated-1", rev: 1 } }),
    ]);
    assert.equal(pushResult.accepted.length, 1);

    // B performs an ORDINARY incremental pull using its already-advanced cursor — no full
    // replay, no cursor reset.
    const secondPull = await pull(sub, cursor);
    assert.equal(secondPull.changes.length, 1, "the backdated change must be delivered on the very next incremental pull");
    assert.equal(secondPull.changes[0].id, "backdated-1");
    cursor = secondPull.cursor;

    // A third pull with the new cursor returns nothing new — convergence reached.
    const thirdPull = await pull(sub, cursor);
    assert.equal(thirdPull.changes.length, 0);
  });
}

test("bug reproduction: an upload backdated by MONTHS relative to the cursor is still delivered (not just a same-millisecond tie-break)", async () => {
  const sub = freshUser();
  await push(sub, "device-B", [change({ id: "recent", ts: "2026-06-01T00:00:00.000Z", record: { id: "recent", rev: 1 } })]);
  const cursor = (await pull(sub, undefined)).cursor;

  await push(sub, "device-A", [change({ id: "very-old", ts: "2025-01-01T00:00:00.000Z", record: { id: "very-old", rev: 1 } })]);
  const page = await pull(sub, cursor);
  assert.equal(page.changes.length, 1);
  assert.equal(page.changes[0].id, "very-old");
});

// ---------------------------------------------------------------------------
// Section 21 — cursor edge cases.
// ---------------------------------------------------------------------------

test("cursor: empty/first pull with no changes returns an empty page and a stable cursor", async () => {
  const sub = freshUser();
  const page = await pull(sub, undefined);
  assert.deepEqual(page.changes, []);
});

test("cursor: malformed cursor values are treated as a full replay, never a 500", async () => {
  const sub = freshUser();
  await push(sub, "device-A", [change({ id: "a" })]);
  for (const bad of ["not-a-number", "-5", "1.5", "'; DROP TABLE Changes;--"]) {
    const page = await pull(sub, bad);
    assert.equal(page.status, 200);
    assert.equal(page.changes.length, 1, `malformed cursor ${JSON.stringify(bad)} should fall back to a full replay`);
  }
});

test("cursor: a legacy (old pipe-delimited changeKey) cursor triggers exactly one full replay and the client receives a fresh valid cursor", async () => {
  const sub = freshUser();
  await push(sub, "device-A", [change({ id: "a" }), change({ id: "b", ts: "2026-02-01T00:00:00.000Z" })]);
  const legacyCursor = "2026-01-01T00:00:00.000Z|device-A|card|a|upsert";
  const page = await pull(sub, legacyCursor);
  assert.equal(page.changes.length, 2, "legacy cursor ignored entirely -> full replay");
  assert.match(page.cursor, /^\d+$/, "the client now has a valid NEW-format cursor");

  // The client's very next pull, using the new cursor, converges with no further replay.
  const next = await pull(sub, page.cursor);
  assert.equal(next.changes.length, 0);
});

test("cursor: repeated pull with the SAME (already-consumed) cursor is safe and re-returns nothing new (never an error, never a skip)", async () => {
  const sub = freshUser();
  await push(sub, "device-A", [change({ id: "a" })]);
  const first = await pull(sub, undefined);
  const repeat1 = await pull(sub, first.cursor);
  const repeat2 = await pull(sub, first.cursor);
  assert.deepEqual(repeat1.changes, []);
  assert.deepEqual(repeat2.changes, []);
  assert.equal(repeat1.cursor, first.cursor);
});

test("cursor: duplicate delivery via re-pulling an OLDER cursor re-sends already-seen changes, which is explicitly acceptable (never missed delivery)", async () => {
  const sub = freshUser();
  await push(sub, "device-A", [change({ id: "a" }), change({ id: "b" })]);
  const page = await pull(sub, undefined);
  assert.equal(page.changes.length, 2);
  // Re-pulling from "before" (undefined) again re-delivers both — the client's own apply layer
  // (SyncService.ts's incomingWins/mergeIncomingReviewEvents) is what makes this idempotent, not
  // the backend suppressing it.
  const replay = await pull(sub, undefined);
  assert.equal(replay.changes.length, 2);
});

test("cursor: future-clock and past-clock uploads are both delivered purely by push/ingestion order, never by comparing ts to 'now'", async () => {
  const sub = freshUser();
  const farFuture = "2099-01-01T00:00:00.000Z";
  const farPast = "2000-01-01T00:00:00.000Z";
  await push(sub, "device-A", [change({ id: "future-clock", ts: farFuture, record: { id: "future-clock", rev: 1 } })]);
  await push(sub, "device-B", [change({ id: "past-clock", ts: farPast, record: { id: "past-clock", rev: 1 } })]);
  const page = await pull(sub, undefined);
  assert.deepEqual(new Set(page.changes.map((c) => c.id)), new Set(["future-clock", "past-clock"]));
});

test("cursor: a tombstone (delete op) is delivered through the exact same path as any other change", async () => {
  const sub = freshUser();
  await push(sub, "device-A", [change({ id: "a", op: "delete", record: { id: "a", rev: 2, deletedAt: "2026-01-01T00:00:00.000Z" } })]);
  const page = await pull(sub, undefined);
  assert.equal(page.changes.length, 1);
  assert.equal(page.changes[0].op, "delete");
});

test("cursor: a delete then a later restore (upsert) of the same id are both delivered, in push order", async () => {
  const sub = freshUser();
  await push(sub, "device-A", [change({ id: "a", op: "delete", ts: "2026-01-01T00:00:00.000Z", record: { id: "a", rev: 2, deletedAt: "2026-01-01T00:00:00.000Z" } })]);
  await push(sub, "device-A", [change({ id: "a", op: "upsert", ts: "2026-01-02T00:00:00.000Z", record: { id: "a", rev: 3 } })]);
  const page = await pull(sub, undefined);
  assert.equal(page.changes.length, 2);
  assert.deepEqual(page.changes.map((c) => c.op), ["delete", "upsert"]);
});

test("cursor: pagination — a page exactly at the limit still advances correctly across a boundary", async () => {
  const sub = freshUser();
  const changes = Array.from({ length: 5 }, (_, i) => change({ id: `c${i}`, record: { id: `c${i}`, rev: 1 } }));
  await push(sub, "device-A", changes);

  const page1 = await pull(sub, undefined, 2);
  assert.equal(page1.changes.length, 2);
  const page2 = await pull(sub, page1.cursor, 2);
  assert.equal(page2.changes.length, 2);
  const page3 = await pull(sub, page2.cursor, 2);
  assert.equal(page3.changes.length, 1);
  const page4 = await pull(sub, page3.cursor, 2);
  assert.equal(page4.changes.length, 0);

  // Every id delivered exactly once across all pages.
  const allIds = [...page1.changes, ...page2.changes, ...page3.changes].map((c) => c.id);
  assert.deepEqual(new Set(allIds), new Set(changes.map((c) => c.id)));
  assert.equal(allIds.length, 5);
});

test("cursor: sync interrupted mid-pagination — re-fetching the SAME page (client crashed before persisting the new cursor) is safe", async () => {
  const sub = freshUser();
  await push(sub, "device-A", [change({ id: "a" }), change({ id: "b" }), change({ id: "c" })]);
  const page1 = await pull(sub, undefined, 2);
  assert.equal(page1.changes.length, 2);
  // Simulate a crash: the client never persisted page1.cursor, so it re-pulls from the SAME
  // prior cursor (undefined) again.
  const retryPage1 = await pull(sub, undefined, 2);
  assert.deepEqual(retryPage1.changes.map((c) => c.id), page1.changes.map((c) => c.id));
});

test("cursor: >500 changes — pagination still converges to zero remaining with no gaps or duplicates", async () => {
  const sub = freshUser();
  // Push in multiple requests (MAX_CHANGES_PER_PUSH is 500) to build up a backlog > 500.
  for (let batch = 0; batch < 3; batch++) {
    const changes = Array.from({ length: 300 }, (_, i) => {
      const id = `c${batch}-${i}`;
      return change({ id, record: { id, rev: 1 } });
    });
    await push(sub, "device-A", changes);
  }
  let cursor;
  const seen = [];
  for (let i = 0; i < 20; i++) {
    const page = await pull(sub, cursor, 100);
    seen.push(...page.changes.map((c) => c.id));
    cursor = page.cursor;
    if (page.changes.length === 0) break;
  }
  assert.equal(seen.length, 900);
  assert.equal(new Set(seen).size, 900, "no duplicates across pages");
});

// ---------------------------------------------------------------------------
// Section 22 — two-device convergence.
// ---------------------------------------------------------------------------

test("convergence: A offline changes -> B advances independently -> A uploads late -> B converges without full replay", async () => {
  const sub = freshUser();

  // Both devices start synced (empty).
  const bCursor0 = (await pull(sub, undefined)).cursor;

  // B makes an online change and advances its own cursor further.
  await push(sub, "device-B", [change({ id: "b-change", ts: "2026-03-01T00:00:00.000Z", record: { id: "b-change", rev: 1 } })]);
  const bPage1 = await pull(sub, bCursor0);
  assert.equal(bPage1.changes.length, 1);
  const bCursor1 = bPage1.cursor;

  // A, meanwhile, had created a record OFFLINE with an old timestamp and only uploads it now.
  await push(sub, "device-A", [change({ id: "a-offline", ts: "2026-01-15T00:00:00.000Z", record: { id: "a-offline", rev: 1 } })]);

  // B syncs again — must receive A's late, backdated change with an ordinary incremental pull.
  const bPage2 = await pull(sub, bCursor1);
  assert.equal(bPage2.changes.length, 1);
  assert.equal(bPage2.changes[0].id, "a-offline");
});

test("convergence: BOTH devices make independent offline changes, then both converge to seeing everything", async () => {
  const sub = freshUser();
  const startCursor = (await pull(sub, undefined)).cursor;

  await push(sub, "device-A", [change({ id: "a1", ts: "2026-01-01T00:00:00.000Z", record: { id: "a1", rev: 1 } })]);
  await push(sub, "device-B", [change({ id: "b1", ts: "2025-12-01T00:00:00.000Z", record: { id: "b1", rev: 1 } })]);
  await push(sub, "device-A", [change({ id: "a2", ts: "2026-02-01T00:00:00.000Z", record: { id: "a2", rev: 1 } })]);

  const aView = await pull(sub, startCursor);
  const bView = await pull(sub, startCursor);
  assert.deepEqual(new Set(aView.changes.map((c) => c.id)), new Set(["a1", "b1", "a2"]));
  assert.deepEqual(new Set(bView.changes.map((c) => c.id)), new Set(["a1", "b1", "a2"]));
  assert.equal(aView.cursor, bView.cursor, "both devices converge to the identical cursor position");
});

test("convergence: full replay (reset cursor to undefined) still works as a recovery tool and agrees with incremental history", async () => {
  const sub = freshUser();
  await push(sub, "device-A", [change({ id: "a" })]);
  const afterA = await pull(sub, undefined);
  await push(sub, "device-B", [change({ id: "b", ts: "2025-01-01T00:00:00.000Z", record: { id: "b", rev: 1 } })]);
  await pull(sub, afterA.cursor); // ordinary incremental pull already picks up "b"

  // A full replay (cursor reset) must see the SAME total history, not a different one.
  const replay = await pull(sub, undefined);
  assert.deepEqual(new Set(replay.changes.map((c) => c.id)), new Set(["a", "b"]));
});

// ---------------------------------------------------------------------------
// Section 14 — duplicate push delivery (retry) must not create duplicate change-log rows or
// corrupt ordering.
// ---------------------------------------------------------------------------

test("duplicate push delivery (retry of the exact same change) is idempotent and does not consume a second visible position for a DIFFERENT change", async () => {
  const sub = freshUser();
  const c = change({ id: "retry-me", ts: "2026-01-01T00:00:00.000Z", record: { id: "retry-me", rev: 1 } });

  const first = await push(sub, "device-A", [c]);
  assert.equal(first.accepted.length, 1);
  const retry = await push(sub, "device-A", [c]); // exact same change, same deviceId -> same changeKey
  assert.equal(retry.accepted.length, 1, "a benign duplicate is still acknowledged, not rejected");

  const page = await pull(sub, undefined);
  assert.equal(page.changes.length, 1, "the retried push never produced a second change-log row");
});

// ---------------------------------------------------------------------------
// Correctness invariant (the mission's own framing): "If cursor N has been returned to a
// client, there can never later become visible an already-committed stream record with
// seq <= N that the client had no opportunity to receive." Proven rigorously, with deliberate
// race injection, at the unit level in sync-push/lib.test.mjs (first-ever counter init,
// concurrent-writer retry, sustained-contention exhaustion, zero-seq-wasted duplicates, "no seq
// without its stream row"). This end-to-end test is the complementary, full-stack confirmation:
// genuine same-tick concurrency (two changes processed concurrently within ONE push request's
// own PUSH_CONCURRENCY batching) converges to a gapless, collision-free seq assignment that the
// very next ORDINARY pull delivers completely.
// ---------------------------------------------------------------------------

test("correctness invariant: concurrently-processed changes for the same user receive distinct, gapless seqs, and an immediate pull delivers all of them with no gap", async () => {
  const sub = freshUser();
  const concurrentChanges = Array.from({ length: 8 }, (_, i) => change({ id: `concurrent-${i}`, record: { id: `concurrent-${i}`, rev: 1 } }));

  // All 8 are submitted in ONE push request, so the handler's own PUSH_CONCURRENCY batching
  // processes them concurrently (Promise.allSettled), each independently calling
  // assignSequenceAndAppendChangeLog for the SAME ownerPk — real contention, not simulated.
  const result = await push(sub, "device-A", concurrentChanges);
  assert.equal(result.accepted.length, 8, "every concurrently-processed change must still be accepted");

  const page = await pull(sub, undefined);
  assert.equal(page.changes.length, 8, "an immediate pull must deliver every concurrently-committed change — no gap, no loss");
  assert.deepEqual(
    new Set(page.changes.map((c) => c.id)),
    new Set(concurrentChanges.map((c) => c.id))
  );

  // The stream's own seqs (not exposed in the pull response, but readable from the shared fake
  // table directly here) must be a contiguous, collision-free run — the exact invariant the
  // transactional design guarantees by construction.
  const streamRows = [...sharedClient.table("ChangeStream").values()].filter((r) => r.PK === `U#${sub}`);
  const seqs = streamRows.map((r) => r.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, [1, 2, 3, 4, 5, 6, 7, 8], "seqs must be exactly 1..8 with no gap and no collision");

  // A cursor taken at this point can never later need to "go back" — every seq<=8 is already
  // fully committed and visible, by construction (TransactWriteItems atomicity: the counter can
  // only reach N once seq=N's own stream row is already durably committed).
  assert.equal(page.cursor, "8");
  const next = await pull(sub, page.cursor);
  assert.equal(next.changes.length, 0, "nothing further is pending — convergence reached");
});

test("pull always requests ConsistentRead: true against ChangeStream — the load-bearing half of the correctness invariant", async () => {
  let capturedInput;
  class CapturingQueryCommand extends FakeQueryCommand {
    constructor(input) {
      super(input);
      capturedInput = input;
    }
  }
  const capturingPull = createPullHandler({
    client: sharedClient,
    QueryCommandCtor: CapturingQueryCommand,
    changesTable: "Changes",
    changeStreamTable: "ChangeStream",
    cursorMode: "v2",
  });
  const sub = freshUser();
  await capturingPull({ ...authEvent(sub), queryStringParameters: {} });
  assert.equal(capturedInput.ConsistentRead, true);
  assert.equal("IndexName" in capturedInput, false, "must query the base table directly, never a secondary index");
});

// ---------------------------------------------------------------------------
// Dual-mode rollout (post-deployability audit) — SYNC_CURSOR_MODE (legacy|v2) and
// SYNC_PUSH_MAINTENANCE (true|false). See sync-push/lib.mjs and sync-pull/lib.mjs's own header
// comments for why this exists: Interval_ChangeStream, its IAM, and this Lambda code all deploy
// together in one CDK stack update, so "deploy infra only, keep old Lambda behavior" has to be
// achieved by the CODE defaulting to the old behavior, not by a partial infra-only deploy that
// CDK/CloudFormation has no supported way to perform. Each test below constructs its OWN fresh
// client/handlers (never the shared v2-only `sharedClient`/`pushHandler`/`pullHandler` above) so
// these mode-specific scenarios can't bleed into, or be bled into by, the deep v2 suite above.
// ---------------------------------------------------------------------------

function freshPushHandler(client, overrides = {}) {
  return createPushHandler({
    client,
    PutCommandCtor: FakePutCommand,
    GetCommandCtor: FakeGetCommand,
    TransactWriteCommandCtor: FakeTransactWriteCommand,
    UpdateCommandCtor: FakeUpdateCommand,
    recordsTable: "Records",
    changesTable: "Changes",
    changeStreamTable: "ChangeStream",
    ...overrides,
  });
}

function freshPullHandler(client, overrides = {}) {
  return createPullHandler({
    client,
    QueryCommandCtor: FakeQueryCommand,
    changesTable: "Changes",
    changeStreamTable: "ChangeStream",
    ...overrides,
  });
}

async function pushVia(handler, sub, deviceId, changes) {
  const res = await handler({ ...authEvent(sub), body: JSON.stringify({ deviceId, changes }) });
  return { status: res.statusCode, ...JSON.parse(res.body) };
}

async function pullVia(handler, sub, cursor, limit) {
  const qs = {};
  if (cursor !== undefined && cursor !== null) qs.cursor = cursor;
  if (limit !== undefined) qs.limit = String(limit);
  const res = await handler({ ...authEvent(sub), queryStringParameters: qs });
  return { status: res.statusCode, ...JSON.parse(res.body) };
}

test("dual-mode: legacy mode (the default, no cursorMode passed at all) writes plain Changes rows with no seq, never touches ChangeStream, and reads back in SK order", async () => {
  const client = new FakeDynamoClient();
  const legacyPush = freshPushHandler(client); // cursorMode omitted entirely
  const legacyPull = freshPullHandler(client); // cursorMode omitted entirely

  const sub = freshUser();
  const pushResult = await pushVia(legacyPush, sub, "device-A", [
    change({ id: "a" }),
    change({ id: "b", ts: "2026-02-01T00:00:00.000Z" }),
  ]);
  assert.equal(pushResult.accepted.length, 2);
  assert.equal(client.table("ChangeStream").size, 0, "legacy mode must never write to ChangeStream");

  const changesRows = [...client.table("Changes").values()].filter((r) => r.SK?.startsWith("C#"));
  assert.equal(changesRows.length, 2);
  assert.ok(changesRows.every((r) => r.seq === undefined), "legacy rows carry no seq attribute at all");

  const pullResult = await pullVia(legacyPull, sub, undefined);
  assert.equal(pullResult.changes.length, 2);
  assert.match(pullResult.cursor, /^C#/, "legacy cursor is the raw SK string, not a numeric seq");
});

test("dual-mode: maintenance mode rejects every push with a safe, retryable 503 and writes NOTHING — pull is explicitly unaffected", async () => {
  const client = new FakeDynamoClient();
  const frozenPush = freshPushHandler(client, { maintenanceMode: "true" });
  const pullDuringFreeze = freshPullHandler(client);

  const sub = freshUser();
  const result = await pushVia(frozenPush, sub, "device-A", [change({ id: "a" })]);
  assert.equal(result.status, 503);
  assert.equal(result.ok, false);
  assert.equal(result.error, "maintenance");
  assert.equal(result.retryable, true);
  assert.equal(client.table("Records").size, 0, "nothing at all written during maintenance — not even the Records snapshot");
  assert.equal(client.table("Changes").size, 0);

  const pullResult = await pullVia(pullDuringFreeze, sub, undefined);
  assert.equal(pullResult.status, 200, "sync-pull has no maintenance mode of its own and must keep serving reads");
  assert.deepEqual(pullResult.changes, []);
});

test("dual-mode: v2 mode (explicit) writes ChangeStream via a transaction and pull reads it back with a numeric cursor", async () => {
  const client = new FakeDynamoClient();
  const v2Push = freshPushHandler(client, { cursorMode: "v2" });
  const v2Pull = freshPullHandler(client, { cursorMode: "v2" });

  const sub = freshUser();
  await pushVia(v2Push, sub, "device-A", [change({ id: "a" })]);
  assert.equal(client.table("ChangeStream").size, 1, "v2 mode writes ChangeStream");

  const pullResult = await pullVia(v2Pull, sub, undefined);
  assert.equal(pullResult.changes.length, 1);
  assert.match(pullResult.cursor, /^\d+$/, "v2 cursor is a numeric seq string");
});

test("dual-mode: an unrecognized SYNC_CURSOR_MODE value is treated as legacy end to end — never partially, never accidentally v2", async () => {
  const client = new FakeDynamoClient();
  for (const bad of [undefined, "", "V2", "v3", " v2", "legacy "]) {
    const badPush = freshPushHandler(client, { cursorMode: bad });
    const sub = freshUser();
    await pushVia(badPush, sub, "device-A", [change({ id: "a" })]);
    assert.equal(client.table("ChangeStream").size, 0, `cursorMode=${JSON.stringify(bad)} must never write ChangeStream`);
  }
});

test("dual-mode: an unrecognized SYNC_PUSH_MAINTENANCE value never activates a freeze — fails closed toward NORMAL operation, not toward blocking everyone", async () => {
  const client = new FakeDynamoClient();
  for (const bad of [undefined, "", "TRUE", "1", "yes", "false "]) {
    const maybeFrozenPush = freshPushHandler(client, { maintenanceMode: bad });
    const sub = freshUser();
    const result = await pushVia(maybeFrozenPush, sub, "device-A", [change({ id: "a" })]);
    assert.equal(result.status, 200, `maintenanceMode=${JSON.stringify(bad)} must not freeze writes`);
  }
});

test("dual-mode: writes frozen during the backfill means it sees a stable snapshot and converges on the FIRST pass", async () => {
  const client = new FakeDynamoClient();
  const normalPush = freshPushHandler(client); // legacy, pre-freeze
  const frozenPush = freshPushHandler(client, { maintenanceMode: "true" });

  const sub = freshUser();
  await pushVia(normalPush, sub, "device-A", [
    change({ id: "a", record: { id: "a", rev: 1 } }),
    change({ id: "b", ts: "2025-01-01T00:00:00.000Z", record: { id: "b", rev: 1 } }),
  ]);

  const rejected = await pushVia(frozenPush, sub, "device-A", [change({ id: "c" })]);
  assert.equal(rejected.status, 503, "a push attempted during the freeze is rejected, not silently queued or lost");

  const result = await runConvergenceLoop({
    client,
    ScanCommandCtor: FakeScanCommand,
    GetCommandCtor: FakeGetCommand,
    TransactWriteCommandCtor: FakeTransactWriteCommand,
    table: "Changes",
    streamTable: "ChangeStream",
    execute: true,
    log: () => {},
  });
  assert.equal(result.converged, true);
  // Pass 1 finds and backfills the two pre-freeze rows (totalUnmigrated > 0 for that pass, by
  // definition — it reports what it found BEFORE backfilling); pass 2 re-scans and finds zero,
  // which is what actually confirms convergence. Exactly 2 passes, never more, when writes were
  // genuinely frozen — no straggler could have appeared to force a third.
  assert.equal(result.passesRun, 2);
  assert.equal(client.table("ChangeStream").size, 2, "exactly the two pre-freeze rows were backfilled; the rejected push contributed nothing");
});

test("dual-mode cutover: legacy pushes -> freeze -> backfill+convergence -> mode flips to v2 — a client's STALE legacy cursor triggers exactly one replay, recovers everything it missed, and converges incrementally afterward", async () => {
  const client = new FakeDynamoClient();
  const legacyPush = freshPushHandler(client, { cursorMode: "legacy" });
  const legacyPull = freshPullHandler(client, { cursorMode: "legacy" });

  const sub = freshUser();

  // Phase 1 — ordinary legacy operation. The client pulls once and holds onto that cursor.
  await pushVia(legacyPush, sub, "device-A", [change({ id: "a", ts: "2026-01-01T00:00:00.000Z", record: { id: "a", rev: 1 } })]);
  const firstPull = await pullVia(legacyPull, sub, undefined);
  assert.equal(firstPull.changes.length, 1);
  const staleClientCursor = firstPull.cursor;
  assert.match(staleClientCursor, /^C#/);

  // A second change lands on the server AFTER that pull — this client never saw it before the
  // freeze/cutover below (simulating a device that goes offline right before a migration).
  await pushVia(legacyPush, sub, "device-A", [change({ id: "b", ts: "2026-02-01T00:00:00.000Z", record: { id: "b", rev: 1 } })]);

  // Phase 2 — freeze (simulated by simply not pushing further), backfill + convergence.
  const backfillResult = await runConvergenceLoop({
    client,
    ScanCommandCtor: FakeScanCommand,
    GetCommandCtor: FakeGetCommand,
    TransactWriteCommandCtor: FakeTransactWriteCommand,
    table: "Changes",
    streamTable: "ChangeStream",
    execute: true,
    log: () => {},
  });
  assert.equal(backfillResult.converged, true);

  // Phase 3 — cutover: new handlers constructed with cursorMode: "v2" (simulating the deploy
  // that flips SYNC_CURSOR_MODE for this environment), same underlying tables.
  const v2Push = freshPushHandler(client, { cursorMode: "v2" });
  const v2Pull = freshPullHandler(client, { cursorMode: "v2" });

  // The client, still holding its OLD legacy-format cursor, pulls against the NOW-v2 backend.
  const migrationPull = await pullVia(v2Pull, sub, staleClientCursor);
  assert.equal(migrationPull.changes.length, 2, "a legacy cursor triggers exactly one full replay, recovering 'a' AND 'b' (which this client never saw)");
  assert.match(migrationPull.cursor, /^\d+$/, "the client now holds a valid v2 cursor");

  // Ordinary incremental sync resumes correctly post-cutover, with no further replay needed.
  await pushVia(v2Push, sub, "device-B", [change({ id: "c", record: { id: "c", rev: 1 } })]);
  const incrementalPull = await pullVia(v2Pull, sub, migrationPull.cursor);
  assert.equal(incrementalPull.changes.length, 1);
  assert.equal(incrementalPull.changes[0].id, "c");
});
