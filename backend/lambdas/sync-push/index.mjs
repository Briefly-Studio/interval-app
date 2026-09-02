import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import {
  PUSH_CONCURRENCY,
  chunk,
  classifyChange,
  decidePushOutcome,
  getUserSub,
  makeChangeKey,
  resp,
  validatePushRequest,
} from "./lib.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const RECORDS_TABLE = process.env.RECORDS_TABLE;
const CHANGES_TABLE = process.env.CHANGES_TABLE;

// Upsert the per-record snapshot into Records — conditional on the incoming revision not being
// older than whatever is already stored (server-side half of the conflict model, see
// docs/sync-invariants.md invariant #5). A ConditionalCheckFailedException here means "a newer
// revision is already stored"; the caller turns that into a rejected record.
async function updateRecordSnapshot(ownerPk, c, deviceId, changeKey) {
  await ddb.send(
    new UpdateCommand({
      TableName: RECORDS_TABLE,
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

// Append the change to the Changes log — deterministic changeKey, conditional on the row not
// already existing so a retried push is idempotent.
//
// `attribute_not_exists(PK) AND attribute_not_exists(SK)` on a PutItem is the canonical
// put-if-absent idiom: because (PK, SK) is the full primary key, this condition can fail for
// EXACTLY ONE reason — an item with this exact `PK=U#<sub>`, `SK=C#<changeKey>` already exists.
// `changeKey` is deterministic (`ts|deviceId|entity|id|op`), so that existing row IS this same
// change, already logged by an earlier (possibly torn) push. Treating the exception as a benign
// duplicate is therefore safe with no readback (audit "server retry / duplicate change row").
async function appendChangeLog(ownerPk, c, deviceId, changeKey) {
  await ddb.send(
    new PutCommand({
      TableName: CHANGES_TABLE,
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

// Process ONE change: update the Records snapshot first (conditional), then — only if that
// succeeded — append the Changes-log row. A record is acknowledged only when BOTH the snapshot
// is current AND the log row is present (fresh or a benign idempotent duplicate). A real
// change-log write failure after a successful snapshot update is a torn state → NOT acknowledged,
// so the client keeps the record dirty and retries (both writes are idempotent on retry). Never
// throws — every failure is returned as a rejected result.
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
      await appendChangeLog(ownerPk, classified, deviceId, changeKey);
      changelogWritten = true;
    } catch (e) {
      if (e?.name === "ConditionalCheckFailedException") {
        changelogDuplicate = true;
      } else {
        changelogError = e?.name || "PutItem_failed";
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

export const handler = async (event) => {
  const startedAt = Date.now();
  try {
    if (!RECORDS_TABLE || !CHANGES_TABLE) {
      return resp(500, {
        ok: false,
        error: "Missing env vars: RECORDS_TABLE / CHANGES_TABLE",
      });
    }

    // ✅ Require auth (API Gateway should already enforce, but double-lock)
    const sub = getUserSub(event);
    if (!sub) return resp(401, { message: "Unauthorized" });

    const OWNER_PK = `U#${sub}`;
    console.log("[auth] sub:", sub.slice(0, 8) + "…");

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
    // client never emits two changes for the same id per push), so each concurrency-batch is
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
