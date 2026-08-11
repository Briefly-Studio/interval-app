# Interval CDK Infrastructure

**Status: implemented locally, not yet deployed.** This document covers the AWS CDK v2
(TypeScript) foundation for Interval's Development environment — what it defines, what it
deliberately does not touch, and the exact procedure for deploying it from AWS CloudShell once
the founder has reviewed it. No AWS resource described here has been created yet.

## Architecture

`infra/` is a self-contained CDK v2 TypeScript project, isolated from the React Native
application's own dependency graph (its own `package.json`/`node_modules`/`tsconfig.json` — `npm
install` in `infra/` never touches the mobile app's dependencies, and vice versa).

```
infra/
  bin/interval-infra.ts        CDK app entrypoint — instantiates Development only
  lib/environment-config.ts    Resource-naming model for development/staging/production
  lib/interval-sync-stack.ts   The stack construct: API, Lambdas, DynamoDB, Cognito, IAM
  cdk.json, tsconfig.json, package.json
```

`IntervalSyncStack` is written to be reusable across `development` / `staging` / `production`
(matching `docs/environment-separation-plan.md`'s three-environment model) — but `bin/interval-infra.ts` **only ever instantiates it once, for `development`**. There is no code path anywhere
in this project that creates, imports, or manages a Production or Staging stack. Staging is not
created by this mission; Production is explicitly out of scope for CDK, permanently, by design —
see "What CDK does not manage" below.

**Region: `us-east-2`** — fixed in `bin/interval-infra.ts`, matching every existing Interval
environment.

**Account: intentionally never specified.** The stack is written as an
["environment-agnostic" stack](https://docs.aws.amazon.com/cdk/v2/guide/environments.html) — `env`
only sets `region`, never `account`. This is not an oversight: an earlier local iteration of this
project *did* read `process.env.CDK_DEFAULT_ACCOUNT`, and local `cdk synth` (run with no intended
AWS session) silently resolved and embedded a real 12-digit account ID into the synthesized
template, sourced from a stale, long-lived credentials file already present on the local machine
(`~/.aws/credentials`, last modified over a year prior — not an active session, and not something
this project's code should ever have touched). That was corrected before this document was
written: the committed code never reads any ambient credential-derived value, and `cdk synth`
locally now produces a template containing zero account IDs, verified by direct inspection — see
"Local validation" below. `cdk deploy`, when run inside AWS CloudShell, resolves the deploy target
automatically from CloudShell's own authenticated session; nothing here needs to name it.

## Development resource names

Exactly eight application resources, per `docs/environment-separation-plan.md` §4's naming
standard:

| Resource | Name |
|---|---|
| API Gateway HTTP API | `interval-dev-sync-api` |
| Lambda (push) | `interval-dev-sync-push` |
| Lambda (pull) | `interval-dev-sync-pull` |
| DynamoDB (records) | `interval-dev-records` |
| DynamoDB (changes) | `interval-dev-changes` |
| Cognito user pool | `interval-dev-user-pool` |
| Cognito app client | `interval-dev-mobile` |
| IAM role (shared, both Lambdas) | `interval-dev-sync-lambda-role` |

CloudFormation stack name: **`IntervalDevelopmentStack`**.

## Production grandfathering

The existing Production stack (`IntervalSyncApi`, `IntervalSyncPush`, `IntervalSyncPull`,
`Interval_Records`, `Interval_Changes`, `IntervalUserPool`, `IntervalMobile`,
`IntervalSyncLambdaRole`) is **not represented anywhere in this CDK project** — not imported, not
referenced, not modeled as a second stack instance. It continues to be managed exactly as it is
today (manually, outside IaC) until a separate, explicit, founder-approved decision changes that.
This document's deployment procedure (below) includes a read-only step to *confirm* Production
still exists and is untouched, specifically because deploying Development must never be mistaken
for, or accidentally become, a Production change.

## DynamoDB

`interval-dev-records` / `interval-dev-changes` — key schema (`PK` hash, `SK` range, both string)
copied exactly from `backend/lambdas/sync-push/index.mjs`'s actual `PutCommand`/`UpdateCommand`
calls and `sync-pull/index.mjs`'s `QueryCommand`, not assumed. `PAY_PER_REQUEST` billing,
AWS-managed encryption at rest, streams and TTL both off — matching the live-confirmed Production
shape (`docs/aws-current-state-audit.md`), since nothing in the current backend source needs
streams or TTL for either environment.

**Removal policy: `DESTROY`.** Development data is disposable by design — decks/cards/sessions
pushed to a Development backend during testing are expected to be wiped freely, and a
`cdk destroy`/stack-replacement should not require a manual DynamoDB table deletion step. This is
never applied to Production (Production isn't managed by this project at all, so the question
doesn't arise) — documented here so a future Staging stack's removal policy is a deliberate choice
made by rereading this section, not copied blindly from Development's.

## Cognito

`interval-dev-user-pool` / `interval-dev-mobile` — fully separate pool and client from Production,
no shared users, no migration mechanism. No client secret (`generateSecret: false`), matching
Production and matching how `src/auth/AuthService.ts` actually authenticates. Explicit auth flows:
`ALLOW_USER_PASSWORD_AUTH`, `ALLOW_USER_SRP_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH` — exactly the three
flows `AuthService.ts`'s `InitiateAuth`/refresh calls actually use (verified by direct source
inspection). MFA off, password policy matching Production's (length 8, all four character
classes, 7-day temporary password validity).

**No OAuth/Hosted-UI configuration — `disableOAuth: true`, explicitly, not just omitted.**
`src/auth/AuthService.ts` authenticates via direct Cognito API calls
(`https://cognito-idp.<region>.amazonaws.com/`), never a browser-redirect flow, so there is
nothing in this app for an OAuth callback URL to serve. This matters concretely: CDK's
`UserPoolClient` construct **defaults to enabling OAuth** (with a placeholder
`https://example.com` callback URL) whenever `oAuth` isn't explicitly configured — an early local
synth of this stack actually produced that placeholder callback before this was caught and fixed.
`disableOAuth: true` turns Hosted-UI/OAuth off entirely rather than relying on an omission that
CDK doesn't actually treat as "off." Production's own OAuth/CloudFront callback configuration
(whose actual usage remains unresolved — see `docs/aws-current-state-audit.md`'s Cognito section)
is not copied here at all.

**Deletion protection: off**, matching the `DESTROY` removal-policy reasoning above — Development
identities are disposable.

## IAM

`interval-dev-sync-lambda-role` — one shared execution role for both Lambdas, matching
Production's shared-role pattern. Least privilege, derived from exactly what the Lambda source
calls (verified by direct source inspection, not assumed):

| Statement | Actions | Resource |
|---|---|---|
| `RecordsTableUpdateOnly` | `dynamodb:UpdateItem` | `interval-dev-records` ARN only |
| `ChangesTablePutAndQuery` | `dynamodb:PutItem`, `dynamodb:Query` | `interval-dev-changes` ARN only |

No statement uses `Resource: "*"` for DynamoDB, and neither statement grants any action against
the *other* Development table (`sync-pull` never touches Records; neither Lambda ever needs
`GetItem`/`Scan`/`DeleteItem`/`BatchWrite*` on either table, so none of those actions are granted).
Zero access to any Production table — Production ARNs never appear anywhere in this project.
Plus the standard `AWSLambdaBasicExecutionRole` AWS-managed policy (CloudWatch Logs only — every
Lambda needs this to run at all; not a DynamoDB grant). No human IAM user is created anywhere in
this project.

## Lambda packaging

`interval-dev-sync-push` / `interval-dev-sync-pull` package
`backend/lambdas/sync-push/index.mjs` and `sync-pull/index.mjs` **directly and unmodified** —
`lambda.Code.fromAsset(...)` points straight at those directories; no backend logic was rewritten,
no `node_modules` bundled (both files import only `@aws-sdk/client-dynamodb`/`@aws-sdk/lib-dynamodb`, which the `nodejs24.x` Lambda runtime provides built in, exactly as Production runs
today). Runtime `nodejs24.x`, architecture `arm64`, memory 128 MB, timeout 3 seconds — matching
Production's live-confirmed configuration exactly (`docs/aws-current-state-audit.md`).

Environment variables:
- `interval-dev-sync-push`: `RECORDS_TABLE=interval-dev-records`, `CHANGES_TABLE=interval-dev-changes`
- `interval-dev-sync-pull`: `CHANGES_TABLE=interval-dev-changes`

No Production table name, API ID, or Cognito identifier appears in either function's environment
or anywhere else in this project.

## API Gateway / JWT authorization

`interval-dev-sync-api` — HTTP API (API Gateway v2), same two routes as Production:

- `POST /sync/push` → `interval-dev-sync-push`
- `GET /sync/pull` → `interval-dev-sync-pull`

Both routes require a Cognito JWT (`HttpJwtAuthorizer`) whose issuer is
`https://cognito-idp.us-east-2.amazonaws.com/<interval-dev-user-pool ID>` and whose audience is
the `interval-dev-mobile` app client ID — both resolved via CDK references to the Development
pool/client this same stack creates, never hardcoded. **No unauthenticated route exists.**
Integrations are `AWS_PROXY` with payload format `2.0`, matching Production.

## Tagging

Every taggable resource in the stack carries:

```
Project = Interval
Environment = development
ManagedBy = CDK
```

Applied stack-wide via `cdk.Tags.of(this).add(...)`, not per-resource, so nothing can be added to
this stack later without inheriting the same tags. No sensitive data in any tag value.

## What CDK manages

Everything in "Development resource names" above, and only those — plus the minimal
CloudFormation/CDK support constructs required to wire them together (the JWT authorizer, Lambda
invoke permissions for API Gateway, the IAM policy attached to the shared role, the API's default
stage, and CDK's own bootstrap-version metadata resource). Verified directly against the
synthesized template — see "Local validation" below.

## What CDK does not manage

- **Production.** Not imported, not referenced, not modeled as a stack. Continues to be managed
  exactly as it is today, outside IaC, until a separate, explicit, founder-approved decision
  changes that.
- **Staging.** Not created by this mission. The naming model
  (`infra/lib/environment-config.ts`) already knows what Staging's resource names *would* be, for
  when that's approved, but no Staging stack is ever instantiated by the code in this repository
  today.
- Anything outside the 8 named resources: no S3, no AI/transcription infrastructure, no Canvas
  integration, no notification infrastructure, no hosted-sharing infrastructure. All explicitly
  out of scope for this mission and not present anywhere in `infra/`.

## No permanent local AWS credentials required

This CDK project was built and fully validated (`npm install`, `tsc`, `cdk synth`) on a machine
with no intentionally-configured AWS credentials. AWS CloudShell — already authenticated as
whichever identity opens it — is the intended execution environment for the first deployment; the
procedure below never asks the founder to place a long-lived access key on any local machine, and
this repository does not do so either.

## CloudShell deployment procedure

**Prepared, not yet run.** Every command below is exact and ready to copy/paste, but none has been
executed as part of this mission — deployment happens only after the founder has reviewed this
infrastructure and explicitly decided to proceed.

### 1–2. Open CloudShell, confirm region

Open AWS CloudShell in the known Interval AWS account (console → CloudShell icon). Every command
below explicitly passes `--region us-east-2` rather than relying on whatever region CloudShell
happens to default to.

### 3. Verify this is the Interval account, read-only

```bash
aws sts get-caller-identity

aws apigatewayv2 get-apis --region us-east-2 \
  --query "Items[?Name=='IntervalSyncApi']"

aws cognito-idp list-user-pools --max-results 20 --region us-east-2 \
  --query "UserPools[?Name=='IntervalUserPool']"
```

Expect the second command to return the existing Production `IntervalSyncApi` and the third to
return the existing `IntervalUserPool` — confirming this session is authenticated against the
correct, known account before anything else happens. If either comes back empty, stop and
resolve the account/session mismatch before proceeding — do not continue in the wrong account.

### 4–5. Get the infrastructure source

```bash
git clone https://github.com/Briefly-Studio/interval-app.git
cd interval-app/infra
```

(If already cloned from an earlier session: `cd interval-app && git pull && cd infra`.)

### 6. Install infrastructure dependencies

```bash
npm install
```

### 7. Bootstrap (if not already done for this account/region)

CDK bootstrap provisions the small set of shared support resources (an S3 asset bucket, IAM
roles) every CDK deployment in an account/region needs — it's idempotent and safe to run even if
already bootstrapped (it detects and no-ops, or upgrades in place).

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
npx cdk bootstrap "aws://${ACCOUNT_ID}/us-east-2"
```

The account ID is resolved from the live CloudShell session at execution time via the command
above — it is never written into this repository, this document, or any tracked file.

### 8. Synthesize

```bash
npx cdk synth
```

### 9. Diff — Development only

```bash
npx cdk diff IntervalDevelopmentStack
```

Naming the stack explicitly (rather than a bare `cdk diff`) is deliberate — if a Staging stack is
ever added to this same CDK app in the future, this still targets only Development.

### 10. Review the diff

Before deploying, confirm the diff shows **only**:
- New resources named `interval-dev-*` (the 8 named resources plus support constructs).
- No resource named `IntervalSyncApi`, `IntervalSyncPush`, `IntervalSyncPull`, `Interval_Records`,
  `Interval_Changes`, `IntervalUserPool`, `IntervalMobile`, or `IntervalSyncLambdaRole` (the
  Production names) anywhere in the diff.
- No deletion or modification of any existing resource — this should be a pure, additive create.

### 11. Deploy — Development only

```bash
npx cdk deploy IntervalDevelopmentStack
```

Again, the stack name is explicit and required — never a bare `cdk deploy`.

### 12. Read-only post-deployment verification

```bash
aws cloudformation describe-stacks --stack-name IntervalDevelopmentStack --region us-east-2 \
  --query "Stacks[0].Outputs"

aws dynamodb describe-table --table-name interval-dev-records --region us-east-2 \
  --query "Table.{Status:TableStatus,Billing:BillingModeSummary.BillingMode}"
aws dynamodb describe-table --table-name interval-dev-changes --region us-east-2 \
  --query "Table.{Status:TableStatus,Billing:BillingModeSummary.BillingMode}"

aws cognito-idp describe-user-pool --user-pool-id <UserPoolId from stack outputs> \
  --region us-east-2 --query "UserPool.{Name:Name,Mfa:MfaConfiguration}"

aws apigatewayv2 get-apis --region us-east-2 \
  --query "Items[?Name=='interval-dev-sync-api']"

aws lambda get-function --function-name interval-dev-sync-push --region us-east-2 \
  --query "Configuration.{Runtime:Runtime,Arch:Architectures,Memory:MemorySize,Timeout:Timeout}"
aws lambda get-function --function-name interval-dev-sync-pull --region us-east-2 \
  --query "Configuration.{Runtime:Runtime,Arch:Architectures,Memory:MemorySize,Timeout:Timeout}"

aws apigatewayv2 get-apis --region us-east-2 \
  --query "Items[?Name=='IntervalSyncApi']"
aws cognito-idp list-user-pools --max-results 20 --region us-east-2 \
  --query "UserPools[?Name=='IntervalUserPool']"
```

The last two commands re-confirm Production is still present and untouched — the same check as
step 3, run again after Development's deployment, as a closing safety confirmation.

## Rollback / removal

`interval-dev-*` resources are fully disposable by design (`DESTROY` removal policy throughout —
see "DynamoDB" and "Cognito" above). To remove the entire Development stack:

```bash
npx cdk destroy IntervalDevelopmentStack
```

This deletes only the 8 named Development resources and their CDK/CloudFormation support
constructs. It cannot affect Production, which this project has no reference to at all.

## Future: Development values for the app config contract

Once deployed, the stack's `CfnOutput`s (`SyncApiUrl`, `UserPoolId`, `UserPoolClientId`) provide
the real values for `docs/environment-config-contract.md`'s `INTERVAL_ENV=development` local
`.env` — see that document and `docs/environment-separation-plan.md` §6 for the full contract.
Not configured yet; see the "App config preparation" note in this mission's final report for what
remains manual (adding these real values to a local `.env`) versus what this stack already
provides (the values themselves, once deployed).
