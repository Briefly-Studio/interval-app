// Tests for backend/scripts/backfill-change-sequence.mjs — the one-time migration tool for the
// sync-cursor-hardening fix (docs/sync-cursor-semantics.md). Run with `npm run test:sync`.
//
// Imports the script's own exported pure helpers and DI'd pass/convergence-loop drivers directly
// (never invoking `main()` — guarded by this file's own `import.meta.url` check at the bottom of
// the script, so importing it for its exports never touches real argv or the real AWS SDK).
// FakeBackfillDdbClient models exactly the Scan/Get/TransactWriteItems semantics the script
// actually uses — same scoping discipline as every other Fake*Client in this repository's test
// suites, not a general DynamoDB emulator.

import assert from "node:assert/strict";
import test from "node:test";

import {
  SEQUENCE_COUNTER_SK,
  buildBackfillTransactItems,
  computeIntegrityMismatches,
  groupAndSortUnmigratedRows,
  isUnmigratedChangeRow,
  runBackfillPass,
  runConvergenceLoop,
} from "./backfill-change-sequence.mjs";

class FakeScanCommand {
  constructor(input) {
    this.kind = "scan";
    this.input = input;
  }
}
class FakeGetCommand {
  constructor(input) {
    this.kind = "get";
    this.input = input;
  }
}
class FakeTransactWriteCommand {
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

class FakeBackfillDdbClient {
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
  seedChangeRow(row) {
    this.table("Changes").set(this.key({ PK: row.PK, SK: row.SK }), { ...row });
  }
  async send(command) {
    const { kind, input } = command;
    if (kind === "scan") {
      return { Items: [...this.table(input.TableName).values()] };
    }
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

function historicalRow(pk, changeKey, over = {}) {
  const [ts, deviceId, entity, id, op] = changeKey.split("|");
  return {
    PK: pk,
    SK: `C#${changeKey}`,
    changeKey,
    deviceId,
    id,
    entity,
    op,
    ts,
    record: { id, rev: 1 },
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("isUnmigratedChangeRow: true only for a real change row (SK starts with C#) lacking a seq", () => {
  assert.equal(isUnmigratedChangeRow({ SK: "C#x", seq: undefined }), true);
  assert.equal(isUnmigratedChangeRow({ SK: "C#x", seq: 5 }), false);
  assert.equal(isUnmigratedChangeRow({ SK: SEQUENCE_COUNTER_SK, seqValue: 5 }), false);
  assert.equal(isUnmigratedChangeRow({ SK: undefined }), false);
});

test("groupAndSortUnmigratedRows: groups by PK and sorts each group ascending by changeKey", () => {
  const rows = [
    historicalRow("U#alice", "2026-03-01T00:00:00.000Z|device-A|card|a|upsert"),
    historicalRow("U#bob", "2026-01-01T00:00:00.000Z|device-A|card|b|upsert"),
    historicalRow("U#alice", "2026-01-01T00:00:00.000Z|device-A|card|c|upsert"),
    { PK: "U#alice", SK: SEQUENCE_COUNTER_SK, seqValue: 3 }, // never a candidate
    historicalRow("U#alice", "2026-02-01T00:00:00.000Z|device-A|card|d|upsert", { seq: 1 }), // already migrated
  ];
  const grouped = groupAndSortUnmigratedRows(rows);
  assert.deepEqual([...grouped.keys()].sort(), ["U#alice", "U#bob"]);
  assert.deepEqual(grouped.get("U#alice").map((r) => r.id), ["c", "a"]); // Jan before Mar
  assert.deepEqual(grouped.get("U#bob").map((r) => r.id), ["b"]);
});

test("buildBackfillTransactItems: exact three-action shape, independent of the live push path's own builder", () => {
  const row = historicalRow("U#alice", "2026-01-01T00:00:00.000Z|device-A|card|x|upsert");
  const items = buildBackfillTransactItems({ table: "Changes", streamTable: "ChangeStream", row, currentSeqValue: 0, nextSeq: 1 });
  assert.equal(items.length, 3);
  assert.deepEqual(items[0].Update.Key, { PK: "U#alice", SK: row.SK });
  assert.equal(items[0].Update.ConditionExpression, "attribute_not_exists(#seq)");
  assert.deepEqual(items[1].Update.Key, { PK: "U#alice", SK: SEQUENCE_COUNTER_SK });
  assert.deepEqual(items[1].Update.ExpressionAttributeValues, { ":next": 1, ":current": 0 });
  assert.equal(items[2].Put.TableName, "ChangeStream");
  assert.deepEqual(items[2].Put.Item, { PK: "U#alice", seq: 1, id: "x", entity: "card", op: "upsert", ts: row.ts, record: row.record });
});

test("computeIntegrityMismatches: no mismatches when Changes/ChangeStream row counts agree per user", () => {
  const changeRows = [
    { PK: "U#alice", SK: "C#a" },
    { PK: "U#alice", SK: "C#b" },
    { PK: "U#alice", SK: SEQUENCE_COUNTER_SK }, // must be excluded from the count
    { PK: "U#bob", SK: "C#c" },
  ];
  const streamRows = [{ PK: "U#alice", seq: 1 }, { PK: "U#alice", seq: 2 }, { PK: "U#bob", seq: 1 }];
  assert.deepEqual(computeIntegrityMismatches({ changeRows, streamRows }), []);
});

test("computeIntegrityMismatches: reports a user whose Changes/ChangeStream counts disagree", () => {
  const changeRows = [{ PK: "U#alice", SK: "C#a" }, { PK: "U#alice", SK: "C#b" }];
  const streamRows = [{ PK: "U#alice", seq: 1 }]; // missing the second row's stream counterpart
  const mismatches = computeIntegrityMismatches({ changeRows, streamRows });
  assert.deepEqual(mismatches, [{ pk: "U#alice", changeCount: 2, streamCount: 1 }]);
});

// ---------------------------------------------------------------------------
// runBackfillPass / runConvergenceLoop
// ---------------------------------------------------------------------------

function deps(client) {
  return {
    client,
    ScanCommandCtor: FakeScanCommand,
    GetCommandCtor: FakeGetCommand,
    TransactWriteCommandCtor: FakeTransactWriteCommand,
    table: "Changes",
    streamTable: "ChangeStream",
    log: () => {}, // silence
  };
}

test("runBackfillPass (dry run): reports counts without writing anything", async () => {
  const client = new FakeBackfillDdbClient();
  client.seedChangeRow(historicalRow("U#alice", "2026-01-01T00:00:00.000Z|device-A|card|a|upsert"));
  client.seedChangeRow(historicalRow("U#alice", "2026-01-02T00:00:00.000Z|device-A|card|b|upsert"));

  const result = await runBackfillPass({ ...deps(client), execute: false });
  assert.equal(result.totalUnmigrated, 2);
  assert.equal(result.totalAssigned, 2);
  assert.equal(client.table("ChangeStream").size, 0, "dry run must write nothing");
  assert.equal(client.table("Changes").get(`U#alice|${SEQUENCE_COUNTER_SK}`), undefined);
});

test("runBackfillPass (execute): assigns seq in changeKey order, advances the counter, and writes a matching stream row for each", async () => {
  const client = new FakeBackfillDdbClient();
  client.seedChangeRow(historicalRow("U#alice", "2026-03-01T00:00:00.000Z|device-A|card|later|upsert"));
  client.seedChangeRow(historicalRow("U#alice", "2026-01-01T00:00:00.000Z|device-A|card|earlier|upsert"));

  const result = await runBackfillPass({ ...deps(client), execute: true });
  assert.equal(result.totalAssigned, 2);

  const changesTable = client.table("Changes");
  const earlier = changesTable.get(`U#alice|C#2026-01-01T00:00:00.000Z|device-A|card|earlier|upsert`);
  const later = changesTable.get(`U#alice|C#2026-03-01T00:00:00.000Z|device-A|card|later|upsert`);
  assert.equal(earlier.seq, 1, "the chronologically-earlier row gets the lower seq");
  assert.equal(later.seq, 2);
  assert.equal(changesTable.get(`U#alice|${SEQUENCE_COUNTER_SK}`).seqValue, 2);

  const streamTable = client.table("ChangeStream");
  assert.deepEqual(streamTable.get("U#alice|seq#1").id, "earlier");
  assert.deepEqual(streamTable.get("U#alice|seq#2").id, "later");
});

test("runBackfillPass: continuing from an existing counter value (historical rows backfilled alongside already-live real pushes) never collides", async () => {
  const client = new FakeBackfillDdbClient();
  // Simulate the counter already having been advanced by a real push (seq=1 already taken).
  client.table("Changes").set(`U#alice|${SEQUENCE_COUNTER_SK}`, { PK: "U#alice", SK: SEQUENCE_COUNTER_SK, seqValue: 1 });
  client.table("ChangeStream").set("U#alice|seq#1", { PK: "U#alice", seq: 1, id: "real-push" });
  client.seedChangeRow(historicalRow("U#alice", "2025-01-01T00:00:00.000Z|device-A|card|historical|upsert"));

  const result = await runBackfillPass({ ...deps(client), execute: true });
  assert.equal(result.totalAssigned, 1);
  assert.equal(client.table("ChangeStream").get("U#alice|seq#2").id, "historical");
  assert.equal(client.table("Changes").get(`U#alice|${SEQUENCE_COUNTER_SK}`).seqValue, 2);
});

test("runBackfillPass: re-running after a prior successful run is a safe no-op (idempotent)", async () => {
  const client = new FakeBackfillDdbClient();
  client.seedChangeRow(historicalRow("U#alice", "2026-01-01T00:00:00.000Z|device-A|card|a|upsert"));

  const first = await runBackfillPass({ ...deps(client), execute: true });
  assert.equal(first.totalAssigned, 1);
  const second = await runBackfillPass({ ...deps(client), execute: true });
  assert.equal(second.totalUnmigrated, 0, "nothing left to migrate the second time");
  assert.equal(client.table("ChangeStream").size, 1, "re-running must not create a duplicate stream row");
});

test("runConvergenceLoop: a straggler written mid-run (simulating an imperfect write freeze) is caught by a later pass", async () => {
  const client = new FakeBackfillDdbClient();
  client.seedChangeRow(historicalRow("U#alice", "2026-01-01T00:00:00.000Z|device-A|card|a|upsert"));

  let stragglerInjected = false;
  class InjectingScanCommand extends FakeScanCommand {}
  const injectingClient = {
    send: async (command) => {
      if (command.kind === "scan" && !stragglerInjected) {
        stragglerInjected = true;
        // A "live push" sneaks a brand-new unmigrated row in between this pass's scan and the
        // NEXT pass's scan — exactly the race the review asked to be audited.
        client.seedChangeRow(historicalRow("U#alice", "2026-01-02T00:00:00.000Z|device-A|card|straggler|upsert"));
      }
      return client.send(command);
    },
  };

  const result = await runConvergenceLoop({ ...deps(injectingClient), execute: true, maxPasses: 5 });
  assert.equal(result.converged, true);
  assert.ok(result.passesRun >= 2, "the straggler must have required at least one extra pass to catch");
  const streamTable = client.table("ChangeStream");
  assert.equal(streamTable.size, 2, "both the original row and the straggler must end up migrated");
  assert.ok([...streamTable.values()].some((r) => r.id === "straggler"));
});

test("runConvergenceLoop: non-converging backfill (stragglers keep appearing every pass) fails loudly after maxPasses, never reporting false success", async () => {
  const client = new FakeBackfillDdbClient();
  client.seedChangeRow(historicalRow("U#alice", "2026-01-01T00:00:00.000Z|device-A|card|a|upsert"));

  let passCount = 0;
  const continuouslyWritingClient = {
    send: async (command) => {
      if (command.kind === "scan") {
        // Every single pass, a new straggler appears — modeling writes that were NEVER actually
        // frozen, the exact failure mode this loop must refuse to paper over.
        passCount += 1;
        client.seedChangeRow(historicalRow("U#alice", `2026-01-0${passCount + 1}T00:00:00.000Z|device-A|card|straggler-${passCount}|upsert`));
      }
      return client.send(command);
    },
  };

  const result = await runConvergenceLoop({ ...deps(continuouslyWritingClient), execute: true, maxPasses: 3 });
  assert.equal(result.converged, false, "must never claim convergence while stragglers keep appearing");
  assert.equal(result.passesRun, 3);
});

test("runConvergenceLoop (dry run): reports the single pass's findings without looping or claiming writes happened", async () => {
  const client = new FakeBackfillDdbClient();
  client.seedChangeRow(historicalRow("U#alice", "2026-01-01T00:00:00.000Z|device-A|card|a|upsert"));

  const result = await runConvergenceLoop({ ...deps(client), execute: false, maxPasses: 5 });
  assert.equal(result.converged, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.passesRun, 1);
  assert.equal(client.table("ChangeStream").size, 0);
});
