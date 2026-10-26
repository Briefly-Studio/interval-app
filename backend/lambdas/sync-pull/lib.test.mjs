// Focused unit tests for backend/lambdas/sync-pull/lib.mjs. Run with `npm run test:sync`
// (Node's built-in test runner). Excluded from the deployed Lambda package.
//
// cursorForRow (SK-based) was removed along with the SK-based cursor scheme it supported — see
// docs/sync-cursor-semantics.md. parseCursor/buildPullQueryParams/nextCursorForPage below are its
// replacement: pull now orders by a server-assigned `seq`, queried with `ConsistentRead: true`
// against `Interval_ChangeStream`'s own BASE TABLE — REWORKED from an earlier `BySeq` GSI design
// after a review found a GSI can never serve a strongly-consistent query (see lib.mjs's own
// header comment for the full analysis) — never by the client domain timestamp embedded in the
// old SK.

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PULL_LIMIT,
  MAX_PULL_LIMIT,
  buildLegacyPullQueryParams,
  buildPullQueryParams,
  getUserSub,
  isLegacyChangeRow,
  nextCursorForPage,
  nextLegacyCursorForPage,
  parseCursor,
  resolvePullLimit,
  resolveSyncCursorMode,
} from "./lib.mjs";

test("resolvePullLimit: undefined/NaN/0/negative fall back to the default; positive values cap at MAX", () => {
  assert.equal(resolvePullLimit(undefined), DEFAULT_PULL_LIMIT);
  assert.equal(resolvePullLimit("abc"), DEFAULT_PULL_LIMIT);
  assert.equal(resolvePullLimit("0"), DEFAULT_PULL_LIMIT);
  assert.equal(resolvePullLimit("-5"), DEFAULT_PULL_LIMIT);
  assert.equal(resolvePullLimit("50"), 50);
  assert.equal(resolvePullLimit("999"), MAX_PULL_LIMIT);
  assert.equal(resolvePullLimit("200.9"), 200);
});

test("getUserSub reads v2 JWT claims, v1 claims, loose sub, else null", () => {
  assert.equal(getUserSub({ requestContext: { authorizer: { jwt: { claims: { sub: "s2" } } } } }), "s2");
  assert.equal(getUserSub({ requestContext: { authorizer: { claims: { sub: "s1" } } } }), "s1");
  assert.equal(getUserSub({ requestContext: { authorizer: { sub: "s0" } } }), "s0");
  assert.equal(getUserSub({}), null);
});

// ---------------------------------------------------------------------------
// parseCursor — test matrix includes every shape section 21 of the mission asks for: empty,
// first pull, same timestamp multiple ids (N/A to seq — no longer ambiguous), malformed cursor,
// legacy cursor.
// ---------------------------------------------------------------------------

test("parseCursor: absent/null/empty all mean full replay, never legacy", () => {
  assert.deepEqual(parseCursor(undefined), { mode: "full", legacy: false });
  assert.deepEqual(parseCursor(null), { mode: "full", legacy: false });
  assert.deepEqual(parseCursor(""), { mode: "full", legacy: false });
});

test("parseCursor: a plain non-negative integer string is the new incremental format", () => {
  assert.deepEqual(parseCursor("0"), { mode: "incremental", seq: 0, legacy: false });
  assert.deepEqual(parseCursor("42"), { mode: "incremental", seq: 42, legacy: false });
  assert.deepEqual(parseCursor("9007199254740991"), { mode: "incremental", seq: 9007199254740991, legacy: false });
});

test("parseCursor: the OLD pipe-delimited changeKey format is detected as legacy and forces a full replay", () => {
  const legacyCursor = "2026-08-31T00:00:00.000Z|dev-abc|deck|deck-1|upsert";
  assert.deepEqual(parseCursor(legacyCursor), { mode: "full", legacy: true });
});

test("parseCursor: malformed/garbage values are treated as legacy, never thrown and never used in a query", () => {
  for (const bad of ["abc", "-1", "1.5", "42 ", " 42", "0x1A", "Infinity", "NaN", "42|extra", "'; DROP TABLE", "<script>"]) {
    assert.deepEqual(parseCursor(bad), { mode: "full", legacy: true }, `expected legacy for ${JSON.stringify(bad)}`);
  }
});

