#!/usr/bin/env node
// One-time migration tool for the sync-cursor-hardening fix (docs/sync-cursor-semantics.md).
//
// REWORKED after a pre-founder-QA review found the original GSI-based design unsound (GSIs are
// always eventually consistent, with no documented guarantee that two different items' index
// propagation preserves their relative base-table write order) and found this script's own
// implied deployment order — deploy infra, backfill, THEN deploy new Lambda code — had an
// unaudited race: if sync-push is still live and accepting writes while this script scans, a
// straggler row written mid-scan is never seen by it, and nothing will ever revisit that row once
// the new Lambda takes over the counter from a higher starting point. That row would then be
// PERMANENTLY stranded outside the ordered stream, forever — exactly the failure this whole fix
// exists to prevent, just reintroduced by the migration tool itself.
//
// WHAT THIS DOES
// ---------------
// `Interval_ChangeStream` is a NEW, dedicated table (PK=U#<sub>, SK=seq Number) — never a GSI —
// so sync-pull can query it with `ConsistentRead: true` (impossible for a GSI; see
// infra/lib/interval-sync-stack.ts's ChangeStreamTable construct comment). Every row already in
// `Interval_Changes` before this fix is deployed has no corresponding row in that new table at
// all. This script finds every such historical row, groups them by owning user (PK), and — in the
// best available historical order (ascending by the existing `changeKey`, which sorts by the
// change's own `ts` first — the same ordering the OLD, now-fixed cursor already relied on, so
// this backfill does not change what order anyone already experienced, it just makes that order
// durable/correct going forward) — atomically (one DynamoDB transaction per row, mirroring
// sync-push/lib.mjs's own `assignSequenceAndAppendChangeLog` shape) marks the historical row with
// its assigned `seq`, advances that user's sequence-counter sentinel row, and writes the
// corresponding `Interval_ChangeStream` row. Every write is conditional, so re-running this script
// (dry-run or `--execute`) is always safe, including after a partial/interrupted prior run.
//
// REQUIRED DEPLOYMENT ORDER — a write freeze, not just an ordering, is required
// --------------------------------------------------------------------------------
// See docs/sync-cursor-semantics.md's "Rollout" section for the full sequence. In short:
//   1. Freeze sync-push acceptance (maintenance mode / temporarily disabled route / equivalent —
//      this script does not do this for you).
//   2. Deploy infra ONLY (creates Interval_ChangeStream + IAM — does not change sync-push/
//      sync-pull Lambda behavior yet).
//   3. Run THIS script in `--execute` mode.
//   4. Run it AGAIN (or rely on its own built-in convergence loop, below) until a pass finds
//      zero unmigrated rows — this is the convergence VERIFICATION, not a substitute for step 1.
//      A write freeze is the only mechanism that actually GUARANTEES no straggler can be missed;
//      the convergence loop is defense-in-depth against "the freeze wasn't perfectly respected,"
//      not a correctness proof on its own. Under genuinely continuous concurrent writes, this
//      loop can fail to converge — see "--max-passes" below, which fails LOUDLY rather than
//      reporting false success in that case.
//   5. Verify stream/counter integrity (this script's own `--verify`-equivalent output, printed
//      automatically after a converged `--execute` run).
//   6. ONLY THEN deploy the updated sync-push/sync-pull Lambda code.
//   7. Unfreeze sync-push.
//   8. Verify ordinary incremental sync.
// Deploying step 6 before this script converges would let brand-new pushes claim low seq values
// that collide/overlap with whatever this script assigns historical rows afterward, inverting
// delivery order for any device that synced in between.
//
// NOT RUN BY THIS BATCH. This repository's own instructions explicitly prohibit deploying or
// mutating AWS from this branch — this file is provided, reviewed, and ready, but no execution of
// it (dry-run or real) against any live AWS account has occurred as part of this work.
//
// USAGE
// -----
//   node backend/scripts/backfill-change-sequence.mjs \
//     --table interval-dev-changes --stream-table interval-dev-change-stream --region us-east-2
//       Dry run (the default) — reports exactly what WOULD change, writes nothing.
//
//   ... --execute
//       Performs the real writes described above, then runs the convergence-verification loop
//       automatically (bounded by --max-passes, default 5) and exits non-zero if it does not
//       converge to zero unmigrated rows — never reports success in that case.
//
//   ... --max-passes 10
//       Override the convergence-loop bound (see above).
//
// Requires "@aws-sdk/client-dynamodb" and "@aws-sdk/lib-dynamodb" to be resolvable (AWS
// CloudShell has these preinstalled; running locally instead requires
// `npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb` first, deliberately NOT added to
// this repository's own package.json/devDependencies for this one operational script). Reads
// whatever AWS credentials/region are already configured in the environment it runs in — ALWAYS
// pass --table/--stream-table/--region explicitly and confirm them before using --execute.
//
// Never logs a change row's own `record` payload (card/deck/review content) — only counts, PKs
// (truncated), and seq values.
//
// TESTABILITY: the pure grouping/sorting logic and the DI'd per-pass/convergence-loop driver
// below are exported and exercised directly by backfill-change-sequence.test.mjs with a small
// in-memory fake client — the exact same convention backend/lambdas/**/lib.mjs already use. Only
// `main()` at the bottom touches real argv/process.exitCode/the real AWS SDK, and only runs when
// this file is executed directly (not when imported for its exports).

