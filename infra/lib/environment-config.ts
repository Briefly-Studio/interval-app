// Resource-naming model for all three environments, per docs/environment-separation-plan.md §4.
// IMPORTANT: this module only *describes* naming — it does not create or manage anything.
// "production" exists here purely so the naming convention is fully documented/testable; the
// existing Production stack is grandfathered and explicitly must never be instantiated,
// imported, or managed by CDK (see bin/interval-infra.ts, which only ever instantiates
// "development"). Do not add a `new IntervalSyncStack(..., { environmentName: "production" })`
// call anywhere — that is the one thing this model must never be used for.

export type IntervalEnvironmentName = "development" | "staging" | "production";

export interface IntervalResourceNames {
  syncApi: string;
  syncPush: string;
  syncPull: string;
  records: string;
  changes: string;
  userPool: string;
  mobileClient: string;
  syncLambdaRole: string;
}

const ENVIRONMENT_PREFIX: Record<IntervalEnvironmentName, string> = {
  development: "interval-dev",
  staging: "interval-staging",
  production: "interval-prod",
};

export function resourceNamesFor(environmentName: IntervalEnvironmentName): IntervalResourceNames {
  const prefix = ENVIRONMENT_PREFIX[environmentName];
  return {
    syncApi: `${prefix}-sync-api`,
    syncPush: `${prefix}-sync-push`,
    syncPull: `${prefix}-sync-pull`,
    records: `${prefix}-records`,
    changes: `${prefix}-changes`,
    userPool: `${prefix}-user-pool`,
    mobileClient: `${prefix}-mobile`,
    syncLambdaRole: `${prefix}-sync-lambda-role`,
  };
}
