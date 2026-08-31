import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { getUserSub, jsonResponse, nextCursorForPage, resolvePullLimit } from "./lib.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CHANGES_TABLE = process.env.CHANGES_TABLE;

export const handler = async (event) => {
  const startedAt = Date.now();

  if (!CHANGES_TABLE) {
    return jsonResponse(500, { ok: false, error: "Missing env var: CHANGES_TABLE" });
  }

  const sub = getUserSub(event);
  if (!sub) return jsonResponse(401, { message: "Unauthorized" });

  const OWNER_PK = `U#${sub}`;
  console.log("[auth] sub:", sub.slice(0, 8) + "…");

  const qs = event.queryStringParameters || {};
  const cursor = qs.cursor || null;
  const limit = resolvePullLimit(qs.limit);
  console.log(`[sync-pull] start cursor=${cursor ? "present" : "none"} limit=${limit}`);

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

    // Advance the cursor from the last KEYABLE row's SK (`C#<changeKey>`), which the DynamoDB key
    // schema guarantees is present — so a row that is only missing the `changeKey` ATTRIBUTE no
    // longer wedges the pull on the same page forever (audit finding 3). See
    // lib.mjs's nextCursorForPage for the forward-progress reasoning.
    const next = nextCursorForPage(items, cursor);
    if (items.length > 0 && !next.advanced) {
      console.log("[sync-pull] warning: no keyable row in page — cursor not advanced");
    } else if (next.unkeyedTrailingRows) {
      console.log(`[sync-pull] note: ${next.unkeyedTrailingRows} trailing row(s) had no usable key`);
    }

    console.log(
      `[sync-pull] complete returned=${changes.length} hasMore=${
        items.length === limit
      } advanced=${next.advanced} elapsedMs=${Date.now() - startedAt}`
    );

    return jsonResponse(200, { cursor: next.cursor, changes });
  } catch (e) {
    console.log(
      `[sync-pull] unhandled error: ${e?.name || "UnknownError"} elapsedMs=${Date.now() - startedAt}`
    );
    return jsonResponse(500, { ok: false, error: "Unhandled server error" });
  }
};
