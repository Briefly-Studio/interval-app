import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

import type { IntervalEnvironmentName } from "./environment-config";
import { resourceNamesFor } from "./environment-config";

export interface IntervalSyncStackProps extends cdk.StackProps {
  environmentName: IntervalEnvironmentName;
}

// Reusable across development/staging/production in principle — see environment-config.ts's
// header comment for why only "development" is ever actually instantiated (bin/interval-infra.ts).
// This stack defines exactly the 8 named application resources from docs/cdk-infrastructure.md
// (API, 2 Lambdas, 2 DynamoDB tables, Cognito pool + client, 1 shared IAM role) plus the minimal
// CDK/CloudFormation support constructs (JWT authorizer, Lambda integrations, log-permission
// policy) required to wire them together.
export class IntervalSyncStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IntervalSyncStackProps) {
    super(scope, id, props);

    const { environmentName } = props;
    const names = resourceNamesFor(environmentName);

    // Removal/deletion policy is a deliberate, per-environment decision — not inherited blindly.
    // Development data/identities are genuinely disposable (founder-only, destructive testing is
    // expected) — DESTROY is correct there and is unchanged by this stack supporting Staging.
    // Staging/Beta is different in kind, not just degree: it is intended for *external* beta
    // tester validation (docs/environment-separation-plan.md), meaning real people's accounts and
    // synced study data can exist there before Production ever does. A CloudFormation-driven
    // replacement (some DynamoDB/Cognito property changes force replacement, not an in-place
    // update) or an accidental `cdk destroy` must not silently delete that data as a side effect
    // of routine infrastructure work. RETAIN means the underlying table/pool survives even if its
    // CDK-managed lifecycle ends — orphaned and requiring a deliberate manual deletion, which is
    // exactly the asymmetry wanted: safe by default, an extra explicit step required to actually
    // destroy real user data. See docs/cdk-infrastructure.md's "Staging removal/deletion policy"
    // section for the full reasoning. Production is never instantiated by this stack at all (see
    // this file's class comment) — its entry in this map is unreachable, not a real decision.
    const REMOVAL_POLICY_FOR: Record<IntervalEnvironmentName, cdk.RemovalPolicy> = {
      development: cdk.RemovalPolicy.DESTROY,
      staging: cdk.RemovalPolicy.RETAIN,
      production: cdk.RemovalPolicy.RETAIN,
    };
    const removalPolicy = REMOVAL_POLICY_FOR[environmentName];

    // Same reasoning as removalPolicy above, applied to Cognito's own deletion-protection flag
    // (a separate mechanism from RemovalPolicy — it blocks direct pool deletion via the API/
    // console too, not just CloudFormation-driven removal). Off for Development (throwaway,
    // founder-only), on for Staging (real external beta identities) and Production.
    const cognitoDeletionProtectionEnabled = environmentName !== "development";

    cdk.Tags.of(this).add("Project", "Interval");
    cdk.Tags.of(this).add("Environment", environmentName);
    cdk.Tags.of(this).add("ManagedBy", "CDK");

    // ---------------------------------------------------------------------
    // DynamoDB — schema matches backend/lambdas/sync-push/index.mjs and sync-pull/index.mjs
    // exactly (PK/SK, both string), confirmed by direct source inspection, not assumed. Billing
    // mode, encryption, streams-off, and TTL-off mirror the live-confirmed Production shape
    // (docs/aws-current-state-audit.md) — see docs/cdk-infrastructure.md for the full rationale.
    // ---------------------------------------------------------------------
    const recordsTable = new dynamodb.Table(this, "RecordsTable", {
      tableName: names.records,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: false,
      removalPolicy,
    });

    const changesTable = new dynamodb.Table(this, "ChangesTable", {
      tableName: names.changes,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: false,
      removalPolicy,
    });

