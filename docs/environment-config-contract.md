# Interval Repository Environment Configuration Contract

**Status: implemented, client/repository-side only.** This document describes the environment
identity and public config contract introduced to prepare the app to be environment-aware, per
`docs/environment-separation-plan.md` §6/§7. This contract itself does not create or provision any
AWS environment — but all three named environments (`development`, `staging`, `production`) now
have real, deployed AWS resources behind them (see "Current status" below).

## Canonical environment values

Exactly three values, and only these three:

- `development`
- `staging`
- `production`

There is no mapping from shorthand values (`dev`, `prod`, `test`, etc.) — an ambiguous or
misspelled value is rejected the same as a missing one, never guessed at. See
`src/config/environmentValidation.ts`'s `parseIntervalEnvironment`.

## Variable names

Environment variable (`.env`, gitignored):

| Variable | Purpose |
|---|---|
| `INTERVAL_ENV` | One of `development` / `staging` / `production`. No default. |
| `EXPO_PUBLIC_API_BASE_URL` | API Gateway base URL for the selected environment. |
| `EXPO_PUBLIC_COGNITO_REGION` | AWS region for the selected environment's Cognito pool. |
| `EXPO_PUBLIC_COGNITO_USER_POOL_ID` | Cognito user pool ID for the selected environment. |
| `EXPO_PUBLIC_COGNITO_APP_CLIENT_ID` | Cognito app client ID for the selected environment. |

These are the same four `EXPO_PUBLIC_*` names the app already used before this change, plus the
one new `INTERVAL_ENV` variable — nothing was renamed.

### Public vs. secret

**All five values above are public build configuration, not secrets.** The Cognito app client has
no client secret; a region, API URL, pool ID, and app client ID are all safe to embed in a client
build and already are today. `INTERVAL_ENV` itself is not sensitive either — it only selects which
set of public values applies. None of these should ever gate on `EXPO_PUBLIC_*` being "risky" —
the risk this contract manages is *misconfiguration* (pointing a build at the wrong environment),
not secret exposure. See `docs/environment-separation-plan.md` §12 for the full secrets/public-
config classification, which this contract follows exactly.

## Expo `extra` names

`app.config.ts` injects these into Expo's `extra` (read via `Constants.expoConfig.extra`):

- `intervalEnv`
- `apiBaseUrl`
- `cognitoRegion`
- `cognitoUserPoolId`
- `cognitoAppClientId`

Existing `dotenv/config` behavior is unchanged — `app.config.ts` still reads `.env` via
`process.env.*` and passes values through to `extra`, exactly as it did before this change, with
one line added for `intervalEnv`.

## Runtime config module

Two files, `src/config/`:

- **`environmentValidation.ts`** — pure validation logic, no React Native or Expo imports.
  Exports `parseIntervalEnvironment`, `validatePublicClientConfig`, and
  `InvalidEnvironmentConfigError`. Kept import-free so it can be exercised deterministically
  outside the app (see this mission's validation section).
- **`environment.ts`** — the actual runtime entry point. `getEnvironmentConfig()` reads
  `Constants.expoConfig.extra`, validates it via `environmentValidation.ts`, and returns a frozen
  object: `{ environment, apiBaseUrl, cognitoRegion, cognitoUserPoolId, cognitoAppClientId,
  isDevelopment, isStaging, isProduction }`. Validated once, on first call, and cached.

**Why lazy, not validated at module import time:** validating unconditionally at startup would
mean an invalid/missing `INTERVAL_ENV` crashes the entire app immediately — including for a guest
who never signs in or syncs and therefore never actually needs cloud config. `getEnvironmentConfig()`
is only called by code paths that genuinely need the values (auth, sync HTTP), so guest/offline
behavior is unaffected by a misconfigured or absent `INTERVAL_ENV`, while any code path that *does*
need config still gets a hard, clear failure with no silent fallback — see "Safety validation"
below.

**Consuming code never reads `Constants.expoConfig.extra` or `process.env` directly** —
`src/auth/AuthConfig.ts` and `src/cloud/sync/http.ts` both call `getEnvironmentConfig()` exclusively.
`app.config.ts` remains the one legitimate place `process.env` is read, since it runs at Expo
config-build time, not app runtime.

## Local development behavior

A developer sets `INTERVAL_ENV=development` (or any of the three values) in their local,
gitignored `.env` and restarts Metro (`app.config.ts` only re-evaluates on process start, matching
existing pre-change behavior for the other four variables). `development` now has a real,
deployed backend to point at — see "Current status" below for where the real values come from.

## Staging behavior

Same mechanism as Development — `INTERVAL_ENV=staging` plus the four `EXPO_PUBLIC_*` values for
the Staging/Beta environment. `IntervalStagingStack` is deployed and founder-QA verified — see
"Current status" below for where the real values come from.

## Production behavior

`INTERVAL_ENV=production` plus today's existing, live Production values (the same
`EXPO_PUBLIC_*` values already in use before this change) reproduces exactly today's app
behavior. Production remains the grandfathered existing baseline, untouched by the Development
deployment — see `docs/cdk-infrastructure.md`'s "Production grandfathering" section.

