# Interval CDK Infrastructure

**Status: both Development and Staging deployed and founder-QA verified end-to-end. Production
remains the existing grandfathered baseline, outside CDK.** The three-environment architecture
described in `docs/environment-separation-plan.md` is now operational.

**Infrastructure deployed successfully:** `IntervalDevelopmentStack` and `IntervalStagingStack`
are both live in `us-east-2` — CloudFormation `CREATE_COMPLETE` for both, `cdk diff` reports no
differences against either, and every DynamoDB table (`interval-dev-records`,
`interval-dev-changes`, `interval-staging-records`, `interval-staging-changes`) is `ACTIVE`.

**App-level founder QA completed, for both environments, using the same checklist:** app
configured with the environment's `INTERVAL_ENV` value and Dev Tools reporting the matching label
(`Development` / `Staging`); a fresh Cognito account created; sign-up/sign-in working; repeated
Force Resync working with no errors; deck/card creation and cloud sync working; the same account
verified working on both a physical phone and the iOS simulator. Production confirmed isolated
and untouched throughout both deployments.

**Remaining infrastructure hardening intentionally not part of this milestone:** DynamoDB PITR
stays off in both environments (a separate future decision); the CDK `pointInTimeRecovery` API
used in this project is deprecated in favor of `pointInTimeRecoverySpecification` (a `cdk
synth`-time warning, not a functional issue) and remains unaddressed cleanup work; CloudShell may
warn about Node.js 20 relative to future AWS SDK releases — not a current deployment blocker, just
worth knowing about for a future CloudShell session; Production is still not managed by CDK, by
design. None of this was in scope for, or blocked, closing out the three-environment milestone.

Staging/Beta is the same environment as Development's counterpart for *external beta-tester*
validation before Production — it is not a fourth environment, and it is not an internal detail
of Development.

## Architecture

`infra/` is a self-contained CDK v2 TypeScript project, isolated from the React Native
application's own dependency graph (its own `package.json`/`node_modules`/`tsconfig.json` — `npm
install` in `infra/` never touches the mobile app's dependencies, and vice versa).

```
infra/
  bin/interval-infra.ts        CDK app entrypoint — instantiates Development and Staging
  lib/environment-config.ts    Resource-naming model for development/staging/production
  lib/interval-sync-stack.ts   The stack construct: API, Lambdas, DynamoDB, Cognito, IAM
  cdk.json, tsconfig.json, package.json
