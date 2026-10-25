import { test } from "node:test";
import assert from "node:assert/strict";

import {
  acquireConcurrencyLease,
  checkAndConsumeDailyQuota,
  leaseKey,
  makeLeaseToken,
  quotaKey,
  releaseConcurrencyLease,
  utcDateString,
} from "./rateLimiter.mjs";

// A minimal in-memory fake that implements exactly the conditional-write semantics rateLimiter.mjs
// relies on (DynamoDB serializes writes to the same item, so a single-threaded fake correctly
// models "whichever conditional write is processed second sees the already-updated value").
// Distinguishes operations by which fake Command class was used, never by parsing expression
// strings generically — this is a focused test double for THIS file's exact usage, not a general
// DynamoDB emulator.
class FakeDdbClient {
  constructor() {
    this.items = new Map();
  }
  key(k) {
    return `${k.PK}|${k.SK}`;
  }
  conditionalCheckFailed() {
    const err = new Error("The conditional request failed");
    err.name = "ConditionalCheckFailedException";
    return err;
  }
  async send(command) {
    const { kind, input } = command;
    if (kind === "update") {
      const k = this.key(input.Key);
      const existing = this.items.get(k);
      const count = existing?.count ?? 0;
      const limit = input.ExpressionAttributeValues[":limit"];
      if (count >= limit) throw this.conditionalCheckFailed();
      this.items.set(k, { ...input.Key, count: count + 1, ttl: existing?.ttl ?? input.ExpressionAttributeValues[":ttl"] });
      return {};
    }
    if (kind === "put") {
      const k = this.key(input.Item);
      const existing = this.items.get(k);
      const now = input.ExpressionAttributeValues[":now"];
      if (existing && !(now > existing.expiresAt)) throw this.conditionalCheckFailed();
      this.items.set(k, input.Item);
      return {};
    }
    if (kind === "delete") {
      const k = this.key(input.Key);
      const existing = this.items.get(k);
      const token = input.ExpressionAttributeValues[":token"];
      if (!existing || existing.leaseToken !== token) throw this.conditionalCheckFailed();
      this.items.delete(k);
      return {};
    }
    throw new Error(`unrecognized fake command kind: ${kind}`);
  }
}

class ThrowingClient {
  constructor(errorName) {
    this.errorName = errorName;
  }
  async send() {
    const err = new Error("simulated storage outage");
    err.name = this.errorName;
    throw err;
  }
}

class FakeUpdateCommand {
  constructor(input) {
    this.kind = "update";
    this.input = input;
  }
}
class FakePutCommand {
  constructor(input) {
    this.kind = "put";
    this.input = input;
  }
}
class FakeDeleteCommand {
  constructor(input) {
    this.kind = "delete";
    this.input = input;
  }
}

const TABLE = "fake-ai-rate-limits";
const SUB = "user-abc";

function quotaArgs(client, now, overrides = {}) {
  return { client, UpdateCommandCtor: FakeUpdateCommand, tableName: TABLE, sub: SUB, now, limit: 20, ttlSeconds: 172_800, ...overrides };
}

function leaseArgs(client, now, overrides = {}) {
  return { client, PutCommandCtor: FakePutCommand, tableName: TABLE, sub: SUB, now, leaseTtlSeconds: 60, ...overrides };
}

// ---- utcDateString / key helpers ----

test("utcDateString is the UTC calendar date, independent of local time zone framing", () => {
  assert.equal(utcDateString(new Date("2026-03-01T23:59:59.000Z")), "2026-03-01");
  assert.equal(utcDateString(new Date("2026-03-02T00:00:00.000Z")), "2026-03-02");
});

test("quotaKey/leaseKey are namespaced per user and never collide with each other", () => {
  const now = new Date("2026-03-01T12:00:00.000Z");
  assert.deepEqual(quotaKey(SUB, now), { PK: "U#user-abc", SK: "QUOTA#2026-03-01" });
  assert.deepEqual(leaseKey(SUB), { PK: "U#user-abc", SK: "LEASE" });
});

test("makeLeaseToken produces distinct tokens across calls", () => {
  const tokens = new Set(Array.from({ length: 20 }, () => makeLeaseToken()));
  assert.equal(tokens.size, 20);
});

// ---- Daily quota ----

test("quota: the first request of the day is allowed", async () => {
  const client = new FakeDdbClient();
  const now = new Date("2026-03-01T00:00:00.000Z");
  const result = await checkAndConsumeDailyQuota(quotaArgs(client, now));
  assert.deepEqual(result, { allowed: true });
});