## Safety validation

Enforced by `validatePublicClientConfig` — this is the **single authoritative parser/validator**
for this config; no other file in the repository independently re-parses or re-validates it (see
"Auth validation consolidation" below) — for every environment, with no environment-conditional
weakening:

- `INTERVAL_ENV` must be present and exactly `development`/`staging`/`production` — no fallback.
- Every field must be non-empty after trimming.
- `EXPO_PUBLIC_API_BASE_URL` must be a structurally valid `https://` URL.
- `EXPO_PUBLIC_COGNITO_REGION` must structurally resemble an AWS region (e.g. `us-east-2`).
- `EXPO_PUBLIC_COGNITO_USER_POOL_ID` / `EXPO_PUBLIC_COGNITO_APP_CLIENT_ID` must structurally
  resemble real Cognito identifiers.
- No field may look like a placeholder/example value (generic pattern match — `"example"`, long
  runs of `x`/`X`, `"changeme"`, `"your_"`, `"todo"`, `"paste"` — not a hardcoded list of real
  values). Enforced in **every** environment, not just Production: the pre-consolidation
  `src/auth/AuthService.ts` validator rejected placeholder values regardless of environment (it
  predates the environment concept), and that behavior was preserved rather than narrowed when it
  was centralized here.

### Auth validation consolidation