export const SEQUENCE_COUNTER_SK = "SEQ#COUNTER";
export const DEFAULT_MAX_PASSES = 5;

export function truncatedSub(pk) {
  // PK is always "U#<sub>" — log only enough to distinguish users in output, never the full sub.
  return `${pk.slice(0, 10)}…`;
}

/** A real historical change-log row that has not yet been assigned a `seq` (see header comment). */
export function isUnmigratedChangeRow(row) {
  return typeof row?.SK === "string" && row.SK.startsWith("C#") && typeof row.seq !== "number";
}

/**
 * Groups unmigrated rows by owning user and sorts each user's rows into the best available
 * historical order — pure, independently testable without any DynamoDB client at all.
 */
export function groupAndSortUnmigratedRows(rows) {
  const byUser = new Map();
  for (const row of rows.filter(isUnmigratedChangeRow)) {
    const list = byUser.get(row.PK) ?? [];
    list.push(row);
    byUser.set(row.PK, list);
  }
  for (const list of byUser.values()) {
    list.sort((a, b) => (a.changeKey < b.changeKey ? -1 : a.changeKey > b.changeKey ? 1 : 0));
  }
  return byUser;
}

/**
 * The exact `TransactWriteItems` input for backfilling ONE historical row — deliberately a
 * SEPARATE shape from sync-push/lib.mjs's `buildSequenceTransactItems` (item 0 here is an
 * `Update` of an EXISTING row, never a fresh `Put` of a new one) rather than importing/reusing
 * that function. This is intentional, not duplication-for-its-own-sake: a one-time, founder-run
 * migration tool's correctness must not silently depend on the live Lambda's internal shape
 * evolving later out from under it — the same independence spirit as this codebase's existing
 * "no shared module between Lambdas" convention, applied here to a tool that is not a Lambda at
 * all and is never deployed alongside one.
 */
export function buildBackfillTransactItems({ table, streamTable, row, currentSeqValue, nextSeq }) {
  return [
    {
      Update: {
        TableName: table,
        Key: { PK: row.PK, SK: row.SK },
        UpdateExpression: "SET #seq = :seq",
        ConditionExpression: "attribute_not_exists(#seq)",
        ExpressionAttributeNames: { "#seq": "seq" },
        ExpressionAttributeValues: { ":seq": nextSeq },
      },
    },
    {
      Update: {
        TableName: table,
        Key: { PK: row.PK, SK: SEQUENCE_COUNTER_SK },
        UpdateExpression: "SET #seqValue = :next",
        ConditionExpression: "attribute_not_exists(#seqValue) OR #seqValue = :current",
        ExpressionAttributeNames: { "#seqValue": "seqValue" },
        ExpressionAttributeValues: { ":next": nextSeq, ":current": currentSeqValue },
      },
    },
    {
      Put: {
        TableName: streamTable,
        Item: {
          PK: row.PK,
          seq: nextSeq,
          id: row.id,
          entity: row.entity,
          op: row.op,
          ts: row.ts,
          record: row.record,
        },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(seq)",
      },
    },
  ];
}

