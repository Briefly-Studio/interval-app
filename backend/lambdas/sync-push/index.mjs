import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import { createHandler } from "./lib.mjs";

// This file's only job is constructing the REAL AWS SDK client/commands and wiring them into
// createHandler (lib.mjs) — all request/response/DynamoDB-interaction logic lives there, DI'd,
// so it can be exercised by lib.test.mjs/cursorHardening.test.mjs with a small in-memory fake and
// zero dependency on "@aws-sdk/client-dynamodb"/"@aws-sdk/lib-dynamodb" being resolvable at test
// time (this Lambda ships with no node_modules at all — the Node.js Lambda runtime provides these
// built in; see infra/lib/interval-sync-stack.ts's syncAssetExclude comment). Importing THIS file
// still requires them, exactly as before — only `index.handler` (the deployed entry point) ever
// does. `PutCommand` is back (the dual-mode rework's LEGACY path, `appendChangeLogLegacy`, uses
// it); `GetCommand`/`TransactWriteCommand` remain for the v2 path's
// `assignSequenceAndAppendChangeLog`. `SYNC_CURSOR_MODE`/`SYNC_PUSH_MAINTENANCE` are read here
// (never inside lib.mjs itself) and passed through as plain strings — `createHandler` is the
// only place that resolves/fails-closed on their actual value.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = createHandler({
  client: ddb,
  PutCommandCtor: PutCommand,
  GetCommandCtor: GetCommand,
  TransactWriteCommandCtor: TransactWriteCommand,
  UpdateCommandCtor: UpdateCommand,
  recordsTable: process.env.RECORDS_TABLE,
  changesTable: process.env.CHANGES_TABLE,
  changeStreamTable: process.env.CHANGE_STREAM_TABLE,
  cursorMode: process.env.SYNC_CURSOR_MODE,
  maintenanceMode: process.env.SYNC_PUSH_MAINTENANCE,
});