```

`IntervalSyncStack` is written to be reusable across `development` / `staging` / `production`
(matching `docs/environment-separation-plan.md`'s three-environment model) — `bin/interval-infra.ts`
instantiates it twice, once for `development` and once for `staging`, as two independent
CloudFormation stacks with no resources shared between them. There is no code path anywhere in
this project that creates, imports, or manages a Production stack — that remains permanently out
of scope for CDK, by design — see "What CDK does not manage" below.

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

## Staging resource names

Same eight resource types, `interval-staging-*` names, a fully independent set of AWS resources
from Development's — no table, pool, function, or role is shared between the two stacks:

| Resource | Name |
|---|---|
| API Gateway HTTP API | `interval-staging-sync-api` |
| Lambda (push) | `interval-staging-sync-push` |
| Lambda (pull) | `interval-staging-sync-pull` |
| DynamoDB (records) | `interval-staging-records` |
| DynamoDB (changes) | `interval-staging-changes` |
| Cognito user pool | `interval-staging-user-pool` |
| Cognito app client | `interval-staging-mobile` |
| IAM role (shared, both Lambdas) | `interval-staging-sync-lambda-role` |

CloudFormation stack name: **`IntervalStagingStack`**.

Staging/Beta is the same environment — external beta-tester validation before Production, per
`docs/environment-separation-plan.md` §17's founder-approved decision. There is no separate fourth
"beta" environment anywhere in this project.

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

**Removal policy: `DESTROY` for Development, `RETAIN` for Staging.** Not the same decision copied
across environments — see "Staging removal/deletion policy" below for the full reasoning. Neither
policy is ever applied to Production, which isn't managed by this project at all.

`interval-staging-records` / `interval-staging-changes` — identical schema, billing mode,
encryption, streams-off, and TTL-off to Development. Same infrastructure shape; different data
sensitivity, hence the different removal policy below.

## Staging removal/deletion policy

**Decision: `RemovalPolicy.RETAIN` for Staging's DynamoDB tables and Cognito user pool, plus
Cognito deletion protection enabled — deliberately different from Development's `DESTROY`/
disabled-protection defaults, not inherited blindly.**

**Reasoning.** Development is founder-only and its data is genuinely disposable — destructive
testing is expected, and `DESTROY` correctly makes cleanup free. Staging/Beta is different in
kind, not just degree: it exists specifically for **external beta-tester validation**
(`docs/environment-separation-plan.md`), meaning real people's Cognito accounts and their synced
decks/cards/sessions can exist there before Production ever does. Two concrete risks `DESTROY`
would create for Staging that don't exist for Development:

1. **CloudFormation-driven replacement.** Certain property changes to a DynamoDB table or Cognito
   user pool force CloudFormation to replace the resource rather than update it in place. With
   `DESTROY`, a routine infrastructure change could silently delete every beta tester's account
   and data as a side effect — not a deliberate decision, just an accident of which property
   happened to change.
2. **Accidental `cdk destroy`.** A mistyped or miscontextualized destroy command against Staging
   would be unrecoverable under `DESTROY`.

`RETAIN` means the underlying table/pool survives even if its CDK-managed lifecycle ends —
orphaned, not deleted, requiring a deliberate, separate, manual deletion step to actually remove
it. That asymmetry (safe by default, an explicit extra step required to genuinely destroy real
user data) is exactly the posture an environment holding external users' data should have.
Cognito deletion protection (a separate mechanism from `RemovalPolicy` — it also blocks direct
API/console deletion, not just CloudFormation-driven removal) is enabled for the same reason,
matching the live-confirmed Production user pool's own `ACTIVE` deletion protection
(`docs/aws-current-state-audit.md`).

**What this does not change:** Development's `RemovalPolicy.DESTROY` and disabled deletion
protection are unchanged — this decision only affects Staging. If Staging is ever destroyed on
purpose (e.g. decommissioning it), the retained tables/pool require a separate, explicit AWS
console/CLI deletion afterward — this is intentional friction, not an oversight.

**Not addressed by this decision (out of scope for this mission):** point-in-time recovery (PITR)
remains off for Staging, matching Development and the live-confirmed Production shape. PITR is a
genuinely separate hardening question (recovering from a *bad write*, not preventing *resource
deletion*) — worth revisiting once Staging actually holds real beta-tester data, but not decided
here.

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

**Deletion protection: off for Development, `ACTIVE` for Staging** — see "Staging removal/deletion
policy" above for the full reasoning. `interval-staging-user-pool` otherwise matches
`interval-dev-user-pool` exactly: no client secret, same explicit auth flows, same `disableOAuth:
true`, same MFA-off/password-policy configuration.

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

`interval-staging-sync-lambda-role` follows the identical pattern, scoped to
`interval-staging-records`/`interval-staging-changes` only — it has no access to Development's
tables, Production's tables, or any other resource. Each environment's shared role can only ever
reach that same environment's own two tables.

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
- `interval-staging-sync-push`: `RECORDS_TABLE=interval-staging-records`, `CHANGES_TABLE=interval-staging-changes`
- `interval-staging-sync-pull`: `CHANGES_TABLE=interval-staging-changes`

`interval-staging-sync-push`/`interval-staging-sync-pull` package the exact same
`backend/lambdas/sync-push`/`sync-pull` source, same runtime/architecture/memory/timeout — the
only difference from Development is which table names get injected as environment variables. No
Production table name, API ID, or Cognito identifier appears in any function's environment or
anywhere else in this project.

## API Gateway / JWT authorization

`interval-dev-sync-api` — HTTP API (API Gateway v2), same two routes as Production:

- `POST /sync/push` → `interval-dev-sync-push`
- `GET /sync/pull` → `interval-dev-sync-pull`

Both routes require a Cognito JWT (`HttpJwtAuthorizer`) whose issuer is
`https://cognito-idp.us-east-2.amazonaws.com/<interval-dev-user-pool ID>` and whose audience is
the `interval-dev-mobile` app client ID — both resolved via CDK references to the Development
pool/client this same stack creates, never hardcoded. **No unauthenticated route exists.**
Integrations are `AWS_PROXY` with payload format `2.0`, matching Production.

`interval-staging-sync-api` is the identical shape, scoped entirely to
`interval-staging-user-pool`/`interval-staging-mobile` — a request bearing a Development or
Production token is rejected by Staging's authorizer, and vice versa. Each environment's API can
only ever be reached with that same environment's own tokens.

## Tagging

Every taggable resource in each stack carries that stack's own environment tag:

```
Project = Interval
Environment = development   (or "staging" in IntervalStagingStack)
ManagedBy = CDK
```

Applied per-stack via `cdk.Tags.of(this).add(...)`, not per-resource, so nothing can be added to
either stack later without inheriting the same tags. No sensitive data in any tag value.

## What CDK manages

