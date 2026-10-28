import { createHash, randomUUID } from "node:crypto";
import { acquireConcurrencyLease, releaseConcurrencyLease, quotaKey, leaseKey } from "./rateLimiter.mjs";

export const IDEMPOTENCY = { retentionSeconds: 86400, leaseSeconds: 60, maxResponseBytes: 256 * 1024 };
export const validRequestId = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export function resolveIdempotencyMode(value) {
  if (value === undefined || value === "legacy") return "legacy";
  return value === "optional" ? "optional" : "required"; // malformed configuration cannot bypass keys
}
export const requestKey = (sub, requestId) => ({ PK: `U#${sub}`, SK: `R#${requestId}` });
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(v => canonical(v ?? null)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
};
/** Hash only; neither canonical source text nor prompt is retained. IDs/auth are excluded. */
export function requestFingerprint(request, context, modelIdentity) {
  const { requestId, generationAttemptId, ...semantics } = request;
  // Include every request field (including future options) and bounded context, in array order.
  return createHash("sha256").update(canonical({ request: semantics, context, modelIdentity })).digest("hex");
}
const response = (statusCode, error, retryable = false) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify({ error, retryable }) });
const unknown = () => response(503, "request-outcome-unknown");
const storageFailure = () => response(503, "idempotency-storage-failure", true);
const safeLog = (category, request) => console.log("[ai-idempotency]", { category, requestId: request.requestId, generationAttemptId: request.generationAttemptId });

/** Provider-neutral durable envelope. All SDK commands/clients and provider execution are DI.
 * No reclamation after lease expiry: the conservative outcome is unknown until TTL cleanup.
 * Transactions atomically charge quota + mark provider_started, with owner/lease fencing. */