test("quota: the 20th request is allowed, the 21st is denied with daily-quota-exceeded", async () => {
  const client = new FakeDdbClient();
  const now = new Date("2026-03-01T00:00:00.000Z");
  for (let i = 0; i < 20; i++) {
    const result = await checkAndConsumeDailyQuota(quotaArgs(client, now));
    assert.equal(result.allowed, true, `request ${i + 1} should be allowed`);
  }
  const denied = await checkAndConsumeDailyQuota(quotaArgs(client, now));
  assert.deepEqual(denied, { allowed: false, reason: "daily-quota-exceeded" });
});

test("quota: a request on the next UTC day resets the count, independent of the prior day's usage", async () => {
  const client = new FakeDdbClient();
  const day1 = new Date("2026-03-01T23:59:59.000Z");
  for (let i = 0; i < 20; i++) {
    await checkAndConsumeDailyQuota(quotaArgs(client, day1));
  }
  assert.deepEqual(await checkAndConsumeDailyQuota(quotaArgs(client, day1)), { allowed: false, reason: "daily-quota-exceeded" });

  const day2 = new Date("2026-03-02T00:00:00.000Z");
  const result = await checkAndConsumeDailyQuota(quotaArgs(client, day2));
  assert.deepEqual(result, { allowed: true });
});

test("quota: a different user's count is completely independent", async () => {
  const client = new FakeDdbClient();
  const now = new Date("2026-03-01T00:00:00.000Z");
  for (let i = 0; i < 20; i++) {
    await checkAndConsumeDailyQuota(quotaArgs(client, now));
  }
  assert.deepEqual(await checkAndConsumeDailyQuota(quotaArgs(client, now)), { allowed: false, reason: "daily-quota-exceeded" });

  const otherUserResult = await checkAndConsumeDailyQuota(quotaArgs(client, now, { sub: "a-different-user" }));
  assert.deepEqual(otherUserResult, { allowed: true });
});

test("quota: a genuine storage error is re-thrown, never silently treated as allowed or denied", async () => {
  const client = new ThrowingClient("InternalServerError");
  const now = new Date("2026-03-01T00:00:00.000Z");
  await assert.rejects(() => checkAndConsumeDailyQuota(quotaArgs(client, now)), /simulated storage outage/);
});

test("quota: repeated calls at the exact boundary behave exactly as if DynamoDB serialized them one at a time", async () => {
  // Models the real guarantee this design depends on: DynamoDB processes conditional writes to
  // the SAME item one at a time, so a sequence of calls reaching count=19 then count=20 can never
  // both read 19 — this test exercises that exact boundary deterministically.
  const client = new FakeDdbClient();
  const now = new Date("2026-03-01T00:00:00.000Z");
  for (let i = 0; i < 19; i++) await checkAndConsumeDailyQuota(quotaArgs(client, now));
  const twentieth = await checkAndConsumeDailyQuota(quotaArgs(client, now));
  const twentyFirst = await checkAndConsumeDailyQuota(quotaArgs(client, now));
  assert.equal(twentieth.allowed, true);
  assert.equal(twentyFirst.allowed, false);
});

// ---- Concurrency lease ----

test("concurrency: the first lease is acquired", async () => {
  const client = new FakeDdbClient();
  const now = new Date("2026-03-01T00:00:00.000Z");
  const result = await acquireConcurrencyLease(leaseArgs(client, now));
  assert.equal(result.acquired, true);
  assert.equal(typeof result.leaseToken, "string");
});

test("concurrency: a second simultaneous request for the same user is denied with concurrent-limit", async () => {
  const client = new FakeDdbClient();
  const now = new Date("2026-03-01T00:00:00.000Z");
  const first = await acquireConcurrencyLease(leaseArgs(client, now));
  assert.equal(first.acquired, true);

  const second = await acquireConcurrencyLease(leaseArgs(client, now));
  assert.deepEqual(second, { acquired: false, reason: "concurrent-limit" });
});

test("concurrency: a different user's lease is completely independent", async () => {
  const client = new FakeDdbClient();
  const now = new Date("2026-03-01T00:00:00.000Z");
  await acquireConcurrencyLease(leaseArgs(client, now));
  const otherUser = await acquireConcurrencyLease(leaseArgs(client, now, { sub: "a-different-user" }));
  assert.equal(otherUser.acquired, true);
});

test("concurrency: the lease is released after a successful generation, freeing the slot immediately", async () => {
  const client = new FakeDdbClient();
  const now = new Date("2026-03-01T00:00:00.000Z");
  const acquired = await acquireConcurrencyLease(leaseArgs(client, now));
  await releaseConcurrencyLease({ client, DeleteCommandCtor: FakeDeleteCommand, tableName: TABLE, sub: SUB, leaseToken: acquired.leaseToken });

  const next = await acquireConcurrencyLease(leaseArgs(client, now));
  assert.equal(next.acquired, true);
});

