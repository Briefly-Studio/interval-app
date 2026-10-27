// Dependency-free helpers for backend/lambdas/sync-push/index.mjs.
//
// Most of this file is pure (request-shape validation, per-change classification, batching,
// accept/reject decision logic, and the exact TransactWriteItems shape below) and imports
// nothing. `assignSequenceAndAppendChangeLog` is the one exception — it touches DynamoDB, but via
// the exact same dependency-injection convention `backend/lambdas/ai-generate-study-deck/
// rateLimiter.mjs` already established: the already-constructed client and Command CONSTRUCTORs
// are passed in as plain parameters, so this file still never imports
// "@aws-sdk/client-dynamodb"/"@aws-sdk/lib-dynamodb" itself. This is what lets every function
// here — including the DynamoDB-touching one — be exercised directly by Node's built-in test
// runner (`npm run test:sync`) with a small in-memory fake client, no bundler, no real AWS
// credentials. `index.mjs` is the only runtime caller and the only file that imports the real SDK
// classes; `lib.test.mjs` is excluded from the deployed Lambda package (see
// infra/lib/interval-sync-stack.ts).
//
// REWORKED (sync-cursor-hardening, post-review): an earlier version of this fix assigned `seq`
// via a plain atomic counter increment, then wrote the change-log row as a SEPARATE, later call,
// read back through a GSI. A pre-founder-QA review found that unsound for two independent
// reasons — see docs/sync-cursor-semantics.md's "Root cause" section for the full analysis:
//   1. GSIs are always eventually consistent (no `ConsistentRead` option exists for one), with no
//      documented guarantee that two different items' propagation preserves their relative write
//      order — so a cursor could receive a higher seq before a lower one had even become visible.
//   2. Independent of the GSI: "claim the next seq" and "durably write the row under it" were two
//      separate, non-atomic calls, so a slower holder of a LOWER seq could commit its row AFTER a
//      faster holder of a HIGHER seq — a race that existed even against a hypothetical
//      strongly-consistent read.
// The fix below closes both at once: `assignSequenceAndAppendChangeLog` reads the counter, then
// commits the counter advance AND the new ordered-stream row in ONE DynamoDB transaction
// (`TransactWriteItems`), atomically with the existing idempotency row. DynamoDB transactions are
// serializable, so the counter can only reach N once seq=N's stream row is already fully
// committed — no later reader can ever observe the counter at N without that row already being
// durable. Optimistic-concurrency retry (bounded, no sleep) handles genuine contention.
//
// DUAL-MODE ROLLOUT (post-deployability audit): the `Interval_ChangeStream` table, its IAM
// grants, and this file's own v2 code ALL live in the SAME CDK stack as the Lambda's deployed
// code — there is no supported CDK/CloudFormation mechanism to deploy "just the new table and
// IAM" from this stack while leaving the Lambda's deployed CODE on an older revision, because a
// single `cdk deploy` of one stack synthesizes and updates everything in it together, and this
// repository's checked-in Lambda source IS the thing CDK packages. So "deploy infra without
// activating new behavior" has to be achieved a different way: the NEW code is deployed from the
// start, but defaults to behaving EXACTLY like the pre-this-fix implementation
// (`SYNC_CURSOR_MODE=legacy`, resolved by `resolveSyncCursorMode` below, fail-closed to "legacy"
// for anything other than the exact literal `"v2"`) until a later, separate, explicit deploy
// flips that one environment variable. `SYNC_PUSH_MAINTENANCE` (fail-closed to "false"/normal
// operation for anything other than the exact literal `"true"`) is the write freeze the backfill
// script's own correctness depends on, now enforced IN CODE rather than left as an operational
// promise nothing here could verify. See docs/sync-cursor-semantics.md's "Rollout" section for
// the full command-level sequence.

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

/**
 * Fail-closed resolution of the `SYNC_CURSOR_MODE` rollout flag (see this file's header
 * comment's "Dual-mode rollout" section) — anything other than the exact literal `"v2"`
 * (missing, empty, a typo, a future-and-not-yet-real mode name) resolves to `"legacy"`, the
 * already-proven, pre-this-fix behavior. This is the ONLY string comparison that can ever
 * activate the new transactional/ChangeStream path — there is no implicit/partial activation.
 */
