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

new IntervalSyncStack(app, "IntervalDevelopmentStack", {
  env: { region },
  environmentName: "development",
  description: "Interval Development environment: sync API, Lambdas, DynamoDB, Cognito. See docs/cdk-infrastructure.md.",
});

// Staging and Production are deliberately NOT instantiated here — see
// infra/lib/environment-config.ts's header comment and docs/cdk-infrastructure.md. Production
// is never imported or managed by CDK under any circumstance.