Everything in "Development resource names" and "Staging resource names" above, and only those —
plus the minimal CloudFormation/CDK support constructs each stack needs to wire its own resources
together (the JWT authorizer, Lambda invoke permissions for API Gateway, the IAM policy attached
to the shared role, the API's default stage, and CDK's own bootstrap-version metadata resource).
Verified directly against both synthesized templates — see "Local validation" below.

## What CDK does not manage

- **Production.** Not imported, not referenced, not modeled as a stack. Continues to be managed
  exactly as it is today, outside IaC, until a separate, explicit, founder-approved decision
  changes that.
- Anything outside the 16 named resources across both stacks: no S3, no AI/transcription
  infrastructure, no Canvas integration, no notification infrastructure, no hosted-sharing
  infrastructure. All explicitly out of scope for this mission and not present anywhere in
  `infra/`.

## No permanent local AWS credentials required

This CDK project was built and fully validated (`npm install`, `tsc`, `cdk synth`) on a machine
with no intentionally-configured AWS credentials. AWS CloudShell — already authenticated as
whichever identity opens it — is the intended execution environment for the first deployment; the
procedure below never asks the founder to place a long-lived access key on any local machine, and
this repository does not do so either.

## CloudShell deployment procedure

**Followed for both stacks — Development and Staging are both live.** The founder ran this exact
procedure from AWS CloudShell first for `IntervalDevelopmentStack`, then again for
`IntervalStagingStack` with the stack name substituted throughout (steps 9/11/12 target
`IntervalStagingStack`, all other steps are identical). Kept below as the accurate record of how
both were deployed.

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

Naming the stack explicitly (rather than a bare `cdk diff`) is deliberate — now that
`IntervalStagingStack` also exists in this same CDK app, this still targets only Development.

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

## Staging deployment record

`IntervalStagingStack` followed the identical procedure above (steps 1–12, with
`IntervalStagingStack` substituted in steps 9/11/12) — deployed, `CREATE_COMPLETE`,
`interval-staging-records`/`interval-staging-changes` both `ACTIVE`, `cdk diff
IntervalStagingStack` reports no differences. Founder QA against the live Staging backend used the
same checklist as Development's (see the status block at the top of this document) and passed:
fresh Cognito account creation, sign-up/sign-in, repeated Force Resync, sync/data operations, and
cross-device (phone + simulator) consistency all confirmed working, with Production confirmed
isolated throughout.

Post-deployment verification for Staging follows the same read-only command shape as step 12
above, substituting `interval-staging-*` table/API/function names and the `IntervalStagingStack`
stack name.

## Rollback / removal

**Development** — `interval-dev-*` resources are fully disposable by design (`DESTROY` removal
policy throughout — see "DynamoDB" and "Cognito" above):

```bash
npx cdk destroy IntervalDevelopmentStack
```

This deletes the 8 named Development resources, including their data, and their CDK/
CloudFormation support constructs.

**Staging** — `interval-staging-*` DynamoDB tables and the Cognito user pool use `RETAIN` (see
"Staging removal/deletion policy" above), so `cdk destroy IntervalStagingStack` removes the stack
and its non-retained resources (Lambdas, API Gateway, IAM role) but **leaves the
`interval-staging-records`/`interval-staging-changes` tables and `interval-staging-user-pool`
behind**, orphaned from CloudFormation. Actually deleting that retained data/those identities
afterward requires a separate, explicit, manual AWS console/CLI action — this is intentional, not
a bug, given real external beta-tester data may exist there by then.

Neither command can affect Production, which this project has no reference to at all — and
neither command has been run as part of this mission.

## App config contract values

Each stack's `CfnOutput`s (`SyncApiUrl`, `UserPoolId`, `UserPoolClientId`) provide the real values
for `docs/environment-config-contract.md`'s `INTERVAL_ENV=development`/`INTERVAL_ENV=staging`
local `.env`— see that document and `docs/environment-separation-plan.md` §6 for the full
contract. Retrieve them with:

```bash
aws cloudformation describe-stacks --stack-name IntervalDevelopmentStack --region us-east-2 \
  --query "Stacks[0].Outputs"
aws cloudformation describe-stacks --stack-name IntervalStagingStack --region us-east-2 \
  --query "Stacks[0].Outputs"
```

The founder places these values directly into their local, gitignored `.env` — never into any
tracked file, and never both environments' values at once (the app reads one active `INTERVAL_ENV`
at a time; switching environments today means hand-editing `.env` and restarting Metro — see
`docs/environment-config-contract.md`'s "Current status" section for exactly which local
variables this maps to. No per-environment env files or switching scripts exist in this
repository; that remains a possible future improvement, not implemented here).
