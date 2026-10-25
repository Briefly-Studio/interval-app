// Backend-authoritative, per-user daily quota + concurrency limiter for Generate Study Deck.
// Mirrors bedrockClient.mjs's own DI convention exactly: this file imports NOTHING from
// "@aws-sdk/client-dynamodb" or "@aws-sdk/lib-dynamodb" anywhere — every function takes the
// already-constructed DynamoDB Document Client and Command constructors as plain, duck-typed
// parameters, so the whole file is exercised by rateLimiter.test.mjs with zero network access,
// zero AWS credentials, and no dependency on whether the real SDK package happens to be resolvable
// in the test environment. index.mjs is the only file that imports the real SDK classes and
// constructs the real client.
//
// MOBILE COUNTERS ARE NEVER TRUSTED. This is the sole source of truth for both the daily quota and
// the concurrency slot — see docs/ai-generation-foundation.md's "Rate limits and cost controls"
// section for the full policy this implements.
//
// Storage shape (one table, two record kinds — see infra/lib/interval-sync-stack.ts's
// `AiRateLimitsTable` construct):
//   Daily quota bucket: PK = `U#<sub>`, SK = `QUOTA#<UTC-date>`,  attrs: count (number), ttl (epoch s)
//   Concurrency lease:  PK = `U#<sub>`, SK = `LEASE`,             attrs: leaseToken, expiresAt, ttl
//
// Fail-closed contract: every function below either resolves to an explicit allow/deny decision,
// or RE-THROWS a genuine storage error (anything other than ConditionalCheckFailedException) so
// the caller (index.mjs) can treat "limiter state could not be safely determined" as a denial,
// never as an implicit allow.

/** UTC calendar-day string ("YYYY-MM-DD") for a given instant — the daily quota's bucket
 * boundary. Deliberately UTC, not the Lambda's (or any user's) local time zone, so the boundary
 * is the same instant worldwide and is trivially testable with fixed Date objects. */
export function utcDateString(now) {
  return now.toISOString().slice(0, 10);
}

export function quotaKey(sub, now) {
  return { PK: `U#${sub}`, SK: `QUOTA#${utcDateString(now)}` };
}

export function leaseKey(sub) {
  return { PK: `U#${sub}`, SK: "LEASE" };
}

/** Not cryptographically sensitive — only needs to distinguish "whoever currently holds this
 * user's lease" across two near-simultaneous acquisition attempts, so a plain time+random
 * composite (same shape as src/models/deck.ts's own makeId, restated here per this repository's
 * no-shared-module-between-Lambdas convention) is sufficient. */
export function makeLeaseToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toEpochSeconds(date) {
  return Math.floor(date.getTime() / 1000);
}

/**
 * Atomically checks-and-consumes one request against the per-user daily quota. A single
 * conditional UpdateItem — DynamoDB serializes concurrent writes to the same item, so two
 * simultaneous calls at count=19/limit=20 can never both succeed: whichever is processed second
 * sees the already-incremented value and fails its own condition. This is the same conditional-
 * write idiom backend/lambdas/sync-push/index.mjs already relies on for its Records table.
 *
 * `ttlSeconds` sizes the bucket row's native DynamoDB TTL — intentionally generous (a couple of
 * days past the UTC day it buckets) so a slightly-delayed TTL sweep can never delete a row still
 * legitimately being read/written; this is cleanup, not the correctness mechanism (the UTC-date
 * partition key is what actually resets the count each day, independent of whether the previous
 * day's row has been swept yet).
 *
 * Returns `{allowed: true}` or `{allowed: false, reason: "daily-quota-exceeded"}`. Throws (does
 * NOT return `{allowed: false}`) for any other storage error — the caller must treat that as
 * "limiter state unknown," not as a quietly-handled denial, so it can't be mistaken for an
 * ordinary quota rejection in logs/metrics.
 */
