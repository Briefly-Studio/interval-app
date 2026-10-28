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
  // Authoritative, strongly-consistent-queryable ordered change stream (sync-cursor-hardening
  // rework, docs/sync-cursor-semantics.md) — a dedicated base table (PK=U#<sub>, SK=seq Number),
  // never a GSI on `changes`: DynamoDB GSIs can never serve a `ConsistentRead: true` query, so
  // ordering the pull stream through one left a real eventual-consistency gap (a higher-seq row's
  // index projection could become visible before a lower-seq row's, letting a cursor skip past a
  // position that may still be invisible). A dedicated table's own primary key has no such gap.
  changeStream: string;
  userPool: string;
  mobileClient: string;
  syncLambdaRole: string;
  // Private original-source storage (see interval-sync-stack.ts's Development-only conditional
  // block and docs/library-and-source-architecture.md). Computed for every environment here,
  // same as every other name in this file — only the STACK decides which environments actually
  // get these resources created; this file remains pure naming, never a feature gate. Note the S3
  // bucket itself deliberately has NO entry here — see the stack's own comment for why bucket
  // names can't safely be deterministic the way every other resource in this file is.
  librarySourceStorage: string;
  librarySourceStorageRole: string;
  // AI Generate Study Deck Lambda (Phase A: backend/lambdas/ai-generate-study-deck/; Phase B
  // wires it into this stack). Computed for every environment here, same as every other name in
  // this file — only the STACK decides which environments actually get this resource created;
  // this file remains pure naming, never a feature gate.
  aiGenerateStudyDeck: string;
  aiGenerateStudyDeckRole: string;
  // Per-user daily quota + concurrency lease storage for the AI Lambda above — same naming-only
  // convention: computed for every environment, only ever instantiated where the stack's own
  // conditional (today: development only) decides to create it.
  aiRateLimits: string;
  aiRequestIdempotency: string;
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
    changeStream: `${prefix}-change-stream`,
    userPool: `${prefix}-user-pool`,
    mobileClient: `${prefix}-mobile`,
    syncLambdaRole: `${prefix}-sync-lambda-role`,
    librarySourceStorage: `${prefix}-library-source-storage`,
    librarySourceStorageRole: `${prefix}-library-source-storage-role`,
    aiGenerateStudyDeck: `${prefix}-ai-generate-study-deck`,
    aiGenerateStudyDeckRole: `${prefix}-ai-generate-study-deck-role`,
    aiRateLimits: `${prefix}-ai-rate-limits`,
    aiRequestIdempotency: `${prefix}-ai-request-idempotency`,
  };
}