`src/auth/AuthService.ts` previously had its own independent `assertAuthConfigured()` /
`isPlaceholderValue()` validation, duplicating a subset of the checks above. That duplication was
removed — `AuthService.ts` now calls `getAuthConfig()` (which itself calls
`getEnvironmentConfig()`) exactly like every other consumer, and has no config-shape validation of
its own. `AuthService`'s own `isPlaceholderValue` pattern set (`"paste"`, `"your_"`,
`"example.com"`, long `x`/`X` runs) was folded into `environmentValidation.ts`'s
`isPlaceholderLike` rather than dropped, so no meaningful safety behavior was lost — this widened
the effective check (e.g. now also covers `EXPO_PUBLIC_API_BASE_URL`, which `AuthService` never
checked) without weakening anything Production already required. There is now exactly one
place — `src/config/environmentValidation.ts` — that parses or validates this config; every
consumer (`AuthConfig`, `AuthService`, sync's `http.ts`) reads the already-validated result and
performs no shape validation of its own.

### Real Production identifiers are deliberately not hardcoded anywhere in source

An earlier version of this contract included a dev-only `src/config/
devProductionIdentifierGuard.ts` module that hardcoded the real Production API ID, Cognito user
pool ID, and Cognito app client ID, to warn (in Dev Tools only) if a Development/Staging build was
accidentally configured with real Production values. **That module has been removed** — even
though those specific identifiers are not secrets (CLAUDE.md's "AWS Resources" section already
documents them in plain text, and Cognito's app client has no client secret), hardcoding real
infrastructure identifiers into tracked source for a collision check is unnecessary exposure this
repository does not need, and Metro does not reliably guarantee dead-code-eliminate an unreached
`__DEV__` branch out of a shipped bundle.

**This is a known, accepted limitation, not a gap this contract works around:** there is currently
no generic (non-hardcoded) way to detect "this Development/Staging config happens to equal the
real Production config" — a structural check can confirm a value is *shaped* like a valid Cognito
ID, but cannot know which specific ID is Production's without being told. The stronger protection
against this scenario is architectural, not a runtime string comparison: once Development and
Staging have their own genuinely separate AWS resources (§3–§5) with their own IAM roles and
deployment boundaries (per `docs/environment-separation-plan.md`), a Development build configured
with Production's Cognito IDs would simply authenticate against Production's real user pool — the
protection has to come from *not letting that configuration exist in practice* (separate deploy
pipelines, separate `.env` files per environment, founder review before any Production config
change), not from a client-side string match that can always be bypassed by a typo the check
doesn't happen to catch.

## Dev Tools environment display

Dev Tools (`app/dev-tools.tsx`, itself gated behind `if (!__DEV__)` with no production-reachable
entry point per `docs/platform-scope.md`) shows only the current environment label (`Development` /
`Staging` / `Production` / `Not configured`). No API URL, Cognito ID, warning about matching
Production identifiers, or secret is ever displayed.

## Local-storage non-splitting rule

**`INTERVAL_ENV` governs cloud endpoints and configuration only — it must never affect local
storage namespacing.** Confirmed unchanged by this batch:

- Legacy `briefly.*` AsyncStorage keys (`src/storage/keys.ts`), the SecureStore device-ID key
  (`src/storage/device.ts`), and the appearance/language preference keys remain exactly as they
  are — none reference `INTERVAL_ENV` or any environment concept.
- Guest vs. signed-in local partitioning continues to go through the existing
  `scopedKey(WorkspaceScope, ...)` mechanism (`src/storage/workspaceScope.ts`) — `guest` or
  `user:<sub>` — the same mechanism decks/cards/sessions and Library metadata
  (`interval.librarySources.v1`, `interval.sourceCollections.v1`) already use. This contract adds
  no new scoping dimension.
- A guest's offline decks, cards, sessions, Library metadata, and accessibility/appearance/
  language preferences look identical regardless of which `INTERVAL_ENV` a build happens to be
  configured with — switching environments only changes which backend a signed-in sync talks to,
  never which local storage keys are read or written.

## Current status: all three environments live

All three `INTERVAL_ENV` values now have somewhere real to reach:

- **`development`** — `IntervalDevelopmentStack`, deployed and founder-QA verified end-to-end
  (fresh Cognito account, sign-up/sign-in, repeated Force Resync, deck/card creation and sync,
  phone + simulator consistency all confirmed).
- **`staging`** — `IntervalStagingStack`, deployed and founder-QA verified end-to-end with the
  identical checklist.
- **`production`** — the existing, grandfathered Production baseline, unchanged throughout both
  deployments.

See `docs/cdk-infrastructure.md` for the full deployment record and the exact `describe-stacks`
commands to retrieve each environment's real `EXPO_PUBLIC_*` values from its stack outputs. This
repository's `.env.example` still ships only placeholder values, never real ones, for any
environment — see "Safety validation" above for why a placeholder is rejected identically in
every environment, not just Production.

**Founder-local configuration, current state:** the founder switches between environments today
by hand-editing the single gitignored local `.env` — setting `INTERVAL_ENV` to the target
environment plus that environment's four real values, then restarting Metro. There is exactly one
active environment per build; the app does not read multiple environments' config at once. No
per-environment `.env` files (e.g. `.env.development`, `.env.staging`) and no environment-switching
script exist in this repository — that remains a possible future workflow improvement, not
implemented here. Nothing about the config *contract* itself changed to make any of this possible;
it already supported all three environments before any of them but Production had real
infrastructure to point at.

## What this batch does not do

Per its own explicit scope: no AWS resource was created or mutated, no CDK was implemented, no
`eas.json` or EAS build profile was introduced, no Library upload/S3/AI/transcription/Canvas/
notification/hosted-sharing code was added, and authentication/sync/API-route behavior is
unchanged when `INTERVAL_ENV=production` is set to today's existing values.