export function resolveSyncCursorMode(raw) {
  return raw === "v2" ? "v2" : "legacy";
}

/**
 * Fail-closed resolution of the `SYNC_PUSH_MAINTENANCE` rollout flag — anything other than the
 * exact literal `"true"` resolves to `false` (normal operation). Deliberately the OPPOSITE
 * fail-closed direction from `resolveSyncCursorMode`: a missing/malformed cursor-mode value
 * must never risk activating unproven new behavior, but a missing/malformed maintenance value
 * must never risk silently freezing all writes for every user — maintenance is an explicit,
 * rare, deliberately-opted-into operational state, not a default-safe posture.
 */
export function resolveMaintenanceMode(raw) {
  return raw === "true";
}

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

// Sentinel row holding one user's monotonic change-sequence counter, in the SAME Changes table
// and SAME partition (PK=U#<sub>) as that user's actual idempotency rows — co-located with the
// data it orders rather than a second table. Never matches a real change row's SK (those are all
// `C#<changeKey>`, and changeKey always starts with an ISO-8601 timestamp digit, never "S"). Its
// own stored value lives under `seqValue`, never `seq` — `seq` is the ChangeStream table's own
// primary sort key attribute, and this row is never written there at all (it has nothing to do
// with that table), so there is no naming collision to begin with; the name is still kept
// distinct defensively, matching the original design's own reasoning. See
// docs/sync-cursor-semantics.md.
export const SEQUENCE_COUNTER_SK = "SEQ#COUNTER";

// Bounded optimistic-concurrency retry count for assignSequenceAndAppendChangeLog's counter-
// contention case below — NOT a sleep/backoff loop (the mission's explicit "no sleeps to
// establish correctness" requirement): each retry is an immediate fresh read + transaction
// attempt. Contention only occurs when two pushes for the SAME user race at the same instant,
// which DynamoDB's own per-call latency already spaces out naturally. Exhausting this bound
// surfaces as a torn-state push rejection (the client retries the whole push later, safely) —
// never a fabricated seq, never a silent skip.
export const MAX_SEQUENCE_ASSIGNMENT_ATTEMPTS = 10;

/**
 * The LEGACY (`SYNC_CURSOR_MODE=legacy`) change-log append — byte-for-byte the same shape and
 * behavior this repository ran before the sync-cursor-hardening fix existed at all: a single
 * conditional `PutItem` into `changesTable`, `SK=C#<changeKey>`, no `seq` attribute, no
 * transaction, no `Interval_ChangeStream` write. Exists so a newly-deployed dual-mode Lambda,
 * while `SYNC_CURSOR_MODE` is still `"legacy"`, is OBSERVABLY IDENTICAL to what is already
 * running — not merely "the new code happens to be inert," but literally the same write.
 *
 * `attribute_not_exists(PK) AND attribute_not_exists(SK)` is the same put-if-absent idiom
 * `assignSequenceAndAppendChangeLog`'s own idempotency action uses — a retried push's duplicate
 * throws `ConditionalCheckFailedException` here too, handled identically by the caller
 * (`processChange`, in `createHandler` below).
 */
export async function appendChangeLogLegacy({ client, PutCommandCtor, changesTable, ownerPk, changeKey, deviceId, c }) {
  await client.send(
    new PutCommandCtor({
      TableName: changesTable,
      Item: {
        PK: ownerPk,
        SK: `C#${changeKey}`,
        changeKey,
        deviceId,
        id: c.id,
        entity: c.entity,
        op: c.op,
        ts: c.ts,
        record: c.record,
      },
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    })
  );
}