async function scanAllRows(client, ScanCommandCtor, tableName) {
  const rows = [];
  let ExclusiveStartKey;
  do {
    const out = await client.send(new ScanCommandCtor({ TableName: tableName, ExclusiveStartKey }));
    rows.push(...(out.Items ?? []));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return rows;
}

async function readCounterValue(client, GetCommandCtor, table, pk) {
  const out = await client.send(
    new GetCommandCtor({
      TableName: table,
      Key: { PK: pk, SK: SEQUENCE_COUNTER_SK },
      ConsistentRead: true,
    })
  );
  return typeof out.Item?.seqValue === "number" ? out.Item.seqValue : 0;
}

/**
 * Runs ONE scan + backfill pass: finds every currently-unmigrated row, assigns each one a `seq`
 * (atomically, per row, via `buildBackfillTransactItems`), and returns how many rows were found/
 * assigned. DI'd (client + Command constructors passed in) exactly like the Lambda lib.mjs files,
 * so this is exercised directly by backfill-change-sequence.test.mjs with a small in-memory fake.
 *
 * Dry run (`execute: false`) performs the scan and reports counts without writing anything.
 */
export async function runBackfillPass({
  client,
  ScanCommandCtor,
  GetCommandCtor,
  TransactWriteCommandCtor,
  table,
  streamTable,
  execute,
  log = console.log,
}) {
  const allRows = await scanAllRows(client, ScanCommandCtor, table);
  const byUser = groupAndSortUnmigratedRows(allRows);
  const totalUnmigrated = [...byUser.values()].reduce((sum, rows) => sum + rows.length, 0);

  if (totalUnmigrated === 0) {
    return { totalUnmigrated: 0, totalAssigned: 0, userCount: 0 };
  }
  log(`[backfill] pass found ${totalUnmigrated} unmigrated row(s) across ${byUser.size} user(s)`);

  let totalAssigned = 0;
  for (const [pk, rows] of byUser) {
    if (!execute) {
      log(`[backfill] (dry run) user=${truncatedSub(pk)} would assign seq to ${rows.length} row(s)`);
      totalAssigned += rows.length;
      continue;
    }

    let currentSeqValue = await readCounterValue(client, GetCommandCtor, table, pk);
    for (const row of rows) {
      const nextSeq = currentSeqValue + 1;
      try {
        await client.send(
          new TransactWriteCommandCtor({
            TransactItems: buildBackfillTransactItems({ table, streamTable, row, currentSeqValue, nextSeq }),
          })
        );
        currentSeqValue = nextSeq;
        totalAssigned += 1;
      } catch (e) {
        if (e?.name === "TransactionCanceledException") {
          // Benign only if item 0's own condition is what failed — some other process (a
          // concurrent re-run of this same script, or a straggler live push that slipped through
          // despite the required freeze) already migrated this exact row. Re-read the counter
          // fresh and continue with the NEXT row rather than trusting local bookkeeping, since
          // that process may also have advanced the counter past what this loop assumed.
          log(`[backfill] user=${truncatedSub(pk)} row already migrated concurrently — re-reading counter, continuing`);
          currentSeqValue = await readCounterValue(client, GetCommandCtor, table, pk);
          continue;
        }
        throw e;
      }
    }
  }

  return { totalUnmigrated, totalAssigned, userCount: byUser.size };
}

/**
 * Compares `Interval_Changes`' real change-row count against `Interval_ChangeStream`'s row count,
 * per user — the "verify stream/counter integrity" step the rollout plan requires after
 * convergence, before the new Lambda code is ever deployed. A mismatch means something is wrong
 * (a row migrated without its stream counterpart landing, or vice versa) and must never be
 * silently reported as success.
 */
export function computeIntegrityMismatches({ changeRows, streamRows }) {
  const changeCountByUser = new Map();
  for (const row of changeRows) {
    if (typeof row?.SK !== "string" || !row.SK.startsWith("C#")) continue; // skip the counter row
    changeCountByUser.set(row.PK, (changeCountByUser.get(row.PK) ?? 0) + 1);
  }
  const streamCountByUser = new Map();
  for (const row of streamRows) {
    streamCountByUser.set(row.PK, (streamCountByUser.get(row.PK) ?? 0) + 1);
  }
  const allUsers = new Set([...changeCountByUser.keys(), ...streamCountByUser.keys()]);
  const mismatches = [];
  for (const pk of allUsers) {
    const changeCount = changeCountByUser.get(pk) ?? 0;
    const streamCount = streamCountByUser.get(pk) ?? 0;
    if (changeCount !== streamCount) mismatches.push({ pk, changeCount, streamCount });
  }
  return mismatches;
}

/**
 * The full convergence-verification loop: run a pass; if it found and (in execute mode)
 * assigned every unmigrated row it saw AND a FOLLOW-UP scan finds zero remaining, we're done. If
 * stragglers keep appearing (a live writer slipped past the required freeze), repeat up to
 * `maxPasses` times. Exits this function with `converged: false` rather than ever claiming
 * success on a non-convergent run — the caller (`main`) turns that into a non-zero process exit.
 */
export async function runConvergenceLoop({
  client,
  ScanCommandCtor,
  GetCommandCtor,
  TransactWriteCommandCtor,
  table,
  streamTable,
  execute,
  maxPasses = DEFAULT_MAX_PASSES,
  log = console.log,
}) {
  let totalAssigned = 0;
  for (let pass = 1; pass <= maxPasses; pass++) {
    log(`[backfill] convergence pass ${pass}/${maxPasses}`);
    const result = await runBackfillPass({
      client,
      ScanCommandCtor,
      GetCommandCtor,
      TransactWriteCommandCtor,
      table,
      streamTable,
      execute,
      log,
    });
    totalAssigned += result.totalAssigned;
    if (result.totalUnmigrated === 0) {
      return { converged: true, passesRun: pass, totalAssigned };
    }
    if (!execute) {
      // A dry run never actually removes rows from the unmigrated set, so a second pass would
      // just report the same rows again — one pass is all a dry run can meaningfully show.
      return { converged: true, passesRun: pass, totalAssigned, dryRun: true };
    }
  }
  return { converged: false, passesRun: maxPasses, totalAssigned };
}

function parseArgs(argv) {
  const args = { execute: false, table: null, streamTable: null, region: null, maxPasses: DEFAULT_MAX_PASSES };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--execute") args.execute = true;
    else if (argv[i] === "--table") args.table = argv[++i];
    else if (argv[i] === "--stream-table") args.streamTable = argv[++i];
    else if (argv[i] === "--region") args.region = argv[++i];
    else if (argv[i] === "--max-passes") args.maxPasses = Number(argv[++i]);
  }
  return args;
}

