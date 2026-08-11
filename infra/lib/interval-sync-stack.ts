import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
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

    // Development data/identities are disposable — see docs/cdk-infrastructure.md's "Removal
    // policy" section. Never used for "production" since that branch of this stack is never
    // instantiated (see this file's class comment).
    const removalPolicy = cdk.RemovalPolicy.DESTROY;

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
      deletionProtection: false,
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
