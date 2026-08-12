# AWS Current-State Audit

**Audit date:** 2026-08-07 (repository-side attempt, live access unavailable) and 2026-08-08
(founder-performed live read-only audit from AWS CloudShell, in the correct Interval AWS account).
**Audited by:** Repository-side inspection (2026-08-07) plus founder-performed, read-only AWS
CloudShell inspection (2026-08-08), incorporated here as authoritative live evidence.
**Mutations performed:** none, in either session. Every AWS CLI call across both audits was a
read-only `get`/`describe`/`list` operation. No resource was created, updated, deleted, deployed,
tagged, or otherwise mutated.

This document contains only non-secret infrastructure metadata. It intentionally does not
include: AWS account ID, caller ARN, IAM user ID, tokens, user identities, credentials, secret
values, signed URLs, actual user data, raw IAM policy documents, or resource ARNs beyond what's
needed to name a resource class. The one OAuth callback URL confirmed live is deliberately **not**
reproduced here — its existence is documented, not its value (see §"Cognito app client" below).

## Region

Confirmed live: **us-east-2**. The CloudShell session had no configured default region; every
query explicitly used `--region us-east-2`. This matches `CLAUDE.md`'s documented region exactly.

## 2026-08-07 attempt (preserved for continuity)

The only AWS CLI credential available in that session's local environment (one configured profile,
default region `us-east-1`) did not resolve to the Interval AWS account: explicit `--region
us-east-2` queries for every documented resource class — the API Gateway API ID, both Lambda
functions, both DynamoDB tables, and the Cognito user pool — each returned either a "not found"
error for the specific documented ID, or an empty list when listing all resources of that type.
Zero results across every service, not just one, indicated an account mismatch rather than deleted
resources. No further conclusions were drawn from that session; live-state verification was marked
incomplete and handed off for the founder to retry with the correct account access.

## Live AWS access result: 2026-08-08 audit substantially complete

The 2026-08-07 attempt above did not reach the Interval AWS account. On 2026-08-08, the founder
ran the equivalent read-only audit from AWS CloudShell, authenticated as the correct Interval
account identity. Every resource documented in `CLAUDE.md` was successfully located and inspected.
**This audit is now substantially complete** for the resource classes below — the remaining gaps
are narrower and listed explicitly under "Known unknowns."

## Resources confirmed (live, 2026-08-08)

### API Gateway

- API name: `IntervalSyncApi`, API ID `4oge9e46jf`, protocol HTTP, stage `prod`.
- Stage `AutoDeploy`: **true**.
- Stage variables: none configured.
- API/stage tags: none configured.

**Routes confirmed:**

| Route | Authorization | Authorizer | Integration | Target Lambda |
|---|---|---|---|---|
| `GET /sync/pull` | JWT | `ffv9gc` | `7zqyy44` | `IntervalSyncPull` |
| `POST /sync/push` | JWT | `ffv9gc` | `6px9gmk` | `IntervalSyncPush` |

Both integrations are `AWS_PROXY` type, Lambda payload format version `2.0`.

**JWT authorizer confirmed:** name `CognitoJwtAuth`, ID `ffv9gc`, identity source is the
`Authorization` header, issuer is the live `IntervalUserPool` in `us-east-2`, audience is the
`IntervalMobile` app client. This is the first live confirmation that the routes are actually
protected by Cognito JWT validation, not merely assumed from repository source.

### Lambda

| | `IntervalSyncPush` | `IntervalSyncPull` |
|---|---|---|
| Runtime | `nodejs24.x` | `nodejs24.x` |
| Architecture | `arm64` | `arm64` |
| Memory | 128 MB | 128 MB |
| Timeout | 3 seconds | 3 seconds |
| Execution role | `IntervalSyncLambdaRole` | `IntervalSyncLambdaRole` (shared) |
| Environment variables | `RECORDS_TABLE=Interval_Records`, `CHANGES_TABLE=Interval_Changes` | `CHANGES_TABLE=Interval_Changes` |

The deployed environment variable names (`RECORDS_TABLE`, `CHANGES_TABLE`) match exactly what
`backend/lambdas/sync-push/index.mjs` and `sync-pull/index.mjs` read from `process.env` — this is a
genuine, live-confirmed match at the **configuration** level. It is **not** a confirmation that the
deployed function *code* matches the repository source byte-for-byte — see "Source-vs-deployed
verification status" below; configuration parity and source parity are different claims, and this
audit only established the former.

### DynamoDB

| | `Interval_Records` | `Interval_Changes` |
|---|---|---|
| Status | ACTIVE | ACTIVE |
| Partition key | `PK` | `PK` |
| Sort key | `SK` | `SK` |
| Billing mode | `PAY_PER_REQUEST` | `PAY_PER_REQUEST` |
| Approximate item count | 108 | 203 |
| Approximate size | 43,302 bytes | 88,528 bytes |
| Streams | disabled | disabled |
| Point-in-time recovery | DISABLED | DISABLED |
| TTL | DISABLED | DISABLED |