test("parseCursor: a syntactically-valid but unsafe-integer string is also treated as legacy, defensively", () => {
  // 2^53 and above can't round-trip exactly through Number — reject rather than risk an
  // off-by-one cursor, even though this is astronomically unlikely in real change volume.
  assert.deepEqual(parseCursor("9007199254740993"), { mode: "full", legacy: true });
});

// ---------------------------------------------------------------------------
// buildPullQueryParams — always targets Interval_ChangeStream's own BASE TABLE (never an index)
// with ConsistentRead: true; never trusts the cursor's own shape beyond what parseCursor already
// validated; ownerPk always comes from trusted claims, never from the cursor itself, so no
// cursor value can cause cross-user access (security requirement).
// ---------------------------------------------------------------------------

test("buildPullQueryParams: full replay omits the sort-key condition entirely, and always requests ConsistentRead", () => {
  const params = buildPullQueryParams({
    tableName: "ChangeStream", ownerPk: "U#alice", parsed: { mode: "full", legacy: false }, limit: 200,
  });
  assert.deepEqual(params, {
    TableName: "ChangeStream",
    Limit: 200,
    ScanIndexForward: true,
    ConsistentRead: true,
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": "U#alice" },
  });
});

test("buildPullQueryParams: incremental pull adds the seq > :cursor condition with the numeric value, and still requests ConsistentRead", () => {
  const params = buildPullQueryParams({
    tableName: "ChangeStream", ownerPk: "U#alice", parsed: { mode: "incremental", seq: 42, legacy: false }, limit: 200,
  });
  assert.deepEqual(params, {
    TableName: "ChangeStream",
    Limit: 200,
    ScanIndexForward: true,
    ConsistentRead: true,
    KeyConditionExpression: "PK = :pk AND #seq > :cursor",
    ExpressionAttributeNames: { "#seq": "seq" },
    ExpressionAttributeValues: { ":pk": "U#alice", ":cursor": 42 },
  });
});

test("buildPullQueryParams: never targets a secondary index — no IndexName in the output under any cursor mode", () => {
  for (const parsed of [{ mode: "full", legacy: false }, { mode: "incremental", seq: 1, legacy: false }]) {
    const params = buildPullQueryParams({ tableName: "ChangeStream", ownerPk: "U#alice", parsed, limit: 10 });
    assert.equal("IndexName" in params, false, "a GSI would reintroduce the eventual-consistency gap this fix removed");
    assert.equal(params.ConsistentRead, true);
  }
});

test("buildPullQueryParams: ownerPk is used verbatim and only as the partition-key value — never interpolated into the expression string", () => {
  const params = buildPullQueryParams({
    tableName: "ChangeStream", ownerPk: "U#bob", parsed: { mode: "full", legacy: false }, limit: 10,
  });
  assert.equal(params.KeyConditionExpression.includes("U#bob"), false);
  assert.equal(params.ExpressionAttributeValues[":pk"], "U#bob");
});

// ---------------------------------------------------------------------------
// nextCursorForPage — every Interval_ChangeStream item is guaranteed to carry a numeric `seq` (it
// is that table's own primary sort key), so there is no "unkeyable row" edge case left (unlike
// the old SK-based version this replaces).
// ---------------------------------------------------------------------------

test("nextCursorForPage: empty page keeps the incoming cursor and does not advance", () => {
  assert.deepEqual(nextCursorForPage([], "7"), { cursor: "7", advanced: false });
  assert.deepEqual(nextCursorForPage([], null), { cursor: "", advanced: false });
});

test("nextCursorForPage: normal page advances to the last row's seq, stringified", () => {
  const items = [{ seq: 10 }, { seq: 11 }, { seq: 12 }];
  assert.deepEqual(nextCursorForPage(items, "9"), { cursor: "12", advanced: true });
});

test("nextCursorForPage: advances correctly from a full-replay (no incoming cursor) first page", () => {
  const items = [{ seq: 1 }, { seq: 2 }];
  assert.deepEqual(nextCursorForPage(items, null), { cursor: "2", advanced: true });
});

