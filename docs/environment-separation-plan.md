# Interval Environment Separation Plan

**Status: architecture and planning document. No AWS mutation has been performed as part of this
document or the batch that produced it.** This document exists to remove ambiguity about how
Interval moves from its current single shared AWS environment to a Development / Staging-Beta /
Production model, before real user source files, document uploads, AI generation, transcription,
Canvas integration, or external persistent-data testing begin — per `docs/branch-and-release-
policy.md`'s existing "Backend environments" section, which already establishes this as planned,
not implemented.

See `docs/aws-current-state-audit.md` for the read-only AWS audit this plan is based on.

## 1. Confirmed current state

### Confirmed from repository

- Single AWS environment, region `us-east-2`: one API Gateway HTTP API (`4oge9e46jf`, stage
  `prod`), two Lambda functions (`IntervalSyncPush`, `IntervalSyncPull`), two DynamoDB tables
  (`Interval_Records`, `Interval_Changes`), one Cognito user pool (`IntervalUserPool`,
  `us-east-2_UwGRm5dye`) with one app client (`IntervalMobile`, no client secret). Source:
  `CLAUDE.md`'s "AWS Resources" section.
- Lambda source (`backend/lambdas/sync-push/index.mjs`, `backend/lambdas/sync-pull/index.mjs`)
  reads `RECORDS_TABLE`/`CHANGES_TABLE` from `process.env` — **no table name is hardcoded in
  Lambda source**. This is already environment-portable in exactly the way this plan needs.
- Both Lambdas derive the authenticated user's `sub` only from trusted authorizer claims
  (`event.requestContext.authorizer.jwt.claims.sub` or the REST-API equivalent), never from
  request body or query parameters, and partition all data by `PK = U#<sub>`.
- Client configuration already flows through a real (if minimal) config pipeline: `.env`
  (gitignored) → `app.config.ts` (via `dotenv/config`, reads `process.env.EXPO_PUBLIC_*`) → Expo's
  `extra` → `src/auth/AuthConfig.ts` / `src/cloud/sync/http.ts`. No Cognito ID or API URL is
  hardcoded in application source — confirmed by direct search (two historical **comments** in
  `src/auth/nameValidation.ts` and `src/auth/passwordPolicy.ts` mention the real pool ID as
  verification notes; neither affects runtime behavior).
- No client secret exists for the Cognito app client; application source in this repository
  performs direct Cognito API calls (`ALLOW_USER_SRP_AUTH` etc. via `src/auth/AuthService.ts`), not
  a browser-redirect/Hosted-UI OAuth flow, and no callback/logout URL is referenced anywhere in
  application code. **This describes only what the repository's own code does** — the 2026-08-08
  live audit found the `IntervalMobile` app client itself also has an OAuth authorization-code flow
  and a CloudFront callback URL configured at the Cognito level, independent of whether this
  repository's code exercises it (see "Confirmed from live AWS" below).
- No Infrastructure-as-Code exists in this repository today (`CLAUDE.md`'s own listed technical
  debt). No deployment scripts exist in the repo (`scripts/` contains only `reset-project.js`,
  unrelated to AWS). No `eas.json` exists — EAS is not configured.
- Exactly one `.env`/`.env.example` pair exists; there is no per-environment `.env.*` split and no
  environment-identity variable (e.g. `INTERVAL_ENV`) anywhere today.
- `docs/branch-and-release-policy.md` already states, as an approved decision: environment
  separation is planned, not implemented; development continues privately; source upload, AI
  generation, and Canvas integration must not launch against the current single, unseparated
  environment.
- Library (`app/library/**`) is confirmed local-metadata-only: no AWS SDK import, no network call,
  no Cognito reference in runtime code anywhere under `app/library/**`, `src/models/librarySource
  .ts`, `src/storage/librarySources.ts`, `src/storage/sourceCollections.ts`. This was independently
  re-confirmed as part of this mission's static audit (see the mission's final report).

### Confirmed from live AWS

A founder-performed, read-only AWS CloudShell audit on 2026-08-08, authenticated as the correct
Interval account identity, successfully located and inspected every resource documented in
`CLAUDE.md`. Full detail lives in `docs/aws-current-state-audit.md`; summarized here:

- API Gateway API `IntervalSyncApi` (`4oge9e46jf`), stage `prod`, `AutoDeploy=true`, no stage
  variables, no tags. `GET /sync/pull` and `POST /sync/push` both confirmed live, both protected by
  a JWT authorizer (`CognitoJwtAuth`) whose issuer is the live `IntervalUserPool` and whose audience
  is `IntervalMobile` — **Cognito JWT protection on both sync routes is now independently
  confirmed, not just assumed from Lambda source.**
- Both routes proxy (`AWS_PROXY`, payload format `2.0`) to their respective Lambda functions.
- `IntervalSyncPush`/`IntervalSyncPull`: `nodejs24.x`, `arm64`, 128 MB, 3s timeout, shared execution
  role `IntervalSyncLambdaRole`. Deployed environment variable **names** (`RECORDS_TABLE`,
  `CHANGES_TABLE`) match what the repository source reads — a live-confirmed **configuration**
  match, not a source-code match (see below).
- `Interval_Records` (108 items, ~43 KB) and `Interval_Changes` (203 items, ~88 KB): both `ACTIVE`,
  `PAY_PER_REQUEST`, streams/PITR/TTL all disabled. Item counts are infrastructure metadata only —
  no item was read. **This confirms the environment currently holds real, non-trivial persisted
  data**, not an empty/unused table.
- `IntervalUserPool` (`us-east-2_UwGRm5dye`): MFA off, deletion protection **ACTIVE**, a
  length-8-plus-all-character-classes password policy, email-then-phone account recovery.
- `IntervalMobile` app client: no client secret, `COGNITO`-only identity provider, the four
  expected explicit auth flows, **and** an OAuth authorization-code flow enabled (scopes `email`/
  `openid`/`phone`) with one live CloudFront callback URL configured — a detail not previously
  documented in the repository. Whether this OAuth path is actively used by the shipped app is
  unresolved (see below).

### Unverified / requires follow-up

Narrowed by the 2026-08-08 audit, not eliminated:

- **Deployed Lambda source code, byte-for-byte, versus `backend/lambdas/**`.** The audit confirmed
  matching *configuration* (env var names, runtime, role) — it did not compare deployed code
  against repository source. **Do not infer source parity from configuration parity.** This remains
  exactly as unverified as `CLAUDE.md` already states.