export async function checkAndConsumeDailyQuota({ client, UpdateCommandCtor, tableName, sub, now, limit, ttlSeconds }) {
  const nowEpoch = toEpochSeconds(now);
  try {
    await client.send(
      new UpdateCommandCtor({
        TableName: tableName,
        Key: quotaKey(sub, now),
        UpdateExpression: "SET #count = if_not_exists(#count, :zero) + :incr, #ttl = if_not_exists(#ttl, :ttl)",
        ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
        ExpressionAttributeNames: { "#count": "count", "#ttl": "ttl" },
        ExpressionAttributeValues: { ":zero": 0, ":incr": 1, ":limit": limit, ":ttl": nowEpoch + ttlSeconds },
      })
    );
    return { allowed: true };
  } catch (error) {
    if (error?.name === "ConditionalCheckFailedException") {
      return { allowed: false, reason: "daily-quota-exceeded" };
    }
    throw error;
  }
}

/**
 * Atomically acquires this user's single concurrency slot. A conditional PutItem succeeds only
 * when no lease row exists yet, OR the existing one has already expired (`:now > expiresAt`) —
 * the "OR already expired" clause is what makes a crashed/timed-out Lambda self-healing: the NEXT
 * request's own acquisition attempt reclaims the slot deterministically, with no background
 * sweeper and no permanent lockout, rather than relying solely on DynamoDB's native TTL deletion
 * (which is a best-effort background process, not instantaneous — AWS does not guarantee it runs
 * within any particular bound, so it is never the correctness mechanism here, only cleanup).
 *
 * Returns `{acquired: true, leaseToken}` (the caller must hold onto this token to release later)
 * or `{acquired: false, reason: "concurrent-limit"}`. Throws for any other storage error, for the
 * same fail-closed reason as checkAndConsumeDailyQuota above.
 */
export async function acquireConcurrencyLease({ client, PutCommandCtor, tableName, sub, now, leaseTtlSeconds }) {
  const nowEpoch = toEpochSeconds(now);
  const leaseToken = makeLeaseToken();
  const expiresAt = nowEpoch + leaseTtlSeconds;
  try {
    await client.send(
      new PutCommandCtor({
        TableName: tableName,
        Item: { ...leaseKey(sub), leaseToken, expiresAt, ttl: expiresAt },
        ConditionExpression: "attribute_not_exists(PK) OR :now > #expiresAt",
        ExpressionAttributeNames: { "#expiresAt": "expiresAt" },
        ExpressionAttributeValues: { ":now": nowEpoch },
      })
    );
    return { acquired: true, leaseToken };
  } catch (error) {
    if (error?.name === "ConditionalCheckFailedException") {
      return { acquired: false, reason: "concurrent-limit" };
    }
    throw error;
  }
}

/**
 * Releases a previously-acquired lease — a conditional DeleteItem keyed on the exact token this
 * caller was given at acquisition time, never an unconditional delete. This matters for a real
 * race: if this request's own lease happened to expire (e.g. an unusually slow Bedrock call) and
 * a LATER request already stole the slot before this one finishes, an unconditional delete here
 * would wrongly evict that other, legitimate holder. A conditional delete on a stale token simply
 * fails harmlessly instead — exactly the intended outcome, not an error.
 *
 * Deliberately swallows every failure (including a genuine storage error) rather than throwing:
 * this always runs after the real generation attempt has already succeeded or failed, so a
 * release-side hiccup must never turn an otherwise-complete response into a 500. An un-released
 * lease still self-heals via its own `expiresAt` check on the next acquisition attempt — see
 * acquireConcurrencyLease above — so failing to release here is a (bounded, self-correcting)
 * availability cost, never a correctness or security one.
 */
export async function releaseConcurrencyLease({ client, DeleteCommandCtor, tableName, sub, leaseToken }) {
  try {
    await client.send(
      new DeleteCommandCtor({
        TableName: tableName,
        Key: leaseKey(sub),
        ConditionExpression: "leaseToken = :token",
        ExpressionAttributeValues: { ":token": leaseToken },
      })
    );
  } catch (error) {
    // Diagnostic-only, category-level log — see index.mjs's identical convention. A
    // ConditionalCheckFailedException here means the lease was already stolen or already
    // released, which is expected and not logged as a failure; anything else is logged so a
    // genuinely stuck table is at least visible in CloudWatch.
    if (error?.name !== "ConditionalCheckFailedException") {
      console.log("[ai-generate-study-deck] lease release failed:", error?.name || "UnknownError");
    }
  }
}
