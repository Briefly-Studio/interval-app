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

    const commonLambdaProps = {
      runtime: nodeRuntime,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 128,
      timeout: cdk.Duration.seconds(3),
      role: syncLambdaRole,
      handler: "index.handler",
    };

    const syncPushFunction = new lambda.Function(this, "SyncPushFunction", {
      ...commonLambdaProps,
      functionName: names.syncPush,
      code: lambda.Code.fromAsset(path.join(__dirname, "../../backend/lambdas/sync-push")),
      environment: {
        RECORDS_TABLE: recordsTable.tableName,
        CHANGES_TABLE: changesTable.tableName,
      },
    });

    const syncPullFunction = new lambda.Function(this, "SyncPullFunction", {
      ...commonLambdaProps,
      functionName: names.syncPull,
      code: lambda.Code.fromAsset(path.join(__dirname, "../../backend/lambdas/sync-pull")),
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