test("nextCursorForPage: same-server-timestamp-no-longer-relevant — multiple rows, still a single strictly increasing seq each, advances to the true last", () => {
  // Two changes that happened to be accepted in the same server millisecond still get two
  // DISTINCT seq values (assignSequenceAndAppendChangeLog's transactional assignment guarantees
  // uniqueness) — there is no same-millisecond tie-break ambiguity left to test, which is
  // itself the point.
  const items = [{ seq: 100 }, { seq: 101 }];
  assert.deepEqual(nextCursorForPage(items, "99"), { cursor: "101", advanced: true });
});

test("nextCursorForPage: defensively keeps the incoming cursor if a row somehow lacks a numeric seq (should not happen for a real ChangeStream result — seq is its own primary key)", () => {
  assert.deepEqual(nextCursorForPage([{ notSeq: 1 }], "5"), { cursor: "5", advanced: false });
  assert.deepEqual(nextCursorForPage([{ seq: "not-a-number" }], "5"), { cursor: "5", advanced: false });
});

// ---------------------------------------------------------------------------
// Dual-mode rollout flags (post-deployability audit) — resolveSyncCursorMode must fail closed;
// the LEGACY query/cursor/filter functions must reproduce the exact pre-this-fix behavior. See
// lib.mjs's own header comment's "Dual-mode rollout" section.
// ---------------------------------------------------------------------------

test("resolveSyncCursorMode: only the exact literal 'v2' activates v2 — everything else resolves to legacy", () => {
  assert.equal(resolveSyncCursorMode("v2"), "v2");
  for (const bad of [undefined, null, "", "V2", "v3", " v2", "v2 ", "legacy"]) {
    assert.equal(resolveSyncCursorMode(bad), "legacy", `expected legacy for ${JSON.stringify(bad)}`);
  }
});

test("buildLegacyPullQueryParams: full replay omits the sort-key condition; no ConsistentRead, no IndexName — byte-for-byte the pre-this-fix shape", () => {
  const params = buildLegacyPullQueryParams({ tableName: "Changes", ownerPk: "U#alice", cursor: null, limit: 200 });
  assert.deepEqual(params, {
    TableName: "Changes",
    Limit: 200,
    ScanIndexForward: true,
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": "U#alice" },
  });
  assert.equal("ConsistentRead" in params, false);
});

test("buildLegacyPullQueryParams: an incremental pull adds SK > :cursor with the raw cursor string verbatim", () => {
  const params = buildLegacyPullQueryParams({ tableName: "Changes", ownerPk: "U#alice", cursor: "C#2026-01-01T00:00:00.000Z|dev-A|card|x|upsert", limit: 50 });
  assert.deepEqual(params, {
    TableName: "Changes",
    Limit: 50,
    ScanIndexForward: true,
    KeyConditionExpression: "PK = :pk AND SK > :cursor",
    ExpressionAttributeValues: { ":pk": "U#alice", ":cursor": "C#2026-01-01T00:00:00.000Z|dev-A|card|x|upsert" },
  });
});

test("isLegacyChangeRow: true only for a real change row (SK starts with C#) — false for the counter sentinel row or anything else", () => {
  assert.equal(isLegacyChangeRow({ SK: "C#2026-01-01T00:00:00.000Z|dev-A|card|x|upsert" }), true);
  assert.equal(isLegacyChangeRow({ SK: "SEQ#COUNTER", seqValue: 5 }), false);
  assert.equal(isLegacyChangeRow({}), false);
  assert.equal(isLegacyChangeRow(undefined), false);
});

test("nextLegacyCursorForPage: advances to the last RAW item's SK, even when that item is the counter sentinel row filtered out of the delivered list", () => {
  const items = [{ SK: "C#a" }, { SK: "C#b" }, { SK: "SEQ#COUNTER", seqValue: 3 }];
  // The counter row IS the last raw item — the cursor must still advance past it (never stall
  // forever just before it), even though isLegacyChangeRow would exclude it from `changes`.
  assert.deepEqual(nextLegacyCursorForPage(items, "C#0"), { cursor: "SEQ#COUNTER", advanced: true });
});

test("nextLegacyCursorForPage: empty page keeps the incoming cursor and does not advance", () => {
  assert.deepEqual(nextLegacyCursorForPage([], "C#a"), { cursor: "C#a", advanced: false });
  assert.deepEqual(nextLegacyCursorForPage([], null), { cursor: "", advanced: false });
});