/**
 * The exact `TransactWriteItems` input for ONE change — a pure function, directly testable
 * without any DynamoDB client at all (same precedent as sync-pull/lib.mjs's
 * `buildPullQueryParams`). Three actions, committed atomically or not at all:
 *
 *   0. Put the Changes-table idempotency row (`PK=ownerPk, SK=C#<changeKey>`) — UNCHANGED shape/
 *      condition from before this rework, still the sole idempotency gate for a retried push.
 *   1. Update the per-user counter, conditioned on it still holding `currentSeqValue` (or not
 *      existing yet, for the very first assignment ever — see "Counter initialization" in
 *      docs/sync-cursor-semantics.md). This is the optimistic-concurrency check: if another
 *      writer already advanced the counter, THIS condition fails and the whole transaction
 *      cancels, atomically, including action 2 below.
 *   2. Put the new ChangeStream row at `seq=nextSeq` — the row sync-pull's strongly-consistent
 *      query will return. Conditioned defensively on not already existing (should be
 *      unreachable given action 1's own condition, but costs nothing to assert).
 *
 * Because all three are one DynamoDB transaction, there is no state where the counter reflects
 * `nextSeq` without this stream row already being durably committed — closing the write-order
 * race a plain "increment, then separately write" design had (see this file's header comment).
 */
export function buildSequenceTransactItems({
  changesTable,
  changeStreamTable,
  ownerPk,
  changeKey,
  deviceId,
  c,
  currentSeqValue,
  nextSeq,
}) {
  return [
    {
      Put: {
        TableName: changesTable,
        Item: {
          PK: ownerPk,
          SK: `C#${changeKey}`,
          changeKey,
          deviceId,
          id: c.id,
          entity: c.entity,
          op: c.op,
          ts: c.ts,
          record: c.record,
          seq: nextSeq,
        },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      },
    },
    {
      Update: {
        TableName: changesTable,
        Key: { PK: ownerPk, SK: SEQUENCE_COUNTER_SK },
        UpdateExpression: "SET #seqValue = :next",
        ConditionExpression: "attribute_not_exists(#seqValue) OR #seqValue = :current",
        ExpressionAttributeNames: { "#seqValue": "seqValue" },
        ExpressionAttributeValues: { ":next": nextSeq, ":current": currentSeqValue },
      },
    },
    {
      Put: {
        TableName: changeStreamTable,
        Item: {
          PK: ownerPk,
          seq: nextSeq,
          id: c.id,
          entity: c.entity,
          op: c.op,
          ts: c.ts,
          record: c.record,
        },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(seq)",
      },
    },
  ];
}

/**
 * Classifies a `TransactionCanceledException`'s `CancellationReasons` (one entry per item in
 * `buildSequenceTransactItems`'s fixed order) into what actually happened — pure, no I/O, so this
 * decision logic is independently testable from the retry loop that uses it.
 *
 *   - `idempotencyDuplicate: true` — item 0 (the idempotency Put) failed its condition, meaning
 *     this exact change (same deterministic changeKey) was already logged by an earlier,
 *     possibly-torn push attempt. The WHOLE transaction cancelled, so NEITHER the counter NOR the
 *     stream row were touched — a retried push wastes zero sequence numbers (a correctness
 *     improvement over the prior "increment, then separately write" design, where a duplicate's
 *     own increment always succeeded and was simply never used).
 *   - `counterContention: true` — item 1 (the counter Update) failed its condition, meaning a
 *     DIFFERENT writer advanced the counter between this attempt's read and its transaction —
 *     genuine optimistic-concurrency contention, safe to retry with a fresh read.
 *   - Neither flag set — an unexpected cancellation (e.g. item 2's defensive condition somehow
 *     failing); the caller treats this as a real error, never silently retried or ignored.
 */
export function classifySequenceTransactionCancellation(cancellationReasons) {
  const reasons = Array.isArray(cancellationReasons) ? cancellationReasons : [];
  return {
    idempotencyDuplicate: reasons[0]?.Code === "ConditionalCheckFailed",
    counterContention: reasons[1]?.Code === "ConditionalCheckFailed",
  };
}

