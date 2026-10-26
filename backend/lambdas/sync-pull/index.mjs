import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { createHandler } from "./lib.mjs";

// This file's only job is constructing the REAL AWS SDK client/command and wiring it into
// createHandler (lib.mjs) — all request/response/DynamoDB-interaction logic lives there, DI'd,
// so it can be exercised by lib.test.mjs with a small in-memory fake and zero dependency on
// "@aws-sdk/client-dynamodb"/"@aws-sdk/lib-dynamodb" being resolvable at test time (this Lambda
// ships with no node_modules at all — the Node.js Lambda runtime provides these built in; see
// infra/lib/interval-sync-stack.ts's syncAssetExclude comment). Importing THIS file still
// requires them, exactly as before — only `index.handler` (the deployed entry point) ever does.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = createHandler({
  client: ddb,
  QueryCommandCtor: QueryCommand,
  // Dual-mode rollout (see lib.mjs's header comment): CHANGES_TABLE is restored for the LEGACY
  // read path; CHANGE_STREAM_TABLE remains the v2 read path's table. SYNC_CURSOR_MODE selects
  // between them at runtime — read here, resolved/fail-closed only inside createHandler.
  changesTable: process.env.CHANGES_TABLE,
  changeStreamTable: process.env.CHANGE_STREAM_TABLE,
  cursorMode: process.env.SYNC_CURSOR_MODE,
});
