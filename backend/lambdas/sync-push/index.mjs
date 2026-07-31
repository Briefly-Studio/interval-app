import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const RECORDS_TABLE = process.env.RECORDS_TABLE;
const CHANGES_TABLE = process.env.CHANGES_TABLE;

function resp(statusCode, obj) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj),
  };
}

// Supports HTTP API (v2) JWT authorizer AND REST API style authorizer
function getUserSub(event) {
  const subV2 = event?.requestContext?.authorizer?.jwt?.claims?.sub;
  if (typeof subV2 === "string" && subV2.length) return subV2;

  const subV1 = event?.requestContext?.authorizer?.claims?.sub;
  if (typeof subV1 === "string" && subV1.length) return subV1;

  const subLoose = event?.requestContext?.authorizer?.sub;
  if (typeof subLoose === "string" && subLoose.length) return subLoose;

  return null;
}

function makeChangeKey(change, deviceId) {
  return `${change.ts}|${deviceId}|${change.entity}|${change.id}|${change.op}`;
}

export const handler = async (event) => {
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

    const deviceId = body.deviceId;
    const changes = body.changes;

    if (!deviceId || !Array.isArray(changes)) {
      return resp(400, { ok: false, error: "Invalid payload" });
    }

    const accepted = [];
    const rejected = [];
    const reasons = {};

    for (const change of changes) {
      const id = change?.id;
      const entity = change?.entity;
      const op = change?.op;
      const ts = change?.ts;
      const record = change?.record ?? null;

      if (!id || !entity || !op || !ts) {
        rejected.push(id ?? "unknown");
        reasons[id ?? "unknown"] = "invalid_change_shape";
        continue;
      }

      const changeKey = makeChangeKey(change, deviceId);

      // 1) Append to Changes (retry-safe)
      try {
        await ddb.send(
          new PutCommand({
            TableName: CHANGES_TABLE,
            Item: {
              PK: OWNER_PK,
              SK: `C#${changeKey}`,
              changeKey,
              deviceId,
              id,
              entity,
              op,
              ts,
              record,
            },
            ConditionExpression:
              "attribute_not_exists(PK) AND attribute_not_exists(SK)",
          })
        );
      } catch {
        // duplicates are fine
      }

      // 2) Upsert snapshot into Records — conditional on the incoming revision not being older
      // than whatever is already stored. This is the server-side half of the sync system's
      // conflict model (see docs/sync-invariants.md, invariant #5): without it, a stale device
      // pushing an old revision could silently overwrite a newer one another device already
      // committed. `record.rev` is a client-maintained integer that increments on every local
      // edit/delete/restore; a missing/non-numeric rev is treated as 0 (oldest possible), never
      // as "no rev" (which would bypass the check). Accepting incomingRev === storedRev keeps a
      // retried identical push idempotent rather than spuriously rejecting it.
      const incomingRev = typeof record?.rev === "number" && Number.isFinite(record.rev) ? record.rev : 0;

      try {
        await ddb.send(
          new UpdateCommand({
            TableName: RECORDS_TABLE,
            Key: { PK: OWNER_PK, SK: `E#${entity}#${id}` },
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
              ":entity": entity,
              ":id": id,
              ":op": op,
              ":ts": ts,
              ":record": record,
              ":deviceId": deviceId,
              ":changeKey": changeKey,
              ":incomingRev": incomingRev,
            },
          })
        );

        accepted.push(id);
      } catch (e) {
        // A ConditionalCheckFailedException here specifically means "a newer revision is already
        // stored" — the client's existing rejected-record handling (stays dirty, retried after
        // the client has pulled and caught up) already covers this correctly; no special-casing
        // needed beyond letting it fall into the same rejection path as any other write failure.
        const code = e?.name || "UpdateItem_failed";
        rejected.push(id);
        reasons[id] = code;
        console.log("[sync-push] record update rejected:", code);
      }
    }

    return resp(200, { accepted, rejected, reasons });
  } catch (e) {
    console.log("[sync-push] unhandled error:", e?.name || "UnknownError");
    return resp(500, { ok: false, error: "Unhandled server error" });
  }
};