/**
 * Atomically assigns the next server-ordering sequence number for one user's change stream AND
 * durably commits the ordered-stream row under it — the root fix for the backdated-upload cursor
 * bug, reworked after review to also close the write-order race a plain counter-increment design
 * had (see this file's header comment and docs/sync-cursor-semantics.md's "Root cause").
 *
 * DI'd like every other DynamoDB-touching function in this file — `client`/Command constructors
 * are passed in, never imported, so this is exercised by lib.test.mjs with a small in-memory fake
 * rather than real DynamoDB.
 *
 * Returns `{ seq, duplicate: false }` on a fresh commit, or `{ seq: null, duplicate: true }` for
 * a benign retried-push duplicate (see `classifySequenceTransactionCancellation`). Throws for any
 * other failure, including exhausting `MAX_SEQUENCE_ASSIGNMENT_ATTEMPTS` under contention — the
 * caller (processChange, below) treats either as a torn-state push rejection, never a fabricated
 * or skipped seq.
 *
 * The pre-transaction counter read requests `ConsistentRead: true` purely to reduce wasted retry
 * attempts under write-heavy conditions — it is NOT what makes this correct. Correctness comes
 * entirely from the transaction's own atomic conditional check at commit time (DynamoDB
 * transactions are serializable: the counter can only reach `nextSeq` once this same transaction
 * has also committed the stream row under it), which holds regardless of this read's consistency
 * level. Do not "fix" a future bug here by reasoning about this GetItem's consistency — look at
 * the transaction's conditions instead.
 */
export async function assignSequenceAndAppendChangeLog({
  client,
  GetCommandCtor,
  TransactWriteCommandCtor,
  changesTable,
  changeStreamTable,
  ownerPk,
  changeKey,
  deviceId,
  c,
  maxAttempts = MAX_SEQUENCE_ASSIGNMENT_ATTEMPTS,
}) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const got = await client.send(
      new GetCommandCtor({
        TableName: changesTable,
        Key: { PK: ownerPk, SK: SEQUENCE_COUNTER_SK },
        ConsistentRead: true,
      })
    );
    const currentSeqValue = typeof got.Item?.seqValue === "number" ? got.Item.seqValue : 0;
    const nextSeq = currentSeqValue + 1;

    try {
      await client.send(
        new TransactWriteCommandCtor({
          TransactItems: buildSequenceTransactItems({
            changesTable,
            changeStreamTable,
            ownerPk,
            changeKey,
            deviceId,
            c,
            currentSeqValue,
            nextSeq,
          }),
        })
      );
      return { seq: nextSeq, duplicate: false };
    } catch (e) {
      if (e?.name === "TransactionCanceledException") {
        const { idempotencyDuplicate, counterContention } = classifySequenceTransactionCancellation(
          e.CancellationReasons
        );
        if (idempotencyDuplicate) return { seq: null, duplicate: true };
        if (counterContention) continue; // fresh read, fresh attempt — no sleep.
      }
      throw e;
    }
  }
  const exhausted = new Error(
    `assignSequenceAndAppendChangeLog: exhausted ${maxAttempts} attempts under counter contention`
  );
  exhausted.name = "SequenceAssignmentContentionExhausted";
  throw exhausted;
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

/**
 * Builds the full sync-push Lambda handler — DI'd exactly like `assignSequenceAndAppendChangeLog`
 * above (client/Command constructors passed in, never imported here), so this entire request/
 * response flow, including the transactional seq-assignment step, can be exercised end to end by
 * cursorHardening.test.mjs with a small in-memory fake, with "@aws-sdk/client-dynamodb"/
 * "@aws-sdk/lib-dynamodb" never needing to be resolvable at test time — only index.mjs (the one
 * place that constructs the REAL client) imports them. See that file's own header comment.
 */