- Whether the confirmed OAuth authorization-code flow / CloudFront callback URL is actively used by
  any shipped part of the app, or reserved/unused.
- DynamoDB encryption key management detail beyond "no customer-managed SSE configuration
  confirmed" — this is **not** evidence the tables are unencrypted (AWS-owned-key encryption is the
  default), just that a customer-managed key was not confirmed.
- Exact IAM policy attached to `IntervalSyncLambdaRole` (the role name is now known; its policy
  content was not reproduced into repository documentation).
- Whether any additional, undocumented staging/dev resource exists elsewhere in the account — this
  audit targeted the documented resource names specifically, not an unbounded account scan.

## 2. Current risks of continuing with one environment

These are risks of the *status quo continuing* once external persistent-data features begin — not
claims that any incident has occurred:

- **Destructive developer testing against real user data.** Any future manual testing of
  delete/reset/migration logic against the current single backend risks touching real signed-in
  users' synced decks/cards, since there is no separate backend to test against instead.
- **Schema/data migration risk.** A future DynamoDB key-schema or item-shape change (e.g. for
  Library cloud records) has no safe environment to validate against before it touches the only
  existing table.
- **Lambda deployment regression.** Every future Lambda deployment is a direct-to-production
  change with no intermediate environment to catch a regression first.
- **Sync incompatibility.** A future client/server sync-protocol change (see `docs/sync-invariants
  .md`) has nowhere to be validated end-to-end except against the one real backend.
- **Accidental test-account contamination.** Founder or future collaborator test accounts share
  the same Cognito pool and DynamoDB partition space as any real user, with no structural
  separation.
- **Document-upload contamination.** Once Library source upload exists, test uploads would have
  nowhere to go except the same storage a real user's material would eventually use.
- **Transcription/AI cost contamination.** Test transcription or AI-generation calls would incur
  the same real, metered cost as genuine user usage, with no way to separate test spend from real
  spend.