export async function handleIdempotentRequest({ sub, request, context, execute, deps }) {
  const { client, tableName, rateLimitTableName, Put, Get, Update, Delete, Transact, now = () => new Date(), modelIdentity, policy, configured = true } = deps;
  if (!tableName || !rateLimitTableName) return storageFailure();
  const instant = now(), epoch = Math.floor(instant.getTime() / 1000);
  const key = requestKey(sub, request.requestId), owner = randomUUID();
  const fingerprint = requestFingerprint(request, context, modelIdentity);
  const expiresAt = epoch + IDEMPOTENCY.retentionSeconds;
  const read = async () => (await client.send(new Get({ TableName: tableName, Key: key, ConsistentRead: true }))).Item;
  try {
    await client.send(new Put({ TableName: tableName,
      Item: { ...key, status: "claimed", owner, fingerprint, createdAt: epoch, updatedAt: epoch,
        leaseExpiresAt: epoch + IDEMPOTENCY.leaseSeconds, expiresAt, ttl: expiresAt,
        ...(request.generationAttemptId ? { generationAttemptId: request.generationAttemptId } : {}) },
      ConditionExpression: "attribute_not_exists(PK)" }));
  } catch (error) {
    if (error?.name !== "ConditionalCheckFailedException") { safeLog("claim-storage-failure", request); return storageFailure(); }
    let existing;
    try { existing = await read(); } catch { return storageFailure(); }
    if (!existing) return storageFailure(); // concurrent TTL/delete: retry may claim, never guess
    if (existing.fingerprint !== fingerprint) return response(409, "idempotency-conflict");
    if (existing.expiresAt <= epoch) return unknown();
    if (existing.status === "succeeded" || existing.status === "failed") {
      safeLog("replay", request);
      return { statusCode: existing.responseStatus, body: existing.responseBody,
        headers: { "content-type": "application/json", "x-interval-idempotency-replay": "true", "x-interval-provider-executions": "0" } };
    }
    if (existing.status === "unknown" || existing.leaseExpiresAt <= epoch) return unknown();
    return response(409, "request-in-progress", true);
  }

  const abandonClaim = async () => {
    try { await client.send(new Delete({ TableName: tableName, Key: key,
      ConditionExpression: "#status = :claimed AND #owner = :owner",
      ExpressionAttributeNames: { "#status": "status", "#owner": "owner" },
      ExpressionAttributeValues: { ":claimed": "claimed", ":owner": owner } })); } catch { /* uncertainty stays fail-closed */ }
  };
  if (!configured) { await abandonClaim(); return response(503, "provider-unavailable"); }
  let lease;
  try {
    lease = await acquireConcurrencyLease({ client, PutCommandCtor: Put, tableName: rateLimitTableName, sub, now: instant, leaseTtlSeconds: policy.LEASE_TTL_SECONDS });
  } catch { await abandonClaim(); return storageFailure(); }
  if (!lease.acquired) { await abandonClaim(); return response(429, "generation-in-progress"); }
  try {
    const admissionTime = now(), admissionEpoch = Math.floor(admissionTime.getTime() / 1000);
    const values = { ":claimed": "claimed", ":started": "provider_started", ":owner": owner, ":now": admissionEpoch, ":true": true };
    try {
      await client.send(new Transact({ ClientRequestToken: owner, TransactItems: [
        { Update: { TableName: rateLimitTableName, Key: quotaKey(sub, admissionTime),
          UpdateExpression: "SET #count = if_not_exists(#count, :zero) + :one, #ttl = if_not_exists(#ttl, :ttl)",
          ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
          ExpressionAttributeNames: { "#count": "count", "#ttl": "ttl" },
          ExpressionAttributeValues: { ":zero": 0, ":one": 1, ":limit": policy.DAILY_REQUEST_LIMIT, ":ttl": admissionEpoch + policy.QUOTA_ROW_TTL_SECONDS } } },
        { Update: { TableName: tableName, Key: key,
          UpdateExpression: "SET #status = :started, quotaCharged = :true, updatedAt = :now",
          ConditionExpression: "#status = :claimed AND #owner = :owner AND leaseExpiresAt > :now",
          ExpressionAttributeNames: { "#status": "status", "#owner": "owner" }, ExpressionAttributeValues: values } },
        { ConditionCheck: { TableName: rateLimitTableName, Key: leaseKey(sub),
          ConditionExpression: "leaseToken = :token AND expiresAt > :now",
          ExpressionAttributeValues: { ":token": lease.leaseToken, ":now": admissionEpoch } } },
      ] }));
    } catch (error) {
      // A canceled transaction is atomic. A transport/unknown error may have committed: do not
      // delete a provider_started marker, refund quota, or blindly send another transaction.
      if (error?.name === "TransactionCanceledException" && error.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed") {
        await abandonClaim(); return response(429, "daily-limit-reached");
      }
      if (error?.name === "TransactionCanceledException" && error.CancellationReasons?.[2]?.Code === "ConditionalCheckFailed") {
        await abandonClaim(); return response(429, "generation-in-progress");
      }
      safeLog("admission-unknown", request); return unknown();
    }

    let result;
    try { result = await execute(); } catch { safeLog("provider-outcome-unknown", request); return unknown(); }
    const errorCode = result.statusCode >= 400 ? JSON.parse(result.body).error : undefined;
    const ambiguous = ["generation-timeout", "provider-unavailable", "internal-error"].includes(errorCode);
    if (ambiguous) {
      // Do not claim a definitive provider failure when transport may have lost its response.
      try { await client.send(new Update({ TableName: tableName, Key: key,
        UpdateExpression: "SET #status = :unknown, updatedAt = :now",
        ConditionExpression: "#status = :started AND #owner = :owner",
        ExpressionAttributeNames: { "#status": "status", "#owner": "owner" },
        ExpressionAttributeValues: { ":unknown": "unknown", ":started": "provider_started", ":owner": owner, ":now": Math.floor(now().getTime() / 1000) } })); } catch { /* durable started marker remains */ }
      return unknown();
    }
    if (Buffer.byteLength(result.body, "utf8") > IDEMPOTENCY.maxResponseBytes) { safeLog("response-too-large", request); return unknown(); }
    try {
      await client.send(new Update({ TableName: tableName, Key: key,
        UpdateExpression: "SET #status = :done, responseStatus = :code, responseBody = :body, updatedAt = :now",
        ConditionExpression: "#status = :started AND #owner = :owner",
        ExpressionAttributeNames: { "#status": "status", "#owner": "owner" },
        ExpressionAttributeValues: { ":done": result.statusCode === 200 ? "succeeded" : "failed", ":code": result.statusCode,
          ":body": result.body, ":now": Math.floor(now().getTime() / 1000), ":started": "provider_started", ":owner": owner } }));
    } catch { safeLog("finalization-unknown", request); return unknown(); }
    safeLog(result.statusCode === 200 ? "succeeded" : "failed", request);
    return { ...result, headers: { ...result.headers, "x-interval-idempotency-replay": "false", "x-interval-provider-executions": "1" } };
  } finally {
    await releaseConcurrencyLease({ client, DeleteCommandCtor: Delete, tableName: rateLimitTableName, sub, leaseToken: lease.leaseToken });
  }
}
