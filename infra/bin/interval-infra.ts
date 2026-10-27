#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";

import { IntervalSyncStack } from "../lib/interval-sync-stack";

const app = new cdk.App();

// Region is fixed per docs/environment-separation-plan.md ("All environments use us-east-2").
// Account is deliberately never read or hardcoded anywhere in this repository — `env` below
// intentionally omits `account` entirely, which makes this an "environment-agnostic" stack (the
// standard CDK pattern for this — see the CDK documentation on environment-agnostic stacks).
// Concretely this means:
//   - `cdk synth` locally never resolves, embeds, or depends on any AWS account ID, regardless
//     of what credentials (if any) happen to be present in the local environment.
//   - `cdk deploy`, when eventually run inside AWS CloudShell, automatically targets whichever
//     account CloudShell's own authenticated session belongs to — nothing here needs to name it.
// Do not add an `account:` key here, and do not read `process.env.CDK_DEFAULT_ACCOUNT` (or any
// other ambient credential-derived value) anywhere in this app — both would defeat the point of
// keeping this synthesizable without any local AWS credentials.
const region = "us-east-2";

// Sync-cursor-hardening rollout flags (docs/sync-cursor-semantics.md's "Rollout" section) — read
// per-environment context keys (persisted, safe-by-default in cdk.json; overridable per-deploy
// via `-c developmentSyncCursorMode=v2` etc.) so Development and Staging can be transitioned
// independently. IntervalSyncStack itself re-validates and fail-closes these regardless of what
// is passed here — this read is not the only safety net.
new IntervalSyncStack(app, "IntervalDevelopmentStack", {
  env: { region },
  environmentName: "development",
  description: "Interval Development environment: sync API, Lambdas, DynamoDB, Cognito. See docs/cdk-infrastructure.md.",
  syncCursorMode: app.node.tryGetContext("developmentSyncCursorMode"),
  syncPushMaintenance: app.node.tryGetContext("developmentSyncPushMaintenance"),
});

// IntervalDevelopmentStack is deployed and founder-QA verified end-to-end (auth, sync, deck/card
// creation, repeated multi-device sync) — see docs/cdk-infrastructure.md. IntervalStagingStack
// reuses the exact same IntervalSyncStack construct, proven by that verification, with only the
// environment-specific differences the construct itself already models (resource names via
// environment-config.ts, and the RETAIN removal/deletion policy for real external beta-user data
// — see interval-sync-stack.ts's REMOVAL_POLICY_FOR comment). Both core stacks and the Library
// source-storage capability are deployed and founder-QA verified — see docs/cdk-infrastructure.md.
new IntervalSyncStack(app, "IntervalStagingStack", {
  env: { region },
  environmentName: "staging",
  description: "Interval Staging/Beta environment: sync API, Lambdas, DynamoDB, Cognito. See docs/cdk-infrastructure.md.",
  syncCursorMode: app.node.tryGetContext("stagingSyncCursorMode"),
  syncPushMaintenance: app.node.tryGetContext("stagingSyncPushMaintenance"),
});

// Production is deliberately NOT instantiated here — see infra/lib/environment-config.ts's
// header comment and docs/cdk-infrastructure.md. Production is never imported or managed by CDK
// under any circumstance.