- **Inability to test data lifecycle safely.** Deletion, retention, and purge logic (see `docs/
  library-and-source-architecture.md` §11's deletion lifecycle) has no safe environment to exercise
  destructively before it's trusted against real data.
- **Accidental notification/Canvas testing against real users.** A future Canvas companion or
  notification system, if ever tested against the current single environment, could not be
  isolated from real users' Canvas connections or notification preferences.
- **Difficult rollback.** Because there is no separate environment and no IaC, there is no
  systematic way to know what a "last known good" backend configuration was, beyond git history of
  `backend/lambdas/**` source (which, per the unverified item above, may not even match what's
  deployed).
- **Unclear logs/metrics across test vs. real traffic.** CloudWatch logs and any future metrics are
  not currently separable between founder testing and genuine user activity.

## 3. Approved environment model

Three future environments, each fully separate at the data layer:

**Development** — founder development, destructive testing, schema experiments, local/simulator
builds, temporary test data, future upload/extraction/AI experimentation.

**Staging / Beta** — trusted-tester validation, release-candidate backend, realistic
persistent-data QA, final migration verification, external beta users before Production.

**Production** — durable public user data, public releases, strictest change control, no
experimental or destructive testing.

**Separation principle:** each environment owns its own API Gateway, Lambda functions, DynamoDB
tables, Cognito resources (see §10 for the tradeoff this involves), future S3 buckets, future
extraction queues/state machines, future AI/transcription configuration, log groups/metrics,
alarms, secrets/config, and environment-specific identifiers. **No environment shares a mutable
user-data store with another.** A Development experiment must be structurally incapable of writing
to a Production table, bucket, or user pool — not merely discouraged by convention.

## 4. Resource naming standard

**Recommended convention: lowercase, hyphenated, `interval-<env>-<resource>`** — e.g.
`interval-dev-sync-push`, `interval-staging-user-pool`, `interval-prod-records`.

Justification:
- Matches AWS's own near-universal lowercase-hyphenated convention for most resource-naming APIs
  (S3 bucket names in particular *require* lowercase), so one convention works everywhere instead
  of switching case per service.
- The current production resources use `Interval`-prefixed PascalCase (`IntervalSyncPush`,
  `IntervalUserPool`) — not renamed by this plan (see §5; renaming a live resource is a mutation
  this plan explicitly does not perform), but the lowercase-hyphenated form for *new* environments
  is still clearly recognizable as the same product family, and going forward is more consistent
  with AWS tooling than continuing PascalCase into contexts (like S3) that don't allow it.
- Environment name as an explicit path segment (not a suffix or prefix trick) makes every resource
  name self-describing and trivially `grep`-able/filterable in the console, CLI, and any future
  IaC state.

Examples for each resource class:

| Resource class | Development | Staging | Production |
|---|---|---|---|
| Cognito user pool | `interval-dev-user-pool` | `interval-staging-user-pool` | `interval-prod-user-pool` (or the existing `IntervalUserPool`, see §5) |
| Cognito app client | `interval-dev-mobile` | `interval-staging-mobile` | `interval-prod-mobile` (or existing `IntervalMobile`) |
| API Gateway API | `interval-dev-api` | `interval-staging-api` | `interval-prod-api` (or the existing `IntervalSyncApi`, see §5) |
| Lambda: sync push | `interval-dev-sync-push` | `interval-staging-sync-push` | `interval-prod-sync-push` (or existing `IntervalSyncPush`) |
| Lambda: sync pull | `interval-dev-sync-pull` | `interval-staging-sync-pull` | `interval-prod-sync-pull` (or existing `IntervalSyncPull`) |
| DynamoDB: records | `interval-dev-records` | `interval-staging-records` | `interval-prod-records` (or existing `Interval_Records`) |
| DynamoDB: changes | `interval-dev-changes` | `interval-staging-changes` | `interval-prod-changes` (or existing `Interval_Changes`) |
| Future S3: source binaries | `interval-dev-sources` | `interval-staging-sources` | `interval-prod-sources` |
| IAM role: sync Lambda execution | `interval-dev-sync-lambda-role` | `interval-staging-sync-lambda-role` | `interval-prod-sync-lambda-role` (or existing `IntervalSyncLambdaRole`) |
| Log group | `/interval/dev/sync-push` | `/interval/staging/sync-push` | `/interval/prod/sync-push` |
| Future queue | `interval-dev-extraction-queue` | `interval-staging-extraction-queue` | `interval-prod-extraction-queue` |
| Future state machine | `interval-dev-extraction-workflow` | `interval-staging-extraction-workflow` | `interval-prod-extraction-workflow` |
| Future secret/parameter | `/interval/dev/...` | `/interval/staging/...` | `/interval/prod/...` |

**This plan does not rename any existing production resource.** Where Production maps to the
existing environment (see §5's recommendation), its resources keep their current names; the naming
standard applies fully to newly-created Development and Staging resources, and to Production only
if/when a founder-approved future migration actually recreates it.

## 5. What the existing environment becomes

**Options considered:**

**Option A — treat the existing environment as future Production; build Development and Staging
separately.** Lowest migration risk: zero changes to the resource real users (if any) already
depend on. New Development/Staging environments are built fresh, matching the naming standard from
day one. Existing Cognito accounts and any real synced data stay exactly where they are.

**Option B — treat the existing environment as Development; create fresh Staging and Production
later.** Requires eventually migrating any existing real user data and Cognito accounts to a new
Production pool/tables — real migration risk and real user-facing disruption (password
resets/re-auth at minimum, given Cognito pools can't be renamed or merged) for no clear benefit,
*unless* the existing environment is confirmed to hold no real user data worth preserving.

**Option C — create all three new environments and migrate away from current resources
entirely.** Highest short-term work and highest migration risk; only justified if the existing
environment's naming/configuration is judged unsalvageable for Production use, which nothing in
this audit suggests.

**Founder-approved (2026-08-08): Option A.** The existing
`IntervalSyncApi`/`IntervalSyncPush`/`IntervalSyncPull`/`Interval_Records`/`Interval_Changes`/
`IntervalUserPool`/`IntervalMobile`/`IntervalSyncLambdaRole` stack is the **Production baseline**,
unchanged in place, and Development (and later Staging) are built as genuinely new, separate
resources following the naming standard in §4. The 2026-08-08 live audit removed the previous
uncertainty this decision was made under: `Interval_Records` and `Interval_Changes` hold real,
non-trivial persisted data (108 and 203 items respectively, treated as potentially important
Production-line data — see §17) under live Cognito JWT protection — this is an actively-used
environment, not an idle placeholder, which only strengthens the case for leaving it in place rather
than migrating away from it. Option A is the only choice that requires zero migration of whatever
accounts/data already exist there, and none is performed by this plan. See §17 for the full record
of this and every other founder-approved decision.

**"Production baseline" is a deliberately different claim from "fully production-hardened."**
Adopting this environment as Production under the new model means it becomes the environment
subject to the strictest change-control rules in §15 going forward — it does **not** mean every
aspect of its current configuration is already optimal. See `docs/aws-current-state-audit.md`'s
"Production-hardening observations" table for the full, classified list (acceptable-as-is,
hardening candidate, deliberate design, or unresolved) — summarized: JWT auth and Cognito deletion
protection are already real, positive safety controls; `PAY_PER_REQUEST` billing is already
sensible for current volume; PITR being disabled and the stage's `AutoDeploy=true` are the two
clearest hardening candidates to revisit before this environment carries materially more weight
(e.g. a larger user base, or Library source records) — neither blocks adopting it as the Production
baseline today. Founder-approved framing (§17): this environment is the Production baseline *now*,
and becomes the formally hardened/authoritative Production environment once environment separation,
deployment controls, backup/hardening, and promotion validation (STEP 1–9 below) are actually
completed — not automatically by virtue of being designated the baseline today.

Grandfathered names: this plan does **not** rename `IntervalSyncApi`, `IntervalSyncPush`,
`IntervalSyncPull`, `Interval_Records`, `Interval_Changes`, `IntervalUserPool`, `IntervalMobile`, or
`IntervalSyncLambdaRole` — all eight are confirmed-live resource names that stay exactly as they
are. §4's `interval-<env>-*` naming convention applies fully to new Development/Staging resources,
and to any *new* Production resource created going forward (e.g. a future Library S3 bucket) —
never as a reason to rename something that already exists and works.

## 6. Client environment configuration design

**Status: implemented.** See `docs/environment-config-contract.md` for the full, current contract
— `src/config/environmentValidation.ts` and `src/config/environment.ts` now centralize this,
`app.config.ts` exposes `intervalEnv` alongside the existing four `extra` values, and
`src/auth/AuthConfig.ts`/`src/cloud/sync/http.ts` both consume the centralized module rather than
reading `Constants.expoConfig.extra` directly. What follows is retained as the original design
rationale, now realized rather than merely proposed.

**Build on the existing pipeline rather than replacing it.** The current `.env` → `app.config.ts`
(`dotenv/config` + `process.env.EXPO_PUBLIC_*`) → Expo `extra` → `AuthConfig.ts`/`http.ts` pattern
already did exactly what environment configuration needed — inject build-time values without
hardcoding them in source. The smallest safe extension was one new variable plus one new value per
existing variable, not a new mechanism.

**Contract** (names chosen to match the existing `EXPO_PUBLIC_COGNITO_*` convention already in
`.env.example`, not invented fresh):

```
INTERVAL_ENV=development | staging | production
EXPO_PUBLIC_API_BASE_URL=<per-environment API Gateway base URL>
EXPO_PUBLIC_COGNITO_REGION=us-east-2
EXPO_PUBLIC_COGNITO_USER_POOL_ID=<per-environment pool ID>
EXPO_PUBLIC_COGNITO_APP_CLIENT_ID=<per-environment client ID>
```

`INTERVAL_ENV` deliberately has **no** `EXPO_PUBLIC_` prefix requirement question to resolve: it is
not a secret, so it's safe to expose, but unlike the others it's consumed only to *select* which of
the other values apply and to label diagnostics/logs — it can be read the same way the existing
`extra.*` values are (via `app.config.ts` → Expo `extra`), following the same pattern as the four
values already in place.

**Per-environment values:**
- **Development** — points at the new `interval-dev-*` API/pool/client once those exist; safe
  default for local simulator/device work; never the production URL.
- **Staging** — points at `interval-staging-*` once it exists; used for EAS-style internal/beta
  builds when those are introduced.
- **Production** — points at the existing (per §5) `4oge9e46jf` API and `IntervalUserPool`/
  `IntervalMobile` Cognito resources — i.e., **today's values become tomorrow's Production
  values**, not new ones.

**Public identifiers vs. secrets:** every value in the contract above is a public build-time
identifier, not a secret — a Cognito pool ID, app client ID (no client secret exists), region, API
base URL, and environment name are all safe to embed in a client build and are already treated
that way today. Nothing in this contract introduces a value that needs server-only secret handling
(see §12 for what *would* need that, once it exists).

**Safety requirements this design satisfies:**
- No hardcoded deployment URL in source — unchanged from today, still fully config-driven.
- No secret in client code — nothing in this contract is a secret.
- Explicit environment identity — `INTERVAL_ENV` makes "which backend am I talking to" a checkable
  fact, not an inference from a URL string.
- Safe defaults — `.env.example` should default to Development-shaped placeholders (as it already
  does with placeholder Cognito values), never real Production identifiers.
- Hard to accidentally ship Development in Production — this depends on the build process no
  longer defaulting to whatever `.env` happens to be present at build time once EAS build profiles
  are introduced (see below); until then, the existing single-`.env` model is the same one-
  environment reality that exists today, so this risk is not *new*, it's just documented as
  something a future EAS-profile step must close.
- Supports local simulator/device dev, staging beta builds, and production builds — via three
  different `.env` value sets (or, once EAS is introduced, three build profiles).
- Preserves offline guest behavior and legacy local storage keys — this contract touches only
  *cloud* configuration; it says nothing about, and does not need to change, `src/storage/keys.ts`
  or any local storage key.
- **Environment selection must not split local guest decks.** `WorkspaceScope` (`src/storage/
  workspaceScope.ts`) already partitions local storage by `guest` vs. `user:<sub>` — never by
  backend URL or environment. This plan does not change that, and explicitly recommends against
  ever keying local storage by `INTERVAL_ENV`: a guest's offline decks must look identical to the
  app regardless of which backend the app happens to be configured to sync against once signed in.

**Where the values live:**
- **Local development:** `.env` (gitignored, already the case), one value set at a time — a
  developer switches environments today by editing `.env` locally, which remains the simplest
  correct answer until EAS build profiles exist to formalize it further.
- **CI-injected configuration:** not applicable yet — no CI exists in this repository (no `.github/
  workflows`). This plan does not invent CI.
- **EAS build profiles:** **not recommended to introduce yet.** There is no `eas.json` in this
  repository today, and `CLAUDE.md`'s own "Legacy Briefly identifiers" section already flags that
  the Expo `slug` is deliberately preserved *because* EAS project linkage status is unconfirmed.
  Introducing EAS profiles now, before that's resolved with the founder, risks exactly the silent
  disconnection `CLAUDE.md` already warns about. Once EAS status is confirmed, build profiles
  (`development`/`preview`/`production`) are the natural next step for making "hard to accidentally
  ship the wrong backend" a build-system guarantee rather than a manual `.env`-editing discipline —
  but that is future work, not this batch's.

## 7. Backend configuration contract

Lambda source should — and per the current source, **already does** — remain identical across
environments. Confirmed by direct inspection of `backend/lambdas/sync-push/index.mjs` and
`sync-pull/index.mjs`: neither hardcodes a table name, region, account ID, or API ID anywhere. Both
read `RECORDS_TABLE`/`CHANGES_TABLE` from `process.env` and fail closed (a sanitized `500`, not a
crash or a silent wrong-table write) if either is missing. **This is exactly the shape environment-
portable Lambda source needs to have, and no source change is required to achieve it** — this
mission found no blocker here.

**Documented variable set** (current + anticipated future):

| Variable | Purpose | Status |
|---|---|---|
| `RECORDS_TABLE` | DynamoDB table name for record snapshots | exists today |
| `CHANGES_TABLE` | DynamoDB table name for the change log | exists today |
| `ENVIRONMENT` | `development` / `staging` / `production` — for log/metric labeling only, never for branching logic | recommended addition, not yet implemented |
| future `SOURCE_METADATA_TABLE` | once a cloud Library record exists (see `docs/library-and-source-architecture.md` §18) | not implemented |
| future `SOURCE_BUCKET` | binary storage bucket name, once Library upload exists | not implemented |
| future `EXTRACTION_QUEUE_URL` | once document extraction exists | not implemented |
| future `AI_PROVIDER_CONFIG_REF` | a reference to a secret/parameter, never the credential itself, once AI generation exists | not implemented |

**No environment-specific hardcoded resource name inside Lambda source, and no separate branch per
AWS environment** — both already true today and both must remain true as this variable set grows.
`ENVIRONMENT` itself should be used only for labeling (log lines, metric dimensions), never as an
`if (ENVIRONMENT === "production")` branch — a Lambda that behaves differently per environment
defeats the entire point of promoting identical code between them (see §9).

## 8. Infrastructure as Code decision

Compared:

- **AWS CDK** — TypeScript-native (matches this team's existing, demonstrated language), models
  Lambda/API Gateway/DynamoDB/Cognito/S3 with high-level constructs, synthesizes to CloudFormation
  (so it inherits CloudFormation's drift detection and rollback semantics rather than inventing its
  own state model), and scales cleanly to "one stack per environment" via CDK's own environment/
  context model — a very close conceptual match for exactly the Dev/Staging/Prod separation this
  plan defines.
- **AWS SAM** — simpler and Lambda/API-Gateway-focused, but weaker for DynamoDB/Cognito/S3/future
  state-machine modeling as the architecture grows past pure serverless-API shape: less natural
  fit for the Library roadmap's eventual queues/extraction workflows.
- **Raw CloudFormation** — the most portable and "no framework" option, but materially more
  verbose for this resource mix, and offers none of CDK's type-checking or reusable-construct
  benefit for a small team that will be hand-writing every resource once per environment.
- **Terraform** — mature, cloud-agnostic, large ecosystem — but introduces a second language
  (HCL) and a second state-management model (Terraform state, not CloudFormation) into a
  TypeScript-first, AWS-only project with no multi-cloud need in sight. The main advantage
  (cloud-agnosticism) isn't a real requirement here.

**Founder-approved (2026-08-08): AWS CDK, in TypeScript.** It matches the team's existing language (this is a
TypeScript/Expo codebase already), synthesizes to CloudFormation (giving real drift detection and
a well-understood rollback model without adopting a second state system), and its construct model
maps naturally onto "the same stack shape, instantiated three times with different environment
context" — exactly what §3's separation principle and §9's promotion model need. Learning curve is
real but bounded (it's still just TypeScript plus AWS-shaped constructs), and operational overhead
is low relative to hand-managing three environments' worth of console-clicked resources, which is
the actual current state's real cost today.

**No concrete blocker to this decision was found in the 2026-08-08 live audit.** Every
resource type this plan needs to model (HTTP API with JWT authorizer, `AWS_PROXY` Lambda
integrations, DynamoDB tables, a Cognito user pool and app client) is a well-supported, standard
CDK L2 construct — nothing observed live (payload format 2.0, `PAY_PER_REQUEST` billing, the
existing JWT authorizer shape, arm64 Lambda architecture) requires a construct CDK doesn't already
support cleanly.

**This mission does not implement the CDK stack.** Per the mission's explicit scope, only a
documentation-level decision is recorded here — no framework dependency is added to `package
.json`, and no synthesized/scaffolded CDK project is created. The next implementation batch (Phase
C, §16) is the right place to create `infrastructure/README.md` and the actual CDK app, now that
this decision is founder-approved rather than merely recommended.

## 9. Environment promotion model

```
feature development
  → Development backend (founder destructive testing, schema experiments)
  → founder QA
  → Staging/Beta deployment (same Lambda source, Staging configuration)
  → trusted tester QA
  → release candidate
  → Production deployment (same Lambda source, Production configuration)
```

- **Application code promotion:** the existing Git branch model already supports this —
  `v3.1-dev` (or its eventual successor) is where app code is developed; promoting to Staging/
  Production builds means building the *same* commit against different `EXPO_PUBLIC_*`/
  `INTERVAL_ENV` values (§6), never a code fork per environment.
- **Backend code promotion:** the *same* `backend/lambdas/**` source is deployed to each
  environment's Lambda functions, with only the environment's own `RECORDS_TABLE`/`CHANGES_TABLE`/
  `ENVIRONMENT` values differing (§7) — never a modified copy of the source per environment.
- **Infrastructure promotion:** once IaC exists (§8), the same CDK app is synthesized/deployed
  once per environment, with environment-specific context/parameters, not three hand-maintained
  copies of the resource definitions.
- **Database migration promotion:** any future schema change is validated in Development first,
  then Staging, then Production — never authored directly against Production.
- **Configuration promotion:** environment-specific values (table names, pool IDs, bucket names)
  live in each environment's own configuration (Lambda environment variables, CDK context, or a
  future secrets/parameter store — see §12), never hardcoded per environment inside promoted code.

**Required, going forward:** the same Lambda source promoted between environments; environment-
specific configuration injected separately; no manual copy/paste edits inside the deployed Lambda
console as the long-term workflow (acceptable only as today's *current*, pre-IaC reality — not the
target state); Production changes originate from reviewed repository state, not console edits;
migrations are explicit and reversible where feasible.

**No claim is made that CI/CD exists today.** It does not (no `.github/workflows` directory exists
in this repository). This promotion model describes the target *process*, achievable manually today
and ready to be automated once IaC (§8) exists — it is not a claim that automation already exists.

## 10. Data and identity separation

### DynamoDB

- Unique tables per environment — `interval-dev-records`/`interval-dev-changes`,
  `interval-staging-records`/`interval-staging-changes`, and Production's existing `Interval_
  Records`/`Interval_Changes` (per §5's Option A) — confirmed live (2026-08-08) as `ACTIVE`,
  `PAY_PER_REQUEST`, holding non-trivial real data (108 and 203 items respectively), with point-in-
  time recovery, TTL, and streams all currently disabled. Disabled PITR is the clearer hardening
  candidate here for a table now designated Production; see `docs/aws-current-state-audit.md`'s
  hardening table.
- No shared user records between environments, ever.
- No cross-environment sync cursor — a Development device's cursor is meaningless against Staging
  or Production's change log and must never be applied there.
- No Production table used for development testing, under any circumstance.

### Cognito

**Founder-approved (2026-08-08): separate user pools per environment.** Development gets its own
Cognito user pool/client; Staging/Beta gets its own Cognito user pool/client; the existing
`IntervalUserPool` (`us-east-2_UwGRm5dye`) / `IntervalMobile` remain Production, unchanged. **No
automatic identity migration** of existing accounts in this phase — a Development pool and a
Staging/Beta pool are created new, alongside the existing pool, not derived from it.

**Confirmed live (2026-08-08):** `IntervalUserPool` has MFA off and deletion protection `ACTIVE`,
with a password policy requiring minimum length 8 plus upper/lower/number/symbol. Deletion
protection is a positive, already-real safety control against accidental pool deletion. MFA being
off is documented here as the current state, not treated as an automatic defect — it is a product
decision about consumer mobile auth friction that may be revisited later, not a gap this plan
resolves.

**Tradeoff, stated plainly:** separate pools are structurally safer (a Development test account can
never accidentally authenticate against Production data, by construction) but require founder and
any testers to maintain separate test identities per environment — a real, ongoing inconvenience,
not a free safety win. Given this project's current single-founder-plus-small-tester-population
scale (per `docs/branch-and-release-policy.md`'s "development continues privately" framing), that
inconvenience is judged worth it: the alternative (one shared pool across environments) makes
"Development testing can never touch a real Production account" an unenforced convention rather
than a structural guarantee, which is exactly the kind of risk §2 already lists.

### Future Library

Once cloud Library records exist: separate source metadata per environment, separate binaries per
environment (§11 below), separate transcription/extraction processing per environment, separate
deletion lifecycle per environment, and — explicitly — no Staging access to Production source
documents under any circumstance, matching the same "no cross-environment mutable store" principle
as DynamoDB above. See `docs/library-cloud-sync-contract.md` for the full metadata-sync
specification (revision/conflict model, ownership, tombstones) a future implementation must
satisfy — that document covers metadata only, distinct from this section's binary/S3 concerns.

## 11. Future S3 / Library environment rules

**S3 is not implemented anywhere in this repository today.** These are rules for whenever it is,
not a description of anything that exists now.

Each environment must eventually have its own source-binary bucket, extracted-content storage, and
derived-preview storage if that's ever used — never a shared bucket across environments.

Required, for every future bucket regardless of environment:
- No public bucket, ever — Block Public Access enabled at the bucket level.
- An environment tag on every bucket, matching the naming standard in §4.
- Encryption at rest.
- User-scope authorization on every object access (the same per-user ownership model already
  established in DynamoDB via `PK = U#<sub>`, applied to object keys/prefixes).
- Lifecycle rules (retention, eventual purge per `docs/library-and-source-architecture.md` §11's
  deletion lifecycle) considered and decided separately, once that phase is actually planned — not
  invented speculatively here.
- No cross-environment object reuse by default — a Development test file must never land in
  Staging or Production storage, and a Staging test file must never land in Production storage.

## 12. Secrets and public-config classification

| | Examples | Rule |
|---|---|---|
| **Public build config** | Region, API base URL, Cognito user pool ID, Cognito app client ID (no secret exists), environment name (`INTERVAL_ENV`) | May be embedded in client builds via `EXPO_PUBLIC_*` (or `extra`, for `INTERVAL_ENV`) when appropriate — this is already how today's four values work. |
| **Server-only secret / sensitive config** | Future AI provider API keys, future transcription provider credentials, signing secrets, future webhook secrets, any private service credential | Must **never** use an `EXPO_PUBLIC_*` variable (that prefix means "embedded in the client bundle," which is the opposite of secret). Must never be committed to this repository, in any file, including `.env` (already gitignored) or any doc. Must be read only by backend/Lambda code, from a proper AWS secret/config mechanism. |

**This plan does not choose a final secret-management implementation.** AWS Secrets Manager and
SSM Parameter Store (SecureString) are both plausible, standard choices once a real secret actually
exists to store (there is none yet — no AI, transcription, or Canvas credential exists in this
codebase today) — picking between them now, with no concrete secret to size the requirement
against, would be a decision made without evidence, which this mission's own instructions caution
against.

## 13. Cost-aware environment design

Interval is self-funded. Principles for environment separation specifically (not a general cost
audit):

- Keep idle Development and Staging inexpensive — both should be built on the same serverless,
  pay-per-use primitives already in use today (API Gateway HTTP API, Lambda, DynamoDB on-demand),
  which cost effectively nothing when idle.
- Avoid always-on compute without a demonstrated need — nothing in Interval's current or planned
  architecture needs a persistently-running server; don't introduce one for Development/Staging
  just because they're "lesser" environments.
- Avoid duplicating expensive AI/transcription infrastructure across environments where
  configuration alone (e.g. a lower quota, a cheaper model tier) can serve the same safety purpose
  — once those services exist, which they don't yet.
- Logs will need a retention policy eventually, and Development's can reasonably be shorter than
  Production's — a specific number of days is not decided here (no evidence yet to size it
  against).
- Staging does not need Production-scale capacity; on-demand DynamoDB and standard Lambda concurrency
  limits are sufficient unless a specific future load test says otherwise.
- **Environment separation is a safety measure, not permission to triple every possible service
  blindly.** Three environments should mean three *safe* copies of the minimum resource set each
  actually needs — not three maximally-provisioned copies of everything.

No invented dollar figures are provided here — this repository and audit have no cost data to
ground an estimate in, and the mission's own instructions caution against fabricating one.

## 14. Observability boundary

Future requirements, not yet implemented:

- Logs clearly identifiable by environment — the `ENVIRONMENT` variable (§7) should appear in every
  log line or log group name (e.g. `/interval/<env>/sync-push`, per §4's naming standard).
- Metrics identifiable by environment, via the same dimension.
- Alarms separated by environment — a Development Lambda error spike must never page anyone as if
  it were a Production incident.
- **No study content in logs, no source file content in logs.** This is not a new rule — it's
  already the standard both Lambdas meet today (`console.log` calls only ever log a truncated `sub`
  prefix or an error's `.name`/class, never a raw error, response body, or record content) and it
  must continue to hold as new environments and new features are added.
- Safe, stable error codes only — matching the existing pattern in `src/cloud/sync/http.ts`'s
  `getSyncDiagnosticCode()` (a fixed string or `Http###` code, never a raw message).
- No JWT/token logging, ever, in any environment — including Development. A Development log is not
  a lower-stakes place to leak a real token; **it must never contain one in the first place.**

No alarms are provisioned by this document.

## 15. Production change guardrails

Mandatory rules for any *future* Production AWS mutation (this mission performs none):

1. Explicit founder approval, obtained before the mutation, not inferred from a prior general
   approval.
2. The exact resource and exact environment must be named before any mutation command runs — never
   inferred from context or assumed from "whatever the CLI happens to be pointed at."
3. The pre-change Git commit must be identified, so the "known state before this change" is a
   checkable fact.
4. A backup/rollback strategy must be stated before the mutation, not improvised after something
   goes wrong.
5. No wildcard destructive command (e.g. a delete/update matching a pattern rather than one named
   resource).
6. No Production command inferred from context — if it's ambiguous which environment a command
   targets, stop and ask, never guess toward the more powerful/risky target.
7. Read-only verification before any write — confirm current state matches expectation first.
8. Post-change verification — confirm the mutation had exactly its intended effect, nothing more.
9. Any data-shape-changing migration must be documented, in this repository, before it's applied.
10. No Development shortcut (a quick fix, a relaxed check, a debug flag) is ever copied into
    Production silently — every Production change is deliberate and reviewed on its own terms.

**Recommended (not required) visible convention:** a distinct terminal prompt color/label per AWS
profile (many shells and AWS CLI credential-process setups support this) as a human error-reduction
aid — but this plan does not depend on shell customization for safety; the rules above must hold
regardless of what the terminal looks like.

## 16. Implementation sequence

**Mission-requested next sequence (Phase A–I):** the founder's 2026-08-08 continuation request
frames the next work as nine lettered phases. They map onto the STEP 1–10 sequence below as
follows, presented at that coarser granularity per the founder's own framing; STEP 1–10 remains the
more granular, per-resource elaboration of the same flow, not a competing plan:

- **Phase A — Commit the completed environment architecture/audit documentation.** Not one of the
  STEPs below. The founder reviewed and approved this plan's architecture decisions on 2026-08-08
  (§17); this document's commit (per that approval) is Phase A.
- **Phase B — Repository environment configuration contract** → STEP 2.
- **Phase C — AWS CDK TypeScript infrastructure foundation** → STEP 3.
- **Phase D — Model/create Development resources first** → STEP 5: a freshly-created, isolated
  Development environment. Importing the *existing* Production resources into IaC is deferred to
  Phase H below, so Development can be stood up without touching anything live.
- **Phase E — Run the existing authenticated sync flow end-to-end against Development** → STEP 6.
- **Phase F — Create Staging/Beta** → STEP 7.
- **Phase G — Validate the promotion process** → STEP 8.
- **Phase H — Harden/declare the existing Production baseline** → STEP 4 (bringing the existing
  resources under IaC management, non-destructively) together with STEP 9 (tagging/observability
  additions), performed once Development and Staging are already proven safe.
- **Phase I — Only then begin secure Library file upload** → STEP 10.

**Phase B is implemented** (client/repository environment config contract — see
`docs/environment-config-contract.md`). **Phase C is implemented** (AWS CDK TypeScript foundation,
`infra/`, see `docs/cdk-infrastructure.md`). **Phase D is complete** — `IntervalDevelopmentStack`
is deployed and verified live (`CREATE_COMPLETE`; `interval-dev-records`/`interval-dev-changes`
both `ACTIVE`). **Phase E is complete** — founder QA confirmed the existing sync protocol
end-to-end against Development: fresh Development Cognito account creation, authentication, and
repeated sync (including deck/card creation) all verified working, the same account confirmed
working across both a physical phone and the simulator, Production confirmed isolated and
untouched throughout. **Phase F is complete** — `IntervalStagingStack` was deployed via the
identical CloudShell procedure (`CREATE_COMPLETE`; `interval-staging-records`/
`interval-staging-changes` both `ACTIVE`) and passed the same founder-QA checklist as Development
(fresh Staging Cognito account, sign-up/sign-in, repeated Force Resync, sync/data operations,
phone + simulator consistency), with Production confirmed isolated and untouched throughout.
**The three-environment separation milestone (Phases A–F) is now complete.** Phase G through
Phase I have not begun — no promotion-process validation yet, no Production mutation/import.
Remaining hardening intentionally deferred, not part of this milestone: DynamoDB PITR stays off
in all three environments (a separate future decision); the CDK `pointInTimeRecovery` API used
here is deprecated in favor of `pointInTimeRecoverySpecification` (a synth-time warning, not a
functional issue); Production remains unmanaged by CDK, by design.

**STEP 1 — Confirm current AWS state and choose what existing resources become.**
**Status: complete.** Live evidence was obtained via the 2026-08-08 CloudShell audit (the
2026-08-07 attempt's credential did not resolve to the account), and the founder approved Option A
and every other architecture decision in §17 on 2026-08-08. Resource classes affected: all
(read-only). AWS mutations: **none**. Exit criteria: `docs/aws-current-state-audit.md`'s "Known
unknowns" section reflects real, live data — **done**; remaining unknowns are narrowed to
source-code parity and IAM policy detail (see that document's "Source-vs-deployed verification
status" and "Known unknowns" sections) plus the OAuth-callback-usage item in §17, none of which
block proceeding to Phase B.

**STEP 2 — Introduce the repository environment configuration contract.**
**Status: complete.** `INTERVAL_ENV` was added to `.env.example` and `app.config.ts`, following
§6, reviewed, and committed. Resource classes affected: none (client repository code only). Risk:
low — purely additive; existing `EXPO_PUBLIC_*` variables were not renamed. Manual QA: the founder
added `INTERVAL_ENV=production` to their local `.env` and confirmed the app builds and syncs
against the existing Production backend unchanged — see `docs/environment-config-contract.md`.
AWS mutations: none. The founder's local `.env` is now being updated again, to
`INTERVAL_ENV=development` plus the deployed Development values, as part of Phase E (STEP 6).

**STEP 3 — Introduce the IaC foundation.**
**Status: complete.** The CDK app (§8) exists at `infra/` (AWS CDK v2, TypeScript), isolated from
the mobile app's own dependency graph. Resource classes affected: none live at the time this step
completed; a new `infra/` directory and its dependencies. Manual QA: `cdk synth
IntervalDevelopmentStack` produces valid CloudFormation locally, verified Production-isolated (no
Production resource name, ARN, or account ID present in the synthesized template). AWS mutations
during this step: none. See `docs/cdk-infrastructure.md` for the full architecture.

**STEP 4 — Import/model existing resources in IaC, or recreate carefully, per the approved
strategy.**
Objective: bring the existing Production resources under IaC management (via `cdk import` or
equivalent) without recreating them, consistent with Option A. Resource classes affected: existing
API Gateway/Lambda/DynamoDB/Cognito resources, brought under management, not recreated. Prerequisites:
Step 3. Founder decision required: explicit approval before any import operation touches real
resources, even non-destructively. Risk: medium — import operations are usually safe but touch real
resource metadata; must be tested against Development-shaped dummy resources first if possible. Rollback:
IaC import operations are generally reversible (the resource itself is untouched, only its
management state changes) but this must be verified for each resource type before relying on it.
Manual QA: confirm the app is completely unaffected after import. AWS mutations: **yes, but
management-state-only, no resource recreation** — requires explicit founder approval per §15's
guardrails.

**STEP 5 — Create the Development environment.**
**Status: complete.** `IntervalDevelopmentStack` is deployed to `us-east-2` — CloudFormation
status `CREATE_COMPLETE`, `interval-dev-records` and `interval-dev-changes` both confirmed
`ACTIVE`, `cdk diff IntervalDevelopmentStack` reports no differences. Resource classes affected:
new API Gateway, 2 Lambdas, 2 DynamoDB tables, Cognito pool/client, 1 shared IAM role — all new,
all Development-only (see "Exact eight Development resource names" in
`docs/cdk-infrastructure.md`). Actually deployed without needing STEP 4 first (importing
Production into IaC) — Phase D's own note above already anticipated this: Development was stood
up as genuinely new resources, with Production import deferred to Phase H. Rollback: `cdk destroy
IntervalDevelopmentStack` (fully disposable — `DESTROY` removal policy throughout). AWS mutations:
resource creation — performed with explicit founder approval, from AWS CloudShell, not from any
local machine.

**STEP 6 — Validate sync end-to-end against Development.**
**Status: complete.** Founder QA against the live Development backend confirmed: fresh
Development Cognito account creation, authentication, repeated sync, and deck/card creation and
sync all working, with the same account working correctly across both a physical phone and the
simulator, and Production confirmed isolated and untouched throughout. Resource classes affected:
Development only. AWS mutations: normal read/write traffic to Development tables only (expected,
not a "mutation" in the guardrail sense). Exit criteria met: sync behaves identically to
Production's documented invariants, confirmed against the live Development backend.

**STEP 7 — Create the Staging/Beta environment.**
**Status: complete.** Objective: repeat Step 5's process for `interval-staging-*`, serving as both
Staging and the external Beta environment per §17's founder-approved decision — no separate
fourth environment. `IntervalStagingStack` was deployed via the identical CloudShell procedure
Development used (`docs/cdk-infrastructure.md`) — CloudFormation `CREATE_COMPLETE`,
`interval-staging-records`/`interval-staging-changes` both `ACTIVE`, `cdk diff
IntervalStagingStack` reports no differences. Resource classes affected: new, Staging-only
resources — fully independent from Development's own resources, sharing no table, pool, function,
or role. Rollback: `cdk destroy IntervalStagingStack` — note Staging's DynamoDB tables and
Cognito pool use `RemovalPolicy.RETAIN` (deliberately different from Development's `DESTROY` —
see `docs/cdk-infrastructure.md`'s "Staging removal/deletion policy" for the full reasoning:
Staging is expected to hold real external beta-tester data before Production does, so accidental
data loss from a routine infrastructure change or a mistaken destroy command is a real risk
Development doesn't have). Manual QA: same checklist as Step 6, against the live Staging backend
— **done**: fresh Staging Cognito account, sign-up/sign-in, repeated Force Resync, sync/data
operations, and phone + simulator consistency all confirmed working, Production confirmed
isolated throughout. AWS mutations: resource creation — performed with explicit founder approval,
from AWS CloudShell, not from any local machine.

**STEP 8 — Validate the migration/deployment process itself.**
Objective: prove that promoting the *same* Lambda source from Development to Staging (per §9) works
without manual console edits. Resource classes affected: Staging Lambda functions (redeployment).
Prerequisites: Step 7. Founder decision required: none beyond reviewing the result. Risk: low
(Staging only). Rollback: redeploy the prior version. Manual QA: confirm Staging behaves
identically to Development post-promotion. AWS mutations: Lambda code deployment to Staging,
requires approval per §15.

**STEP 9 — Establish Production environment status.**
Objective: formally confirm (not recreate, per Option A) that the existing environment is Production
under the new model — apply the naming/tagging/observability standards from §4/§14 to it where that
can be done without disruption, and confirm §15's guardrails are the actual working process for any
future change to it. Resource classes affected: existing Production resources — tagging/
observability additions only, not recreation. Prerequisites: Steps 1–8 all validated. Founder
decision required: explicit sign-off that Production is "live" under the new model. Risk: low if
scoped to tags/observability only. Rollback: remove added tags. Manual QA: confirm the app is
unaffected. AWS mutations: minor (tagging, log group creation for observability) — requires
approval.

**STEP 10 — Only then begin secure Library upload implementation.**
Objective: this is the actual reason environment separation matters — Library source upload, real
file storage, extraction, and any AI/transcription work should only begin once Development and
Staging exist and are validated, so that destructive testing has somewhere safe to happen. Resource
classes affected: none yet — this step is a gate, not an implementation. Prerequisites: Steps 1–9
complete. Founder decision required: explicit authorization to begin, separate from this plan's
approval. Risk: N/A (not yet started). Rollback: N/A. Manual QA: N/A. AWS mutations: none as part of
*this* plan — that work is out of scope for this mission and remains gated behind its own future
authorization, per `docs/library-and-source-architecture.md`.

## 17. Founder decisions

**Approved by the founder on 2026-08-08**, after reviewing the live-evidence-based recommendations
above. These are no longer open questions — recorded here as the final, binding architecture
decisions for this plan:

- **What the current AWS environment becomes** — **approved: Option A.** The existing deployed
  stack (§5) is the Production baseline. It is not renamed, recreated, or migrated merely for
  naming consistency. "Production baseline" does not yet mean "fully production-hardened" — see
  the "Production baseline vs. authoritative Production" note below for the distinction.
- **IaC choice** — **approved: AWS CDK, in TypeScript** (§8). Not implemented in this mission or the
  one that produced this plan.
- **Cognito separation** — **approved.** Development gets its own Cognito user pool/client;
  Staging/Beta gets its own Cognito user pool/client; the existing `IntervalUserPool`/
  `IntervalMobile` remain Production, unchanged. No automatic user migration in this phase (§10).
- **Naming convention** — **approved for new resources only:** `interval-dev-*`,
  `interval-staging-*`, `interval-prod-*` (§4). The eight existing Production resources are
  grandfathered and remain unchanged: `IntervalSyncApi`, `IntervalSyncPush`, `IntervalSyncPull`,
  `Interval_Records`, `Interval_Changes`, `IntervalUserPool`, `IntervalMobile`,
  `IntervalSyncLambdaRole` (§5).
- **Staging/Beta relationship** — **approved.** Staging also serves as the external Beta
  environment; no separate fourth "beta" AWS environment is created unless a future scale or
  release requirement concretely justifies it.
- **Production API stability** — **approved.** The current Production API URL and API identity
  (`IntervalSyncApi`, `4oge9e46jf`) are preserved unless a future migration has a concrete security,
  reliability, or architecture reason to replace it — never for cosmetic naming consistency.
- **Existing data treatment** — **approved.** Existing Cognito accounts and DynamoDB records are
  treated as potentially important Production-line data, not as disposable test data. This plan
  does not inspect user identities or record contents to determine whether the data is "real" or
  "test" — the approximate infrastructure-level item counts already confirmed (§1, §10) are
  sufficient evidence for this architecture decision. No migration, deletion, or reset of this data
  is performed or recommended.
- **Production baseline vs. authoritative Production** — **approved distinction.** The existing
  stack is the Production baseline *now*. It becomes the formally hardened/authoritative Production
  environment once environment separation, deployment controls, backup/hardening, and promotion
  validation (STEP 1–9 / Phase A–H above) are actually completed — not automatically by virtue of
  being designated the baseline today.

**Remaining genuinely open item:**

- **Whether the confirmed OAuth authorization-code flow and its CloudFront callback URL are actively
  used by the shipped app**, or are reserved/unused configuration on the `IntervalMobile` app
  client. Per founder instruction, this configuration is not removed or altered, and its exact
  current usage is left for later verification during a future authentication/deployment
  configuration audit — it does not block environment separation work.

**Resolved without further action needed here:** the "March 2, 2026 v3.0 work-done document"
referenced in a prior mission's instructions is a historical project artifact that exists outside
this repository — not a file to locate or reproduce here. Its statement that Cognito/auth was not
yet implemented was accurate as of that date and has since been superseded by the 2026-08-08 live
AWS audit, which confirms Cognito JWT authorization now protects both sync routes. No repository
copy of that document is required for this plan.
