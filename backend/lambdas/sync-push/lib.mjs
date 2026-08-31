// Pure, dependency-free helpers for backend/lambdas/sync-push/index.mjs.
//
// Nothing here imports the AWS SDK or touches DynamoDB — it exists so the request-shape
// validation, per-change classification, batching, and accept/reject decision logic can be
// exercised directly by Node's built-in test runner (`npm run test:sync`) without a bundler,
// mock layer, or any new dependency. `index.mjs` is the only runtime caller; `lib.test.mjs`
// is excluded from the deployed Lambda package (see infra/lib/interval-sync-stack.ts).

// Bounded number of changes accepted in a single push request. The client chunks its dirty set
// into batches of at most `PUSH_BATCH_SIZE` (src/cloud/sync/pushHelpers.mjs, kept <= this by a
// parity test in lib.test.mjs), so a well-behaved client never hits this. It remains a
// deterministic 413 boundary against a malformed/old/external client — nothing is dropped, the
// response is a stable 4xx rather than a slow Lambda timeout.
export const MAX_CHANGES_PER_PUSH = 500;

// How many records' (Changes PutItem + Records UpdateItem) pairs run concurrently. Each record
// targets a distinct Records SK (`E#<entity>#<id>`) and a distinct Changes SK
// (`C#<changeKey>`), and the client never emits two changes for the same id in one push, so
// records are fully independent and safe to process in parallel. Kept conservative (well under
// the AWS SDK Node HTTP handler's default 50-socket pool, even at 2 calls/record) — the goal is
// to remove the sequential wall-clock that caused the 2026-08 timeout incident, not to
// max-parallelize.
export const PUSH_CONCURRENCY = 10;

export function resp(statusCode, obj) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj),
  };
}

// Supports HTTP API (v2) JWT authorizer AND REST API style authorizer.
export function getUserSub(event) {
  const subV2 = event?.requestContext?.authorizer?.jwt?.claims?.sub;
  if (typeof subV2 === "string" && subV2.length) return subV2;

  const subV1 = event?.requestContext?.authorizer?.claims?.sub;
  if (typeof subV1 === "string" && subV1.length) return subV1;

  const subLoose = event?.requestContext?.authorizer?.sub;
  if (typeof subLoose === "string" && subLoose.length) return subLoose;

  return null;
}

export function makeChangeKey(change, deviceId) {
  return `${change.ts}|${deviceId}|${change.entity}|${change.id}|${change.op}`;
}

/**
 * Validates the parsed request body. Returns either `{ ok: true, deviceId, changes }` or
 * `{ ok: false, status, error }` where `status` is the exact HTTP status the handler should
 * return (400 for a malformed shape, 413 for an over-cap change count) — never a 500, so an
 * oversized or malformed request can never masquerade as a server fault.
 */
export function validatePushRequest(body) {
  const deviceId = body?.deviceId;
  const changes = body?.changes;

  if (!deviceId || typeof deviceId !== "string" || !Array.isArray(changes)) {
    return { ok: false, status: 400, error: "Invalid payload" };
  }
  if (changes.length > MAX_CHANGES_PER_PUSH) {
    return {
      ok: false,
      status: 413,
      error: "too_many_changes",
      limit: MAX_CHANGES_PER_PUSH,
      received: changes.length,
    };
  }
  return { ok: true, deviceId, changes };
}

/**
 * Per-change shape check + revision extraction. `{ ok: true, ... }` carries everything the
 * DynamoDB writes need; `{ ok: false, entity, id, reason }` mirrors the handler's existing
 * `invalid_change_shape` rejection (carrying `entity`/`id` best-effort so the response can still
 * key the rejection unambiguously — audit finding 2). A missing/non-numeric `record.rev`
 * resolves to 0 (oldest possible) — never treated as "no rev", which would bypass the conflict
 * check.
 */
export function classifyChange(change) {
  const id = change?.id;
  const entity = change?.entity;
  const op = change?.op;
  const ts = change?.ts;
  const record = change?.record ?? null;

  if (!id || !entity || !op || !ts) {
    return {
      ok: false,
      entity: typeof entity === "string" && entity.length ? entity : "unknown",
      id: typeof id === "string" && id.length ? id : "unknown",
      reason: "invalid_change_shape",
    };
  }

  const incomingRev =
    typeof record?.rev === "number" && Number.isFinite(record.rev) ? record.rev : 0;

  return { ok: true, id, entity, op, ts, record, incomingRev };
}

/**
 * Turns the record-update + change-log outcomes for ONE change into an accept/reject decision.
 * The invariant this encodes: a record is `accepted` only when the Records snapshot was actually
 * updated (or already current) AND the change-log row is present (freshly written or a benign
 * idempotent duplicate). A real change-log write failure after a successful snapshot update is a
 * torn state → NOT acknowledged, so the client keeps the record dirty and retries (the Records
 * UpdateItem is idempotent on retry, and the Changes PutItem is retried too).
 */
export function decidePushOutcome({
  recordUpdated,
  recordError,
  changelogWritten,
  changelogDuplicate,
  changelogError,
}) {
  if (!recordUpdated) {
    return { status: "rejected", reason: recordError || "UpdateItem_failed" };
  }
  if (changelogWritten || changelogDuplicate) {
    return { status: "accepted" };
  }
  return { status: "rejected", reason: `changelog_write_failed:${changelogError || "unknown"}` };
}

/** Splits `arr` into ordered chunks of at most `size`. `size <= 0` yields a single chunk. */
export function chunk(arr, size) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  if (!Number.isFinite(size) || size <= 0) return [arr.slice()];
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
