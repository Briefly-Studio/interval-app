# Branch and Release Policy

This document is the current, active policy for how work moves between branches in this
repository. It reflects a real decision the founder made, not a proposal.

## Current state

- **`v3.0-dev` is frozen** at commit `2eab4447e728c990cf450582e73a090841b1bfbc`. This is the
  approved, founder-tested V3 Release Candidate checkpoint.
- **`v3.0-rc1`** is the immutable tag for that exact commit — the known-good reference point if
  anything ever needs to be compared against, or built from, "the last confirmed-stable state."
- **The `v3.1-dev` integration wave is complete.** It carried the localization, source-viewer /
  source-preview, source-normalization, sync-reliability, and AI-foundation work off their
  feature branches via founder-QA'd `--no-ff` merges.
- **`v3.2-dev` is the active branch.** It contains everything in `v3.1-dev` plus the completed
  feature wave — Generate Study Deck (mock provider), Discover Preview, the DOCX reader, and the
  Audio source player. As of the v3.2 feature freeze it sits at
  `b460271df1eaa09ac339d6b137b37c51d838d9e2`. See `docs/v3-beta-release-checklist.md` for the
  v3.2 stabilization and Staging-RC status.

## What happens where

- Active feature and stabilization work is on `v3.2-dev`. During a feature freeze (declared in
  the release checklist) only release blockers, safety/security fixes, broken-flow fixes,
  config/release corrections, documentation, and environment preparation land there.
- `v3.0-dev` receives no new feature work. It exists to represent "the state that was tested and
  approved," not to keep evolving.
- Future waves follow the same discipline that built `v3.1-dev` and `v3.2-dev`: feature branch →
  reconcile with canonical → founder QA → explicit `--no-ff` merge.

## Hotfixes

If an emergency fix is ever needed against the frozen release candidate (not against whatever the
active branch has become by then):

1. Branch from the frozen commit (`2eab4447e728c990cf450582e73a090841b1bfbc`, or the `v3.0-rc1`
   tag) — not from the active branch, which contains unrelated in-progress work.
2. Make the minimal fix on that dedicated hotfix branch.
3. The fix must later be reconciled into the active branch as well, so it doesn't silently
   regress past a bug that was already fixed once.

## Merge discipline

No feature is merged into a release branch without founder QA and validation. This applies
regardless of how confident the implementation looks from code review or automated checks alone.
The repository has three focused `node --test` unit suites (`test:sync`, `test:ai`, `test:docx`,
70 tests over pure helpers) but no broad end-to-end / UI harness — founder runtime verification
is the actual safety net, not a formality on top of one.

## Backend environments

**Backend environment separation is now operational.** Interval runs three separate AWS
environments in `us-east-2`: **Development** and **Staging/Beta** (both CDK-managed, `infra/`,
deployed and founder-QA verified — see `docs/cdk-infrastructure.md`) and **Production** (the
existing grandfathered baseline, not CDK-managed). Which backend a build talks to is a client
configuration choice via the local gitignored `.env` (`INTERVAL_ENV` = `development` /
`staging` / `production`), never a property of which Git branch produced it. See
`docs/environment-separation-plan.md` for the full architecture and `docs/environment-config-contract.md`
for the client contract.

Features that create new persistent third-party data are rolled out per environment behind their
own capability gates, not all at once: Library metadata cloud sync and private source-file
storage are live in Development and Staging (not Production); the Generate Study Deck UX is
gated to Development and Staging and uses a local mock only (no provider-backed generation, no AI
backend deployed anywhere); Canvas integration remains a future specification. Widening any of
these to Production is a separate, explicit, founder-approved decision each time.

### Git branches are not AWS environments

These are two different, independent concepts, and this document deliberately keeps them separate:

- **A Git branch** (e.g. `v3.1-dev`) is a line of source-code history. It determines what code
  exists, not what it talks to.
- **An AWS environment** (Development / Staging / Production, per `docs/environment-separation-
  plan.md`) is a set of deployed infrastructure — its own API Gateway, Lambda functions, DynamoDB
  tables, and (recommended) Cognito pool. It determines what data a running build of the app
  actually reads and writes.

A single Git branch's code can be built and pointed at any AWS environment, and the *same* backend
environment can, in principle, be talked to by builds from more than one branch — which backend a
given build uses is a client configuration choice (see `docs/environment-separation-plan.md`'s
client configuration contract), not a property of which branch produced it.

**Do not create long-lived `dev`/`staging`/`prod` Git branches merely because AWS environments of
those names exist**, unless a future release strategy explicitly requires it. Code is promoted
across AWS environments by deploying the same reviewed commit with different environment
configuration (see `docs/environment-separation-plan.md`'s promotion model) — not by maintaining a
permanent branch per environment. This repository's branch model (a frozen release-candidate
branch plus one active development branch, per "Current state" above) already works this way, and
the three AWS environments do not change that.

External beta testing has not started. Staging/Beta exists and is founder-QA verified but has no
external tester population yet; the Staging RC phase (see `docs/v3-beta-release-checklist.md`) is
the gate before that. Anything that would create new persistent third-party data against
Production — Library metadata sync, private source storage, provider-backed AI generation,
Canvas integration — stays behind its own explicit, founder-approved, per-environment rollout
decision, exactly so "the right environment separation exists" remains a real, checkable
prerequisite rather than an assumption.
