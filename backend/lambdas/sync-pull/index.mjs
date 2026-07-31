import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CHANGES_TABLE = process.env.CHANGES_TABLE;

function getUserSub(event) {
  const subV2 = event?.requestContext?.authorizer?.jwt?.claims?.sub;
  if (typeof subV2 === "string" && subV2.length) return subV2;

  const subV1 = event?.requestContext?.authorizer?.claims?.sub;
  if (typeof subV1 === "string" && subV1.length) return subV1;

  const subLoose = event?.requestContext?.authorizer?.sub;
  if (typeof subLoose === "string" && subLoose.length) return subLoose;

  return null;
}

export const handler = async (event) => {
  if (!CHANGES_TABLE) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Missing env var: CHANGES_TABLE" }),
    };
  }

  const sub = getUserSub(event);
  if (!sub) {
    return {
      statusCode: 401,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Unauthorized" }),
    };
  }

  const OWNER_PK = `U#${sub}`;
  console.log("[auth] sub:", sub.slice(0, 8) + "…");

  const qs = event.queryStringParameters || {};
  const deviceId = qs.deviceId || null;
  const cursor = qs.cursor || null;
  const limit = Math.min(Number(qs.limit || 200), 500);

  const params = {
    TableName: CHANGES_TABLE,
    KeyConditionExpression: "PK = :pk" + (cursor ? " AND SK > :cursor" : ""),
    ExpressionAttributeValues: cursor
      ? { ":pk": OWNER_PK, ":cursor": `C#${cursor}` }
      : { ":pk": OWNER_PK },
    Limit: limit,
    ScanIndexForward: true,
  };

  // Wrapped defensively (matching sync-push) so a transient DynamoDB failure returns a sanitized
  // 500 rather than an unhandled Lambda error response that could leak internals through API
  // Gateway's default error formatting.
  try {
    const out = await ddb.send(new QueryCommand(params));
    const items = out.Items || [];

    const changes = items.map((it) => ({
      id: it.id,
      entity: it.entity,
      op: it.op,
      record: it.record,
      ts: it.ts,
    }));

    const nextCursor = items.length
      ? items[items.length - 1].changeKey
      : cursor ?? "";

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cursor: nextCursor,
        changes,
      }),
    };
  } catch (e) {
    console.log("[sync-pull] unhandled error:", e?.name || "UnknownError");
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Unhandled server error" }),
    };
  }
};
