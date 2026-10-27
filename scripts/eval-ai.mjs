#!/usr/bin/env node
// AI generation evaluation harness CLI (docs/ai-evaluation.md). Mock mode (the default) is fully
// deterministic and safe for CI — it never makes a network call. Real-provider mode is an
// explicit, deliberate opt-in (`--real`) against the Development backend only, requires
// `--base-url`/`--access-token` (or the EVAL_AI_BASE_URL/EVAL_AI_ACCESS_TOKEN env vars), prints
// the exact planned request count BEFORE making any request, and refuses to proceed without an
// explicit `--yes` once that plan is printed — see "Real provider safety" below.
//
// Run via `node --import ./scripts/ai-test-loader.mjs scripts/eval-ai.mjs -- <args>` (wired as
// `npm run eval:ai` in package.json) — the SAME extensionless-TypeScript-import loader hook this
// repository's own `test:ai`/`test:scheduling`/etc. scripts already use, so this file can import
// src/domain/ai/evaluation/*.ts directly with zero bundler/build step. This file itself is
// plain .mjs (not .ts) so it always runs under Node with no type-stripping dependency.
//
// NEVER logs an access token, even partially — CLAUDE.md's "Never print JWTs, access tokens,
// refresh tokens, passwords, or complete claims" applies here exactly as everywhere else in this
// repository. The token is held only in a local variable, passed straight into
// createBackendProvider's injected `getAccessToken`, and never appears in any console.log, the
// JSON report, or an error message.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createBackendProvider } from "../src/domain/ai/backendProvider.ts";
import { createMockProvider } from "../src/domain/ai/mockProvider.ts";
import { ALL_DIFFICULTIES, ALL_SCOPES, ALL_TIERS, buildEvaluationMatrix, buildFullMatrix } from "../src/domain/ai/evaluation/matrix.ts";
import { buildEvaluationReport, formatConsoleTable, formatFailureSummary } from "../src/domain/ai/evaluation/report.ts";
import { estimatePlannedRequestCount, runEvaluationMatrix } from "../src/domain/ai/evaluation/runner.ts";
import { EVALUATION_FIXTURES } from "../src/domain/ai/evaluation/fixtures.ts";

function printHelp() {
  console.log(`
Usage: npm run eval:ai -- [options]

  --fixture <id>         Repeatable. Defaults to a small smoke selection. See --list-fixtures.
  --difficulty <value>   Repeatable: basic | balanced | advanced. Default: balanced.
  --tier <value>         Repeatable: small | medium | large. Default: medium.
  --scope <value>        Repeatable: bounded | wholeSource. Default: bounded.
  --all                  Run the FULL matrix (every fixture x every dimension). Overrides the
                          selection flags above. Still mock-only unless --real is also passed.
  --real                 Use the real Development backend provider instead of the mock. Requires
                          --base-url and --access-token (or EVAL_AI_BASE_URL/EVAL_AI_ACCESS_TOKEN).
                          Prints the planned request count and STOPS unless --yes is also passed.
  --base-url <url>       Development API base URL (real mode only).
  --access-token <jwt>   A Development Cognito access token (real mode only) — never logged.
  --yes                  Confirms a real-provider run after reviewing its printed request count.
  --out <path>           Output JSON report path. Default: eval-output/<timestamp>.json.
  --list-fixtures        Print every registered fixture id + description and exit.
  --help                 Print this message and exit.
`);
}

function parseArgs(argv) {
  const args = {
    fixtureIds: [], difficulties: [], tiers: [], scopes: [],
    all: false, real: false, yes: false, baseUrl: undefined, accessToken: undefined,
    out: undefined, listFixtures: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fixture") args.fixtureIds.push(argv[++i]);
    else if (a === "--difficulty") args.difficulties.push(argv[++i]);
    else if (a === "--tier") args.tiers.push(argv[++i]);
    else if (a === "--scope") args.scopes.push(argv[++i]);
    else if (a === "--all") args.all = true;
    else if (a === "--real") args.real = true;
    else if (a === "--yes") args.yes = true;
    else if (a === "--base-url") args.baseUrl = argv[++i];
    else if (a === "--access-token") args.accessToken = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--list-fixtures") args.listFixtures = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exitCode = 1;
      args.help = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (args.listFixtures) {
    for (const f of EVALUATION_FIXTURES) {
      console.log(`${f.id}\t(${f.sourceType}, ${f.language})\t${f.description}`);
    }
    return;
  }

  const cases = args.all
    ? buildFullMatrix()
    : buildEvaluationMatrix({
        fixtureIds: args.fixtureIds.length ? args.fixtureIds : undefined,
        difficulties: args.difficulties.length ? args.difficulties : undefined,
        tiers: args.tiers.length ? args.tiers : undefined,
        scopes: args.scopes.length ? args.scopes : undefined,
      });

  console.log(`[eval-ai] ${cases.length} case(s) selected.`);

  let provider;
  let providerMode;
  if (args.real) {
    const baseUrl = args.baseUrl ?? process.env.EVAL_AI_BASE_URL;
    const accessToken = args.accessToken ?? process.env.EVAL_AI_ACCESS_TOKEN;
    if (!baseUrl || !accessToken) {
      console.error("[eval-ai] --real requires --base-url and --access-token (or EVAL_AI_BASE_URL/EVAL_AI_ACCESS_TOKEN env vars). Refusing to silently fall back to the mock provider.");
      process.exitCode = 1;
      return;
    }

    // Real-provider safety: print the EXACT planned request count before making any request, and
    // require explicit --yes to proceed — never bypasses the backend's own rate limiting (this
    // CLI makes ordinary HTTP requests through the exact same code path the app uses, subject to
    // the exact same per-user daily quota / concurrency lease), never a Production endpoint
    // (base-url is always explicitly supplied — see docs/ai-evaluation.md's "Real-provider
    // safety" section for why there is deliberately no default here).
    const plannedRequests = cases.reduce((sum, c) => sum + estimatePlannedRequestCount(c), 0);
    console.log(`[eval-ai] REAL PROVIDER MODE — ${cases.length} case(s), ${plannedRequests} planned backend request(s) total.`);
    console.log(`[eval-ai] Target: ${baseUrl}`);
    if (!args.yes) {
      console.log("[eval-ai] Re-run with --yes to actually execute this plan against the real backend. Stopping now — no request was made.");
      return;
    }

    providerMode = "real";
    provider = createBackendProvider({ getAccessToken: async () => accessToken, getBaseUrl: () => baseUrl });
  } else {
    providerMode = "mock";
    provider = createMockProvider();
  }

  const results = await runEvaluationMatrix(provider, cases);
  const report = buildEvaluationReport({ providerMode, providerId: provider.id, results });

  console.log("");
  console.log(formatConsoleTable(results));
  console.log("");
  console.log(formatFailureSummary(report.failures));
  console.log("");
  console.log(`[eval-ai] ${report.passed ? "PASSED" : "FAILED"} — ${results.length} case(s), ${report.failures.length} failure(s).`);

  const outPath = args.out ?? path.join("eval-output", `${report.generatedAt.replace(/[:.]/g, "-")}.json`);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(`[eval-ai] Report written to ${outPath}`);

  if (!report.passed) process.exitCode = 1;
}

await main();