    // ---------------------------------------------------------------------
    // Cognito — fully separate pool/client from Production. No OAuth/Hosted-UI configuration:
    // src/auth/AuthService.ts authenticates via direct Cognito API calls
    // (USER_PASSWORD_AUTH/USER_SRP_AUTH/REFRESH_TOKEN_AUTH against cognito-idp directly), never
    // a browser-redirect flow, so there is nothing in this app for an OAuth callback URL to
    // serve — see docs/cdk-infrastructure.md's "Cognito" section for the full decision record
    // instead of copying Production's unresolved CloudFront callback blindly.
    // ---------------------------------------------------------------------
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: names.userPool,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      mfa: cognito.Mfa.OFF,
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy,
      deletionProtection: cognitoDeletionProtectionEnabled,
    });

    const userPoolClient = userPool.addClient("MobileClient", {
      userPoolClientName: names.mobileClient,
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: true,
        // No custom/adminUserPassword flow — the app never uses either.
      },
      // Explicit, not just an omission: CDK's UserPoolClient defaults to enabling OAuth (with a
      // placeholder "https://example.com" callback URL) whenever `oAuth` isn't set — silently
      // hitting exactly the "unnecessary/placeholder OAuth configuration" this stack must avoid
      // (see this section's header comment / docs/cdk-infrastructure.md's "Cognito" section).
      // `disableOAuth: true` turns off Hosted-UI/OAuth entirely, matching how the app actually
      // authenticates (direct Cognito API calls only).
      disableOAuth: true,
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ---------------------------------------------------------------------
    // IAM — one shared execution role for both Lambdas, matching Production's shared-role
    // pattern (docs/aws-current-state-audit.md). Least privilege, derived from exactly what the
    // Lambda source actually calls (verified by direct source inspection):
    //   - sync-push: PutCommand against Changes, UpdateCommand against Records
    //   - sync-pull: QueryCommand against Changes only (never touches Records)
    // No table ARN is ever "*" — every statement is scoped to one specific Development table.
    // ---------------------------------------------------------------------
    const syncLambdaRole = new iam.Role(this, "SyncLambdaRole", {
      roleName: names.syncLambdaRole,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        // Standard CloudWatch Logs permissions every Lambda needs to function — not a DynamoDB
        // grant, not a wildcard-resource concern.
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });

    syncLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "RecordsTableUpdateOnly",
        actions: ["dynamodb:UpdateItem"],
        resources: [recordsTable.tableArn],
      })
    );

    syncLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "ChangesTablePutAndQuery",
        actions: ["dynamodb:PutItem", "dynamodb:Query"],
        resources: [changesTable.tableArn],
      })
    );

    // ---------------------------------------------------------------------
    // Lambdas — package the repository's authoritative backend source directly
    // (backend/lambdas/sync-push, backend/lambdas/sync-pull), unmodified. No node_modules
    // bundled: both files import only "@aws-sdk/client-dynamodb"/"@aws-sdk/lib-dynamodb", which
    // the nodejs runtime provides built in, exactly as they already run in Production today.
    // ---------------------------------------------------------------------
    const nodeRuntime = resolveNodeRuntime();

    // Shared, size-agnostic props. memorySize/timeout are set PER FUNCTION below rather than
    // here, because the sync Lambdas and the presigned-URL Lambda have genuinely different
    // workloads (see each function's own comment).
    const commonLambdaProps = {
      runtime: nodeRuntime,
      architecture: lambda.Architecture.ARM_64,
      role: syncLambdaRole,
      handler: "index.handler",
    };

    // Sync Lambda sizing — raised from the original 128 MB / 3 s after a confirmed Development
    // incident (2026-08, docs/cdk-infrastructure.md "Sync Lambda sizing incident"): CloudWatch
    // showed `interval-dev-sync-push` terminating at exactly 3000 ms on every invocation
    // (warm invocations too, not just the one cold start that consumed ~330 ms of the budget),
    // API Gateway returning 500, and the client reporting `Http500` — while the DynamoDB tables
    // were healthy. 128 MB gives roughly 1/12th of a vCPU, and the push handler does two
    // network round trips (Changes PutItem + Records UpdateItem) per dirty record; on a weak
    // core, with cold-start and AWS-SDK retry/backoff on top, 3 s left no operational margin.
    //
    // 256 MB ~doubles the CPU/network share; 15 s is generous headroom for a bounded push
    // (the handler now caps changes-per-request and processes records with bounded concurrency
    // — see backend/lambdas/sync-push/lib.mjs) while still failing well inside API Gateway's own
    // 29 s integration ceiling. Deliberately NOT Lambda's maximum (10 GB / 900 s) — that would
    // waste money and hide, rather than fix, a genuinely slow path. The same construct serves
    // Development and Staging identically (see infra/bin/interval-infra.ts); Production is not
    // CDK-managed and is untouched.
    const SYNC_LAMBDA_MEMORY_MB = 256;
    const SYNC_LAMBDA_TIMEOUT = cdk.Duration.seconds(15);

    // Keep *.test.mjs (backend/lambdas/**/lib.test.mjs) out of the deployed Lambda package — they
    // are exercised locally via `npm run test:sync` (Node's built-in test runner), never at
    // runtime.
    const syncAssetExclude = ["*.test.mjs"];

    const syncPushFunction = new lambda.Function(this, "SyncPushFunction", {
      ...commonLambdaProps,
      memorySize: SYNC_LAMBDA_MEMORY_MB,
      timeout: SYNC_LAMBDA_TIMEOUT,
      functionName: names.syncPush,
      code: lambda.Code.fromAsset(path.join(__dirname, "../../backend/lambdas/sync-push"), {
        exclude: syncAssetExclude,
      }),
      environment: {
        RECORDS_TABLE: recordsTable.tableName,
        CHANGES_TABLE: changesTable.tableName,
      },
    });

    const syncPullFunction = new lambda.Function(this, "SyncPullFunction", {
      ...commonLambdaProps,
      memorySize: SYNC_LAMBDA_MEMORY_MB,
      timeout: SYNC_LAMBDA_TIMEOUT,
      functionName: names.syncPull,
      code: lambda.Code.fromAsset(path.join(__dirname, "../../backend/lambdas/sync-pull"), {
        exclude: syncAssetExclude,
      }),
      environment: {
        CHANGES_TABLE: changesTable.tableName,
      },
    });

    // ---------------------------------------------------------------------
    // API Gateway (HTTP API) — same route shape as Production (POST /sync/push, GET /sync/pull),
    // both routes behind Cognito JWT authorization scoped to this Development pool/client only.
    // No unauthenticated route exists.
    // ---------------------------------------------------------------------
    const httpApi = new apigwv2.HttpApi(this, "SyncApi", {
      apiName: names.syncApi,
      createDefaultStage: true,
    });

    const jwtAuthorizer = new apigwv2Authorizers.HttpJwtAuthorizer(
      "CognitoJwtAuthorizer",
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [userPoolClient.userPoolClientId] }
    );

    httpApi.addRoutes({
      path: "/sync/push",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration("SyncPushIntegration", syncPushFunction),
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: "/sync/pull",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2Integrations.HttpLambdaIntegration("SyncPullIntegration", syncPullFunction),
      authorizer: jwtAuthorizer,
    });

    // ---------------------------------------------------------------------
    // Private original-source storage — Development AND Staging. See
    // docs/library-and-source-architecture.md and docs/cdk-infrastructure.md's "Library source
    // storage" section for the full design record. This entire block is skipped for every other
    // environmentName — Production gets NO bucket, NO storage Lambda, NO storage IAM role, and NO
    // storage API routes as a result (Production is never instantiated by this stack at all — see
    // this file's class comment — so this exclusion is unreachable in practice, not a real
    // decision point). This is the same per-environment conditional idiom already used above for
    // cognitoDeletionProtectionEnabled, just gating resource creation itself rather than a single
    // property value. `npx cdk synth IntervalStagingStack` must show these resources named
    // `interval-staging-*`/CloudFormation-auto-generated, completely independent of Development's
    // — verify that after any change here.
    // ---------------------------------------------------------------------
    if (environmentName === "development" || environmentName === "staging") {
      // Bucket name is deliberately NOT set explicitly, unlike every other named resource in this
      // stack. S3 bucket names are unique across every AWS account on the entire platform, not
      // just within this account — a deterministic `${prefix}-library-sources`-style name could
      // collide with an unrelated bucket some other AWS customer already owns and fail to deploy.
      // CloudFormation's auto-generated name avoids that risk entirely; the real name is
      // available after deployment via the LibrarySourceBucketName stack output below.
      //
      // Lifecycle reuses the exact same `removalPolicy` this stack already computed above
      // (REMOVAL_POLICY_FOR) rather than a second, bucket-specific decision — DESTROY for
      // Development (disposable engineering environment, same reasoning as its DynamoDB
      // tables/Cognito pool), RETAIN for Staging (real external beta-tester original files must
      // not be silently deleted as a side effect of routine infrastructure work or an accidental
      // `cdk destroy`, matching Staging's DynamoDB tables/Cognito pool — see "Staging
      // removal/deletion policy" in docs/cdk-infrastructure.md). autoDeleteObjects is only valid,
      // and only needed, alongside DESTROY (CDK requires this pairing; RETAIN with
      // autoDeleteObjects: true is a synth-time error) — Staging's bucket is therefore left with
      // its default autoDeleteObjects: false, matching its RETAIN posture.
      const librarySourceBucket = new s3.Bucket(this, "LibrarySourceBucket", {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        removalPolicy,
        autoDeleteObjects: removalPolicy === cdk.RemovalPolicy.DESTROY,
      });
      cdk.Tags.of(librarySourceBucket).add("Component", "library-source-storage");

      const librarySourceStorageRole = new iam.Role(this, "LibrarySourceStorageRole", {
        roleName: names.librarySourceStorageRole,
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
        ],
      });

      // Least privilege: only PutObject/GetObject, only under this bucket's
      // users/*/sources/*/original key pattern — the exact shape
      // backend/lambdas/library-source-storage/index.mjs's objectKeyFor() produces, never a
      // bucket-wide "*". No DeleteObject (this batch never deletes cloud originals on tombstone —
      // see "Delete behavior" in docs/library-and-source-architecture.md), no ListBucket (never
      // lists keys). This role is intentionally separate from syncLambdaRole above — the sync
      // Lambdas remain responsible for synchronization only; this Lambda receives only the
      // minimum S3 permissions it needs and nothing else.
      librarySourceStorageRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "LibrarySourceObjectsOnly",
          actions: ["s3:PutObject", "s3:GetObject"],
          resources: [librarySourceBucket.arnForObjects("users/*/sources/*/original")],
        })
      );

      const librarySourceStorageFunction = new lambda.Function(this, "LibrarySourceStorageFunction", {
        ...commonLambdaProps,
        // Unchanged by the 2026-08 sync-Lambda sizing incident — this Lambda only derives an
        // object key from trusted claims and generates a short-lived S3 presigned URL (no
        // DynamoDB, no per-record loop), so 128 MB / 3 s remains appropriate. Set explicitly
        // here now that commonLambdaProps no longer carries memory/timeout.
        memorySize: 128,
        timeout: cdk.Duration.seconds(3),
        role: librarySourceStorageRole,
        functionName: names.librarySourceStorage,
        code: lambda.Code.fromAsset(path.join(__dirname, "../../backend/lambdas/library-source-storage")),
        environment: {
          LIBRARY_SOURCE_BUCKET: librarySourceBucket.bucketName,
        },
      });

      const librarySourceStorageIntegration = new apigwv2Integrations.HttpLambdaIntegration(
        "LibrarySourceStorageIntegration",
        librarySourceStorageFunction
      );

      // Both routes require the same Cognito JWT authorizer as /sync/push and /sync/pull above —
      // no unauthenticated route exists here either.
      httpApi.addRoutes({
        path: "/library/sources/{sourceId}/upload-url",
        methods: [apigwv2.HttpMethod.POST],
        integration: librarySourceStorageIntegration,
        authorizer: jwtAuthorizer,
      });

      httpApi.addRoutes({
        path: "/library/sources/{sourceId}/download-url",
        methods: [apigwv2.HttpMethod.POST],
        integration: librarySourceStorageIntegration,
        authorizer: jwtAuthorizer,
      });

      new cdk.CfnOutput(this, "LibrarySourceBucketName", { value: librarySourceBucket.bucketName });
    }

    // ---------------------------------------------------------------------
    // AI Generate Study Deck Lambda — Development only. Phase B of the Bedrock/Nova 2 Lite
    // integration (Phase A: backend/lambdas/ai-generate-study-deck/, src/domain/ai/,
    // src/cloud/ai/ — see docs/ai-generation-foundation.md). Deliberately narrower than the
    // Library source storage block above (development || staging): real provider-backed AI
    // generation stays Development-only until its own separate, founder-approved decision to
    // widen it — this matches the mobile-side gate exactly (src/domain/ai/providerSelection.ts's
    // USE_BACKEND_PROVIDER, which is false by default and even when true only ever activates in
    // Development). Deploying this (an explicit, separate `cdk deploy IntervalDevelopmentStack`)
    // and flipping USE_BACKEND_PROVIDER are both still separate, founder-gated steps after this
    // code lands — see docs/ai-generation-foundation.md's Phase B section. Production is never
    // instantiated by this stack at all (see this file's class comment), so this is unreachable
    // there regardless.
    // ---------------------------------------------------------------------
    if (environmentName === "development") {
      const aiGenerateStudyDeckRole = new iam.Role(this, "AiGenerateStudyDeckRole", {
        roleName: names.aiGenerateStudyDeckRole,
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
        ],
      });

      // Amazon Nova 2 Lite has no direct in-region invocation path from us-east-2 — verified
      // directly against AWS's own Bedrock regional-compatibility documentation before writing
      // this (not assumed): us-east-2 reaches Nova 2 Lite only through a cross-Region
      // (system-defined) inference profile, never a bare foundation-model id. "us." is the
      // correct geography-scoped profile prefix for a us-east-2-sourced call (keeps inference
      // within the US; "global." would allow routing anywhere worldwide). See
      // docs/ai-generation-foundation.md's "Bedrock model/region verification" section for the
      // full source-of-truth record — this is the one identifier Phase A's own code deliberately
      // never hardcodes (src/domain/ai/ and backend/lambdas/ai-generate-study-deck/index.mjs);
      // this is the one place in the whole repository it's written down, as an environment
      // variable value, never a product constant.
      const NOVA_2_LITE_FOUNDATION_MODEL_ID = "amazon.nova-2-lite-v1:0";
      const NOVA_2_LITE_INFERENCE_PROFILE_ID = "us.amazon.nova-2-lite-v1:0";

      // Calling a model THROUGH a cross-Region inference profile requires IAM permission on BOTH
      // the inference-profile resource AND the underlying foundation-model resource — verified
      // directly against AWS's own IAM identity-based-policy-examples documentation ("Minimal
      // policy for Amazon Bedrock Playground chat" lists exactly this pair together, and its own
      // closing note says to replace that example's wildcards with "the specific model and
      // inference profile ARNs" to restrict access). The foundation-model ARN's region segment
      // is wildcarded (never its model-id segment) because cross-Region inference inherently
      // routes to one of several destination regions internally — IAM evaluates the call as if
      // made against whichever destination region Bedrock actually selects, not just this
      // stack's own region. No `bedrock:*` and no resource-level `*` anywhere in this block.
      aiGenerateStudyDeckRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "BedrockInvokeNovaLite",
          // bedrock:InvokeModel is the correct action even though Phase A's code calls the
          // Converse API, not InvokeModel directly — verified directly against AWS's own
          // inference-prerequisites documentation: "bedrock:InvokeModel – Required to carry out
          // model invocation. Allows the role to call the InvokeModel and Converse API
          // operations." No separate bedrock:Converse action exists. Streaming permission
          // (bedrock:InvokeModelWithResponseStream) is deliberately omitted — Phase A's code uses
          // ConverseCommand, never ConverseStreamCommand; this repository does not introduce
          // streaming.
          actions: ["bedrock:InvokeModel"],
          resources: [
            `arn:aws:bedrock:*::foundation-model/${NOVA_2_LITE_FOUNDATION_MODEL_ID}`,
            `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${NOVA_2_LITE_INFERENCE_PROFILE_ID}`,
          ],
        })
      );

      // Required specifically because invocation goes through a cross-Region inference profile
      // rather than a direct foundation-model id — verified directly against AWS's own IAM
      // prerequisites-for-inference documentation: "bedrock:GetInferenceProfile – Required to
      // run inference with an inference profile." Scoped to only the one profile this Lambda
      // ever calls.
      aiGenerateStudyDeckRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "BedrockGetNovaLiteInferenceProfile",
          actions: ["bedrock:GetInferenceProfile"],
          resources: [`arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${NOVA_2_LITE_INFERENCE_PROFILE_ID}`],
        })
      );

      // Timing contract, restated from Phase A (src/domain/ai/limits.ts's
      // GENERATION_LIMITS.requestTimeoutMs=25_000 and backend/lambdas/ai-generate-study-deck/
      // bedrockClient.mjs's BEDROCK_CALL_TIMEOUT_MS=20_000) so this Lambda's own CDK timeout
      // stays consistent with both: the Bedrock call itself is independently bounded to 20s, the
      // overall app-level request budget is 25s, and both stay under API Gateway HTTP API's
      // fixed, non-configurable 29s integration ceiling. 28s here leaves the smallest possible
      // margin under that 29s ceiling, after the 25s app budget already accounts for cold start
      // and request/response validation — never increased merely to "be safe," since widening it
      // further would itself approach the 29s ceiling again. Memory (512 MB) is its own
      // independent choice, not copied from the sync Lambdas' 256 MB (no DynamoDB round trips
      // here) or the presigned-URL Lambda's 128 MB (this Lambda does JSON parsing of a model
      // response plus the AWS SDK Bedrock client's own overhead, a meaningfully different
      // workload from either).
      const aiGenerateStudyDeckFunction = new lambda.Function(this, "AiGenerateStudyDeckFunction", {
        ...commonLambdaProps,
        role: aiGenerateStudyDeckRole,
        memorySize: 512,
        timeout: cdk.Duration.seconds(28),
        functionName: names.aiGenerateStudyDeck,
        // Packages this directory exactly as committed, node_modules included — see
        // backend/lambdas/ai-generate-study-deck/package.json's own header comment and
        // docs/cdk-infrastructure.md's "AI Generate Study Deck Lambda" section for why this
        // Lambda (uniquely among this stack's four Lambdas) needs its own node_modules:
        // @aws-sdk/client-bedrock-runtime is not reliably bundled in the Lambda Node.js runtime
        // the way @aws-sdk/client-dynamodb is for the sync Lambdas. `npm ci` MUST be run inside
        // that directory before `cdk synth`/`cdk deploy` — this is a build-step requirement, not
        // something CDK enforces for you; `lambda.Code.fromAsset` packages whatever is actually
        // on disk at synth time, nothing more and nothing less.
        code: lambda.Code.fromAsset(path.join(__dirname, "../../backend/lambdas/ai-generate-study-deck"), {
          exclude: ["*.test.mjs"],
        }),
        environment: {
          // Never a product/domain constant — read only from here, exactly as Phase A's
          // callModelProvider() expects (backend/lambdas/ai-generate-study-deck/index.mjs).
          // Changing the configured model later (e.g. a future Claude Haiku routing decision) is
          // a one-line change to this value, never a code change.
          BEDROCK_MODEL_ID: NOVA_2_LITE_INFERENCE_PROFILE_ID,
        },
      });

      // Same Cognito JWT authorizer as every other authenticated route on this API — no second
      // identity system, no unauthenticated route. Path matches src/cloud/ai/http.ts's
      // GENERATE_STUDY_DECK_PATH constant exactly.
      httpApi.addRoutes({
        path: "/ai/generate-study-deck",
        methods: [apigwv2.HttpMethod.POST],
        integration: new apigwv2Integrations.HttpLambdaIntegration("AiGenerateStudyDeckIntegration", aiGenerateStudyDeckFunction),
        authorizer: jwtAuthorizer,
      });
    }

    // ---------------------------------------------------------------------
    // Outputs — public identifiers only (matching the existing Production "AWS Resources"
    // section in CLAUDE.md's own precedent of documenting these plainly). No secret exists for
    // any of these; the app client has no client secret.
    // ---------------------------------------------------------------------
    new cdk.CfnOutput(this, "SyncApiUrl", { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "RecordsTableName", { value: recordsTable.tableName });
    new cdk.CfnOutput(this, "ChangesTableName", { value: changesTable.tableName });
  }
}

// nodejs24.x matches Production's live-confirmed runtime (docs/aws-current-state-audit.md).
// Falls back to constructing the runtime by name if the installed aws-cdk-lib version doesn't
// yet export a NODEJS_24_X constant, rather than silently downgrading to an older runtime.
function resolveNodeRuntime(): lambda.Runtime {
  const runtimeWithFallback = lambda.Runtime as unknown as { NODEJS_24_X?: lambda.Runtime };
  return runtimeWithFallback.NODEJS_24_X ?? new lambda.Runtime("nodejs24.x", lambda.RuntimeFamily.NODEJS);
}
