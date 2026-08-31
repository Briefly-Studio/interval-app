// Focused unit tests for backend/lambdas/sync-pull/lib.mjs. Run with `npm run test:sync`
// (Node's built-in test runner). Excluded from the deployed Lambda package.

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PULL_LIMIT,
  MAX_PULL_LIMIT,
  cursorForRow,
  getUserSub,
  nextCursorForPage,
  resolvePullLimit,
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

test("cursorForRow: uses SK (minus C# prefix) as the authoritative source", () => {
  assert.equal(cursorForRow({ SK: "C#ts|dev|deck|d1|upsert", changeKey: "ts|dev|deck|d1|upsert" }), "ts|dev|deck|d1|upsert");
});

test("cursorForRow: missing changeKey ATTRIBUTE still yields a cursor from the SK", () => {
  assert.equal(cursorForRow({ SK: "C#legacy-key-value" }), "legacy-key-value");
});

test("cursorForRow: SK not C#-shaped falls back to changeKey, then null", () => {
  assert.equal(cursorForRow({ SK: "X#weird", changeKey: "the-key" }), "the-key");
  assert.equal(cursorForRow({ SK: "X#weird" }), null);
  assert.equal(cursorForRow({}), null);
  assert.equal(cursorForRow(null), null);
});

test("nextCursorForPage: empty page keeps the incoming cursor and does not advance", () => {
  assert.deepEqual(nextCursorForPage([], "prev-cursor"), { cursor: "prev-cursor", advanced: false });
  assert.deepEqual(nextCursorForPage([], null), { cursor: "", advanced: false });
});

test("nextCursorForPage: normal page advances to the last row's key", () => {
  const items = [
    { SK: "C#k1", changeKey: "k1" },
    { SK: "C#k2", changeKey: "k2" },
    { SK: "C#k3", changeKey: "k3" },
  ];
  const r = nextCursorForPage(items, "k0");
  assert.equal(r.cursor, "k3");
  assert.equal(r.advanced, true);
  assert.equal(r.unkeyedTrailingRows, 0);
});

test("nextCursorForPage: last row missing changeKey but with a valid SK still advances (finding 3)", () => {
  const items = [
    { SK: "C#k1", changeKey: "k1" },
    { SK: "C#k2" }, // legacy row, no changeKey attribute
  ];
  const r = nextCursorForPage(items, "k0");
  assert.equal(r.cursor, "k2");
  assert.equal(r.advanced, true);
});

test("nextCursorForPage: trailing rows with an unusable SK are walked past to the last keyable row (no skip)", () => {
  const items = [
    { SK: "C#k1", changeKey: "k1" },
    { SK: "C#k2", changeKey: "k2" },
    { SK: "MALFORMED" }, // cannot be keyed
    { SK: "ALSO-BAD" },
  ];
  const r = nextCursorForPage(items, "k0");
  assert.equal(r.cursor, "k2"); // last keyable row; k3/k4 already returned in this page's changes
  assert.equal(r.advanced, true);
  assert.equal(r.unkeyedTrailingRows, 2);
});

test("nextCursorForPage: a page with NO keyable row keeps the incoming cursor (deterministic, no invented cursor)", () => {
  const items = [{ SK: "MALFORMED" }, { SK: "STILL-BAD" }];
  const r = nextCursorForPage(items, "k0");
  assert.deepEqual(r, { cursor: "k0", advanced: false });
});

test("nextCursorForPage: mixed valid/legacy rows — advances to the last row's SK", () => {
  const items = [
    { SK: "C#k1" }, // legacy
    { SK: "C#k2", changeKey: "k2" }, // current
    { SK: "C#k3" }, // legacy, last
  ];
  const r = nextCursorForPage(items, null);
  assert.equal(r.cursor, "k3");
  assert.equal(r.advanced, true);
});