export function createHandler({
  client,
  PutCommandCtor,
  GetCommandCtor,
  TransactWriteCommandCtor,
  UpdateCommandCtor,
  recordsTable,
  changesTable,
  changeStreamTable,
  cursorMode,
  maintenanceMode,
}) {
  const resolvedCursorMode = resolveSyncCursorMode(cursorMode);
  const resolvedMaintenance = resolveMaintenanceMode(maintenanceMode);
  // Upsert the per-record snapshot into Records — conditional on the incoming revision not being
  // older than whatever is already stored (server-side half of the conflict model, see
  // docs/sync-invariants.md invariant #5). A ConditionalCheckFailedException here means "a newer
  // revision is already stored"; the caller turns that into a rejected record.
  async function updateRecordSnapshot(ownerPk, c, deviceId, changeKey) {
    await client.send(
      new UpdateCommandCtor({
        TableName: recordsTable,
        Key: { PK: ownerPk, SK: `E#${c.entity}#${c.id}` },
        UpdateExpression: `
          SET #entity = :entity,
              #id = :id,
              #op = :op,
              #updatedAt = :ts,
              #record = :record,
              #lastDeviceId = :deviceId,
              #lastChangeKey = :changeKey
        `,
        ConditionExpression:
          "attribute_not_exists(PK) OR attribute_not_exists(#record) OR :incomingRev >= #record.#rev",
        ExpressionAttributeNames: {
          "#entity": "entity",
          "#id": "id",
          "#op": "op",
          "#updatedAt": "updatedAt",
          "#record": "record",
          "#lastDeviceId": "lastDeviceId",
          "#lastChangeKey": "lastChangeKey",
          "#rev": "rev",
        },
        ExpressionAttributeValues: {
          ":entity": c.entity,
          ":id": c.id,
          ":op": c.op,
          ":ts": c.ts,
          ":record": c.record,
          ":deviceId": deviceId,
          ":changeKey": changeKey,
          ":incomingRev": c.incomingRev,
        },
      })
    );
  }

  // Process ONE change: update the Records snapshot first (conditional), then — only if that
  // succeeded — append the change log via whichever path `resolvedCursorMode` selects:
  // `"v2"` atomically assigns a server-ordering sequence number and commits the ordered-stream
  // row (assignSequenceAndAppendChangeLog); `"legacy"` (the default) appends the plain,
  // pre-this-fix change-log row (appendChangeLogLegacy) — see this file's header comment's
  // "Dual-mode rollout" section for why both paths exist in the same deployed code. A record is
  // acknowledged only when BOTH the snapshot is current AND the log write is present (fresh or a
  // benign idempotent duplicate, in either mode). A real write failure after a successful
  // snapshot update is a torn state → NOT acknowledged, so the client keeps the record dirty and
  // retries (every write here is idempotent, or — for the seq counter — safely retriable from a
  // fresh read, on retry). Never throws — every failure is returned as a rejected result.
  async function processChange(ownerPk, change, deviceId) {
    const classified = classifyChange(change);
    if (!classified.ok) {
      return { entity: classified.entity, id: classified.id, status: "rejected", reason: classified.reason };
    }
    const changeKey = makeChangeKey(classified, deviceId);

    let recordUpdated = false;
    let recordError;
    try {
      await updateRecordSnapshot(ownerPk, classified, deviceId, changeKey);
      recordUpdated = true;
    } catch (e) {
      recordError = e?.name || "UpdateItem_failed";
    }

    let changelogWritten = false;
    let changelogDuplicate = false;
    let changelogError;
    if (recordUpdated) {
      try {
        if (resolvedCursorMode === "v2") {
          const result = await assignSequenceAndAppendChangeLog({
            client,
            GetCommandCtor,
            TransactWriteCommandCtor,
            changesTable,
            changeStreamTable,
            ownerPk,
            changeKey,
            deviceId,
            c: classified,
          });
          if (result.duplicate) {
            changelogDuplicate = true;
          } else {
            changelogWritten = true;
          }
        } else {
          await appendChangeLogLegacy({ client, PutCommandCtor, changesTable, ownerPk, changeKey, deviceId, c: classified });
          changelogWritten = true;
        }
      } catch (e) {
        if (e?.name === "ConditionalCheckFailedException") {
          // Only reachable from the LEGACY path — assignSequenceAndAppendChangeLog already
          // resolves its own idempotency-row duplicate internally and never throws this.
          changelogDuplicate = true;
        } else {
          changelogError = e?.name || "changelog_write_failed";
        }
      }
    }

    const outcome = decidePushOutcome({
      recordUpdated,
      recordError,
      changelogWritten,
      changelogDuplicate,
      changelogError,
    });
    return { entity: classified.entity, id: classified.id, ...outcome };
  }

  return async (event) => {
    const startedAt = Date.now();
    try {
      if (!recordsTable || !changesTable || !changeStreamTable) {
        return resp(500, {
          ok: false,
          error: "Missing env vars: RECORDS_TABLE / CHANGES_TABLE / CHANGE_STREAM_TABLE",
        });
      }

      // ✅ Require auth (API Gateway should already enforce, but double-lock)
      const sub = getUserSub(event);
      if (!sub) return resp(401, { message: "Unauthorized" });

      const OWNER_PK = `U#${sub}`;
      console.log(`[auth] sub: ${sub.slice(0, 8)}… cursorMode=${resolvedCursorMode} maintenance=${resolvedMaintenance}`);

      // Write freeze (docs/sync-cursor-semantics.md's "Rollout" section) — checked immediately
      // after auth, before any body parsing or DynamoDB access: the backfill's own correctness
      // depends on NO new rows landing in Changes while it scans, so this must be an actual,
      // enforced rejection, not an operational promise nothing here could verify. 503 (not a
      // generic 500/400) with an explicit, retryable error — the client's existing generic
      // sync-failure handling already retries any non-200 response on its next sync attempt, so
      // no mobile code change is needed; nothing is ever marked clean, nothing is discarded.
      if (resolvedMaintenance) {
        console.log("[sync-push] rejecting push: maintenance mode active");
        return resp(503, { ok: false, error: "maintenance", retryable: true });
      }

      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return resp(400, { ok: false, error: "Invalid JSON" });
      }

      // Deterministic 4xx for a malformed shape (400) or an over-cap change count (413) — an
      // oversized request must never masquerade as a server fault by pushing the Lambda to its
      // timeout. Nothing is dropped: the client keeps every record and retries.
      const validation = validatePushRequest(body);
      if (!validation.ok) {
        console.log(
          `[sync-push] request rejected status=${validation.status} error=${validation.error}` +
            (validation.received !== undefined
              ? ` received=${validation.received} limit=${validation.limit}`
              : "")
        );
        return resp(validation.status, {
          ok: false,
          error: validation.error,
          ...(validation.limit !== undefined
            ? { limit: validation.limit, received: validation.received }
            : {}),
        });
      }
      const { deviceId, changes } = validation;

      console.log(`[sync-push] start changes=${changes.length} concurrency=${PUSH_CONCURRENCY}`);

      // accepted/rejected are [{entity,id}] (rejected also carries a non-content `reason`) — an id
      // alone is not unique across entity types, so the client must never key acknowledgement on
      // id alone (audit finding 2).
      const accepted = [];
      const rejected = [];

      // Records within one request are independent (distinct Records/Changes sort keys, and the
      // client never emits two changes for the same id in one push), so each concurrency-batch is
      // processed concurrently; batches run in sequence. Bounded concurrency (not one giant
      // Promise.all) keeps in-flight DynamoDB connections well under the SDK's socket pool.
      for (const batch of chunk(changes, PUSH_CONCURRENCY)) {
        const settled = await Promise.allSettled(
          batch.map((ch) => processChange(OWNER_PK, ch, deviceId))
        );
        for (let i = 0; i < settled.length; i++) {
          const s = settled[i];
          const result =
            s.status === "fulfilled"
              ? s.value
              : {
                  entity: batch[i]?.entity ?? "unknown",
                  id: batch[i]?.id ?? "unknown",
                  status: "rejected",
                  reason: "processing_error",
                };

          if (result.status === "accepted") {
            accepted.push({ entity: result.entity, id: result.id });
          } else {
            rejected.push({ entity: result.entity, id: result.id, reason: result.reason });
            // Safe metadata only — entity + reason class, never record content.
            console.log(`[sync-push] record rejected: entity=${result.entity} reason=${result.reason}`);
          }
        }
      }

      console.log(
        `[sync-push] complete accepted=${accepted.length} rejected=${rejected.length} elapsedMs=${
          Date.now() - startedAt
        }`
      );
      return resp(200, { accepted, rejected });
    } catch (e) {
      console.log(
        `[sync-push] unhandled error: ${e?.name || "UnknownError"} elapsedMs=${Date.now() - startedAt}`
      );
      return resp(500, { ok: false, error: "Unhandled server error" });
    }
  };
}