test("concurrency: the lease is released after a HANDLED failure (e.g. provider error), freeing the slot immediately", async () => {
  const client = new FakeDdbClient();
  const now = new Date("2026-03-01T00:00:00.000Z");
  const acquired = await acquireConcurrencyLease(leaseArgs(client, now));
  // Simulates index.mjs's finally-style release after callModelProvider returned an error —
  // release doesn't care whether generation succeeded or failed, only that it finished.
  await releaseConcurrencyLease({ client, DeleteCommandCtor: FakeDeleteCommand, tableName: TABLE, sub: SUB, leaseToken: acquired.leaseToken });

  const next = await acquireConcurrencyLease(leaseArgs(client, now));
  assert.equal(next.acquired, true);
});

test("concurrency: an expired stale lease (e.g. after a Lambda crash/timeout with no release) can be reacquired", async () => {
  const client = new FakeDdbClient();
  const acquiredAt = new Date("2026-03-01T00:00:00.000Z");
  await acquireConcurrencyLease(leaseArgs(client, acquiredAt, { leaseTtlSeconds: 60 }));

  // Nobody ever released it — simulating a crashed/timed-out Lambda. A request arriving well
  // after the 60s TTL must still be able to reclaim the slot, with no manual intervention.
  const later = new Date("2026-03-01T00:02:00.000Z"); // 120s later
  const result = await acquireConcurrencyLease(leaseArgs(client, later));
  assert.equal(result.acquired, true);
});

test("concurrency: a lease that has NOT yet expired cannot be reclaimed, even moments before expiry", async () => {
  const client = new FakeDdbClient();
  const acquiredAt = new Date("2026-03-01T00:00:00.000Z");
  await acquireConcurrencyLease(leaseArgs(client, acquiredAt, { leaseTtlSeconds: 60 }));

  const almostExpired = new Date("2026-03-01T00:00:59.000Z"); // 59s later, 1s before expiry
  const result = await acquireConcurrencyLease(leaseArgs(client, almostExpired));
  assert.equal(result.acquired, false);
});

test("concurrency: releasing with a stale/mismatched token is a harmless no-op, never evicting a newer holder", async () => {
  const client = new FakeDdbClient();
  const acquiredAt = new Date("2026-03-01T00:00:00.000Z");
  const first = await acquireConcurrencyLease(leaseArgs(client, acquiredAt, { leaseTtlSeconds: 60 }));

  // First lease expires; a second request steals the slot with a NEW token.
  const later = new Date("2026-03-01T00:02:00.000Z");
  const second = await acquireConcurrencyLease(leaseArgs(client, later, { leaseTtlSeconds: 60 }));
  assert.equal(second.acquired, true);
  assert.notEqual(second.leaseToken, first.leaseToken);

  // The FIRST request's own (late) release attempt, using its now-stale token, must not evict
  // the second holder's legitimate lease.
  await releaseConcurrencyLease({ client, DeleteCommandCtor: FakeDeleteCommand, tableName: TABLE, sub: SUB, leaseToken: first.leaseToken });

  const stillHeld = await acquireConcurrencyLease(leaseArgs(client, later, { leaseTtlSeconds: 60 }));
  assert.equal(stillHeld.acquired, false, "the second holder's lease must still be in effect");
});

test("concurrency: a genuine storage error on acquisition is re-thrown, never silently treated as acquired or denied", async () => {
  const client = new ThrowingClient("InternalServerError");
  const now = new Date("2026-03-01T00:00:00.000Z");
  await assert.rejects(() => acquireConcurrencyLease(leaseArgs(client, now)), /simulated storage outage/);
});

test("concurrency: a storage error on release never throws — it is swallowed, since release always runs after the real response is already decided", async () => {
  const client = new ThrowingClient("InternalServerError");
  await assert.doesNotReject(() =>
    releaseConcurrencyLease({ client, DeleteCommandCtor: FakeDeleteCommand, tableName: TABLE, sub: SUB, leaseToken: "any-token" })
  );
});

test("concurrency: two acquisition attempts processed back-to-back for the same user cannot both succeed", async () => {
  const client = new FakeDdbClient();
  const now = new Date("2026-03-01T00:00:00.000Z");
  const results = await Promise.all([acquireConcurrencyLease(leaseArgs(client, now)), acquireConcurrencyLease(leaseArgs(client, now))]);
  const acquiredCount = results.filter((r) => r.acquired).length;
  assert.equal(acquiredCount, 1, "exactly one of the two simultaneous attempts must succeed");
});