async function main() {
  const { execute, table, streamTable, region, maxPasses } = parseArgs(process.argv.slice(2));
  if (!table || !streamTable) {
    console.error(
      "Usage: backfill-change-sequence.mjs --table <ChangesTableName> --stream-table <ChangeStreamTableName> --region <region> [--execute] [--max-passes N]"
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[backfill] mode=${execute ? "EXECUTE (will write)" : "DRY RUN (no writes)"} table=${table} streamTable=${streamTable} region=${region ?? "(SDK default)"} maxPasses=${maxPasses}`
  );

  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, GetCommand, ScanCommand, TransactWriteCommand } = await import(
    "@aws-sdk/lib-dynamodb"
  );
  const client = DynamoDBDocumentClient.from(new DynamoDBClient(region ? { region } : {}));

  const result = await runConvergenceLoop({
    client,
    ScanCommandCtor: ScanCommand,
    GetCommandCtor: GetCommand,
    TransactWriteCommandCtor: TransactWriteCommand,
    table,
    streamTable,
    execute,
    maxPasses,
  });

  if (!execute) {
    console.log(`[backfill] dry run complete — would assign seq to ${result.totalAssigned} row(s). Re-run with --execute to perform these writes.`);
    return;
  }

  if (!result.converged) {
    console.error(
      `[backfill] FAILED TO CONVERGE after ${result.passesRun} pass(es) — stragglers kept appearing, meaning writes were NOT actually frozen during this run. ` +
        `Confirm sync-push is frozen (see this file's header comment's required deployment order) and re-run. Did NOT report success.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`[backfill] converged after ${result.passesRun} pass(es) — assigned seq to ${result.totalAssigned} row(s) total.`);

  console.log("[backfill] verifying stream/counter integrity…");
  const [changeRows, streamRows] = await Promise.all([
    scanAllRows(client, ScanCommand, table),
    scanAllRows(client, ScanCommand, streamTable),
  ]);
  const mismatches = computeIntegrityMismatches({ changeRows, streamRows });
  if (mismatches.length > 0) {
    console.error(`[backfill] INTEGRITY CHECK FAILED — ${mismatches.length} user(s) have a Changes/ChangeStream row-count mismatch:`);
    for (const m of mismatches) {
      console.error(`  user=${truncatedSub(m.pk)} changes=${m.changeCount} stream=${m.streamCount}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("[backfill] integrity verified — every user's Changes/ChangeStream row counts match. Safe to deploy the new Lambda code next.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