Item counts and sizes are recorded here strictly as **infrastructure metadata** (table-level
statistics DynamoDB itself reports) — no table item was read, queried, or scanned to produce them.

On encryption: DynamoDB tables are encrypted at rest by AWS by default (AWS-owned keys) unless a
customer-managed or AWS-managed KMS key is explicitly configured. The live audit did not confirm a
specific customer-managed `SSEDescription` configuration for either table. **This document does not
claim the tables are unencrypted** — a null/absent customer-managed SSE configuration reflects
default AWS-owned-key encryption, not the absence of encryption. Whether a customer-managed key is
desired for either table is a separate, undecided hardening question (see "Production-hardening
observations" below), not a confirmed gap in baseline protection.

The Records table holding 108 items and the Changes table holding 203 confirms this environment
currently holds **real, non-trivial persisted data** — this is a material fact for §"Recommendation
for the existing environment" below, not a zero-data test environment.

### Cognito user pool

- Name `IntervalUserPool`, ID `us-east-2_UwGRm5dye`.
- MFA: **OFF**.
- Deletion protection: **ACTIVE**.
- Password policy: minimum length 8, uppercase required, lowercase required, number required,
  symbol required, temporary password validity 7 days.
- Account recovery, in priority order: (1) verified email, (2) verified phone number.

### Cognito app client

- Name `IntervalMobile`, client ID `2bjbtn3qbdrcsa9k60095p5lto`.
- Supported identity provider: `COGNITO` only (no federated/social providers).
- Explicit auth flows enabled: `ALLOW_REFRESH_TOKEN_AUTH`, `ALLOW_USER_AUTH`,
  `ALLOW_USER_PASSWORD_AUTH`, `ALLOW_USER_SRP_AUTH`.
- OAuth: authorization code flow is enabled, with scopes `email`, `openid`, `phone`. **One
  CloudFront-domain callback URL is currently configured** — its exact value is deliberately not
  reproduced in this document (see the header note above). No logout URL is currently configured.
- No client secret (unchanged from prior documentation — consistent with a public, mobile-native
  OAuth client).

This is a materially new finding versus prior repository-only documentation: `src/auth/
AuthService.ts`'s direct Cognito API calls (`InitiateAuth`-style) are the app's primary auth path,
but the app client is **also** configured for an OAuth authorization-code flow with a real callback
URL. Whether that OAuth path is currently exercised by any part of the shipped app, or is
configured but unused/reserved for a future use case (e.g. a web-based flow), was not established
by this audit and is listed as a known unknown below.

## Current security/safety controls confirmed live

- Cognito JWT authorization is live-confirmed on both `/sync/push` and `/sync/pull` — requests
  without a valid token issued by `IntervalUserPool` for the `IntervalMobile` audience are rejected
  at the API Gateway layer, before ever reaching a Lambda.
- Cognito deletion protection is **ACTIVE** on the user pool — the pool cannot be accidentally
  deleted via a simple API call.
- DynamoDB billing mode is `PAY_PER_REQUEST` on both tables — no idle base capacity cost, no
  under-provisioned-capacity throttling risk under current data volume.
- Password policy meets a reasonable modern baseline (length 8, all four character classes
  required).

## Production-hardening observations

These are **observations about the current baseline, not automatic defects.** Each is classified
below. None of this implies the environment is unsafe to keep operating as-is today — it clarifies
what "Production baseline" means versus "fully production-hardened," per this document's own
terminology (see `docs/environment-separation-plan.md` §5).

| Observation | Classification | Note |
|---|---|---|
| DynamoDB billing mode `PAY_PER_REQUEST` | **Acceptable / currently sensible** | Matches current, modest data volume (108 + 203 items); no reason to change until a real capacity-planning signal exists. |
| Cognito deletion protection ACTIVE | **Positive safety control** | Already reduces a real accidental-deletion risk. |
| JWT authorization confirmed on both sync routes | **Positive safety control** | Live-confirmed, not just assumed from source. |
| Cognito MFA OFF | **Current state, not automatically a defect** | Consumer mobile flashcard apps commonly ship without mandatory MFA; this is a product/risk decision, not an obvious gap — documented as current state rather than a required fix. |
| API Gateway stage `AutoDeploy=true` | **Review before a formal Production release process exists** | Fine for the current single-environment, founder-only-deploys reality; worth revisiting once Staging/Production have distinct, reviewed deploy gates (see `docs/environment-separation-plan.md` §9's promotion model). |
| DynamoDB PITR disabled (both tables) | **Hardening candidate** | Worth enabling before this environment's data importance increases materially (e.g. once it holds a larger real user base or Library source records) — not urgent today given the current, modest, recoverable-by-re-sync data shape. |
| DynamoDB TTL disabled (both tables) | **Deliberate design, not a gap** | No feature currently relies on automatic item expiry; enabling TTL without a concrete need would be speculative. |
| DynamoDB streams disabled (both tables) | **Deliberate design, not a gap** | Nothing currently consumes a change stream; matches the "no speculative infrastructure" principle already established for this project. |
| No environment tags on any Production resource | **Environment-management gap, specific to Production** | Development and Staging (deployed since this audit — see `docs/cdk-infrastructure.md`) both carry `Project`/`Environment`/`ManagedBy` tags per `docs/environment-separation-plan.md` §4's standard. Production has none because it is grandfathered and not managed by CDK, not because environment separation as a whole is unimplemented. |
| Lambda runtime `nodejs24.x`, `arm64`, 128 MB, 3s timeout | **Acceptable current configuration** | Modern runtime, cost-efficient architecture/memory choice for this workload's demonstrated size; no evidence of throttling or timeout issues in the metadata reviewed. |
| OAuth authorization-code flow configured with a live callback URL, unclear current usage | **Unresolved / needs a decision** | Still unconfirmed whether this Production configuration is actively used. Resolved as a design question for the *new* pools specifically: Development and Staging (`docs/cdk-infrastructure.md`) were both provisioned with `disableOAuth: true` — a deliberate decision, not Production's OAuth configuration copied blindly — since neither this app's client code nor the new pools have any OAuth/Hosted-UI use case. |

## Source-vs-deployed verification status

**Still unverified.** This audit confirmed that the deployed Lambdas' **configuration**
(environment variable names, runtime, architecture, memory, timeout, IAM role) is consistent with
what the repository source expects. It did **not** perform an exact comparison of the deployed
function code against `backend/lambdas/sync-push/index.mjs` / `sync-pull/index.mjs` (e.g. via a
downloaded deployment package hash or an inline code diff) — no such comparison was attempted or
is claimed. Configuration parity is not source parity; **do not infer source-code parity from
matching configuration alone.** `CLAUDE.md`'s existing caveat — "Whether the deployed Lambda
functions match the source in `backend/lambdas/` has not been verified end-to-end" — remains
accurate and is preserved rather than silently marked resolved.

## Known unknowns (narrowed by the 2026-08-08 audit, not eliminated)

- Exact deployed Lambda source code, byte-for-byte, versus repository source (see above).
- Whether the configured OAuth authorization-code flow / callback URL is actively used by any
  shipped part of the app, or reserved/unused.
- DynamoDB encryption key management detail (AWS-owned vs. customer-managed) beyond "not
  customer-managed-SSE-confirmed" (see the DynamoDB section above).
- IAM policy detail attached to `IntervalSyncLambdaRole` (role name is now known; its exact
  attached policy documents were not reproduced into this document, per the instruction to avoid
  unnecessary raw policy content).
- Whether any additional, undocumented staging/dev resource exists elsewhere in the account (this
  audit targeted the documented resource names specifically; it was not an unbounded account-wide
  resource enumeration).

## Historical note

`CLAUDE.md`'s "Current Backend Task Status" section already documents that per-user partitioning
(`U#<sub>`) is implemented in the repository's Lambda source. This audit adds a **live**
confirmation that the API Gateway layer in front of those Lambdas does in fact enforce Cognito JWT
authorization — a fact previously stated only as a repository-source claim, now independently
corroborated at the infrastructure level.

Separately, this repository's older, explicitly-historical planning documents (`docs/versions/
v1.md`, `v1.5.md`, `v2.0.md`, `docs/v2.0_kickoff.md`) predate Cognito/auth entirely — `docs/
v2.0_kickoff.md` explicitly lists "No accounts / auth" as a v2.0 non-goal. Those documents remain
historical snapshots of an earlier product stage and are not rewritten here; the live evidence in
this audit simply confirms that the product has since moved well past that stage.

**Founder-confirmed (2026-08-08):** a more specific "March 2, 2026 v3.0 work-done" document exists
as a historical project artifact outside this repository, not as a file to be located or reproduced
here. Its statement that Cognito/auth was not yet implemented was accurate as of that date and has
since been superseded by this audit's live confirmation that Cognito JWT authorization now protects
both sync routes. No repository copy of that document is required.

## Confirmation

No AWS resource was created, updated, deleted, deployed, tagged, or otherwise mutated during
either the 2026-08-07 or 2026-08-08 audit. Every command executed was a read-only `get`,
`describe`, or `list` operation. No Cognito user was listed, no DynamoDB item was read, queried, or
scanned, and no study content or source file was accessed.
