# Staging Beta Distribution Foundation

**Status: implemented on `release/v3.2-staging-distribution`, cut from the frozen `v3.2-dev`
baseline (`4f0593e`), not yet merged.** This document describes a release-engineering/build-
configuration foundation only — no product feature, no AWS resource, and no App Store submission
exists as a result of this batch. See `docs/branch-and-release-policy.md` for the branch model and
`docs/v3-beta-release-checklist.md` for the overall v3.2 Staging RC status this feeds into.

## Purpose

v3.2 needs two simultaneously usable mobile paths from the **same codebase**:

- **Founder Development** — `v3.3-dev`, Development AWS backend, developer tooling allowed,
  Metro/dev-client acceptable. Unchanged by this batch.
- **Faculty/student Staging beta** — frozen `v3.2-dev`, Staging AWS backend, a production-like
  binary (no Metro, no Dev Launcher, no developer tooling), suitable for TestFlight/Internal
  Distribution.

This is a **build-configuration and gating** change, not a new application. Same React Native/
TypeScript source; environment-specific build configuration (`INTERVAL_ENV` + EAS build profile)
and intentional feature/tool gating decide what a given installed binary looks like and talks to.

## Build configuration audit — findings

- **What currently makes an installed app a "Development Build":** the combination of
  `expo-dev-client` being present as an npm dependency (autolinked into every native build by
  construction — this is normal and does not need to change) **and** the build actually being
  configured/launched in "dev client" mode. For a local build (`npx expo run:ios --device`), that
  is simply the default Debug-configuration behavior. For an EAS Build, it is the build profile's
  `developmentClient: true` flag.
- **`expo-dev-client` is bundled globally, not per-profile** — this is correct and does not need
  to change. What differs per EAS build profile is `developmentClient` (true → boots the Dev
  Launcher UI and expects a Metro connection; false/omitted → boots straight into the app with an
  embedded JS bundle, no Metro, no Dev Launcher). This is the standard, supported Expo mechanism
  for exactly the "one codebase, multiple build flavors" requirement here — no code fork needed.
- **A preview/release-like EAS build can fully exclude dev-client *behavior*** by setting
  `developmentClient: false` (the default when omitted) on its build profile — confirmed via
  Expo's own documented build-profile semantics; `expo-dev-client`'s native module stays compiled
  in but its Dev Launcher entry point is never invoked in that configuration.
- **Environment values are embedded at build time, not resolved at runtime.** `app.config.ts`
  reads `process.env.INTERVAL_ENV` / `EXPO_PUBLIC_API_BASE_URL` / `EXPO_PUBLIC_COGNITO_REGION` /
  `EXPO_PUBLIC_COGNITO_USER_POOL_ID` / `EXPO_PUBLIC_COGNITO_APP_CLIENT_ID` at **config-evaluation
  time** (whenever Expo evaluates `app.config.ts` — for EAS Build, that happens server-side before
  the native/JS build steps) and writes them into `expo.extra`, which is what
  `src/config/environment.ts`'s `getEnvironmentConfig()` reads at app runtime via
  `Constants.expoConfig.extra`. There is no live/remote config fetch — once built, a binary is
  permanently pointed at whichever environment was present in its build-time `process.env`.
  **Consequence:** a Staging binary built with only Staging values present at build time safely
  carries only Staging values — no other environment's values end up anywhere in that binary.
  Switching environments always requires a new build, never a runtime toggle.
- **`.env.example`'s own contract already forbids a silent fallback**: `src/config/
  environmentValidation.ts`'s `validatePublicClientConfig` (called from `getEnvironmentConfig()`)
  accepts only exactly `development` / `staging` / `production` for `INTERVAL_ENV` and throws
  `InvalidEnvironmentConfigError` for anything else, including empty/missing — so a Staging EAS
  build that somehow didn't receive `INTERVAL_ENV=staging` at build time fails loudly (any code
  path that calls `getEnvironmentConfig()`) rather than silently falling back to Development. This
  was already true before this batch; this batch adds the `eas.json` profile that guarantees
  `INTERVAL_ENV=staging` is always present for a `staging`/`staging-internal` build (see "Environment
  variable strategy" below) so that failure mode should never actually occur.

## Dev Tools gating — was `__DEV__`, now `INTERVAL_ENV`

**Before this batch:** `app/dev-tools.tsx` and `app/theme-lab.tsx` gated their content behind
`if (!__DEV__)`, and `app/index.tsx`'s Home-screen entry points (wordmark long-press, gear icon)
were gated the same way. `__DEV__` reflects the JS bundle's build **mode** (Metro/development vs a
minified release bundle) — an axis completely independent of `INTERVAL_ENV`. This mattered
concretely for exactly this mission: `docs/v3-beta-release-checklist.md`'s existing "Native build"
guidance already describes pointing a Debug/dev-client build at Staging as an interim path
(`.env` + `npx expo start -c`) — under the old gate, that build would still show full Dev Tools
(Force Resync, Reset Local Data, Library fixture seeding/reset, Theme Lab) because `__DEV__` is
`true` there regardless of `INTERVAL_ENV`. A true production-like Staging **release** build would
have hidden Dev Tools correctly by accident (release JS bundles have `__DEV__ === false`), but
relying on that coincidence was fragile and not the correct binding.

**Now:** a single centralized gate, `isDevToolsEnabled()` (`src/config/devToolsCapability.ts`),
returns `getEnvironmentConfig().isDevelopment`, failing closed (`false`) if environment config
can't be read at all — mirrors the existing fail-closed pattern in
`src/domain/ai/generateStudyDeckCapability.ts` and `src/cloud/sync/libraryMetadataSyncCapability.ts`.
Every reachability point for Dev Tools now goes through it:

| File | What changed |
| --- | --- |
| `src/config/devToolsCapability.ts` | **New.** The single gate. |
| `app/dev-tools.tsx` | Route-level content gate: `!__DEV__` → `!isDevToolsEnabled()`. |
| `app/theme-lab.tsx` | Same route-level gate change (Theme Lab has no entry point outside Dev Tools, but is gated independently as defense-in-depth). |
| `app/index.tsx` | Home-screen entry points (wordmark long-press, gear icon) now driven by `isDevToolsEnabled()` instead of `__DEV__`. |
| `src/domain/librarySeed.ts` | `seedDevLibraryFixtures`/`resetDevLibraryFixtures`'s own internal guards updated the same way, as defense-in-depth beneath the route gate. |
| `src/ui/HomeHeader.tsx` | Doc-comment wording only (no logic change). |
| `docs/platform-scope.md` | "Development-only route guards" section updated to describe the new mechanism. |

**Result:** Development environment → Dev Tools visible (unchanged). Staging environment → Dev
Tools hidden, regardless of whether that particular Staging build happens to be a Debug or Release
native configuration. Production environment → Dev Tools hidden (unchanged; Production was never
reachable via `INTERVAL_ENV=development` to begin with).

**Deliberately left unchanged** (out of scope — these are `console.log`/`console.warn` verbosity
gates, not UI/action reachability, and were never part of the Dev Tools exposure surface):
`src/storage/librarySourceFileStorage.ts`'s `logPersistenceError` and
`app/library/[id]/reader.tsx`'s `logSourceReader`, both still correctly gated on `__DEV__` (a
release JS bundle should stay quiet regardless of environment).

## Feature gates preserved, unchanged

Verified untouched by this batch — neither depends on build mode or this batch's Dev Tools gate:

- **Generate Study Deck** — `isGenerateStudyDeckEnabled()` (`src/domain/ai/
  generateStudyDeckCapability.ts`), allow-list `["development", "staging"]`. Visible in Development
  and Staging, hidden in Production, `[MOCK]`, TXT-only. A Staging beta binary **will** show
  Generate — this is intentional per the existing v3.2 scope, not a new exposure from this batch.
- **Discover** — no environment gate, by existing founder decision (see
  `docs/v3-beta-release-checklist.md`'s "Discover Production exposure — RESOLVED"). Unaffected.
- **Library metadata cloud sync / private source storage** — `["development", "staging"]`
  allow-lists, unaffected.

## EAS build profile architecture

```
eas.json
  development             developmentClient: true,  distribution: internal   (unchanged — founder local dev)
  development-simulator   extends development, iOS simulator                 (unchanged)
  staging                 developmentClient: false, distribution: store      (NEW — TestFlight-track)
  staging-internal        extends staging, distribution: internal            (NEW — ad-hoc fallback)
  [future] production     not created in this batch
```

```json
"staging": {
  "distribution": "store",
  "developmentClient": false,
  "environment": "preview",
  "env": { "INTERVAL_ENV": "staging" }
},
"staging-internal": {
  "extends": "staging",
  "distribution": "internal"
}
```

**Naming:** `staging`/`staging-internal` rather than Expo's generic `preview` convention —
consistent with how this repository already names everything else for this AWS environment
(`IntervalStagingStack`, `INTERVAL_ENV=staging`, "Staging RC" throughout
`docs/v3-beta-release-checklist.md`). The `"environment": "preview"` field is a *different*,
EAS-internal concept (which EAS-hosted environment-variable scope this profile pulls from — EAS's
own fixed vocabulary for that specific field is `development`/`preview`/`production`, unrelated to
our own `INTERVAL_ENV` naming) — mapped to `preview` here since EAS has no `staging` slot for that
field specifically; see "Environment variable strategy" below for why this distinction matters and
what to verify before relying on it.

- **`staging`** — the primary, recommended profile: `distribution: "store"` builds a binary
  signed for App Store Connect / TestFlight submission (`eas submit` after `eas build`).
- **`staging-internal`** — identical in every other respect, `distribution: "internal"`: an
  ad-hoc build installable via a QR code/link without going through App Store Connect at all,
  bound to registered device UDIDs. Useful as a lower-friction bootstrap path if Apple Developer
  Program enrollment or an App Store Connect app record isn't ready yet when Staging QA needs to
  start (see "Tester distribution options" below).
- Both explicitly pin `"env": { "INTERVAL_ENV": "staging" }` directly in the tracked `eas.json` —
  this one value is a plain enum selector, not a live/sensitive value (see
  `docs/environment-config-contract.md`), so committing it is safe and, per this mission's own
  "no silent Development fallback is acceptable" requirement, the most explicit and auditable way
  to guarantee every Staging build actually receives it.
- Neither profile sets `developmentClient: true` and neither carries the API URL / Cognito values
  — see below.

## Environment variable strategy

Required variable names (unchanged from `.env.example`):

```
INTERVAL_ENV
EXPO_PUBLIC_API_BASE_URL
EXPO_PUBLIC_COGNITO_REGION
EXPO_PUBLIC_COGNITO_USER_POOL_ID
EXPO_PUBLIC_COGNITO_APP_CLIENT_ID
```

- **`INTERVAL_ENV=staging`** — pinned directly in `eas.json` (see above). No live value, safe to
  commit, guarantees no silent Development fallback for a Staging build regardless of who runs it
  or what their local `.env` happens to contain.
- **The other four (`EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_COGNITO_REGION`,
  `EXPO_PUBLIC_COGNITO_USER_POOL_ID`, `EXPO_PUBLIC_COGNITO_APP_CLIENT_ID`) are deliberately NOT in
  `eas.json` or any other tracked file.** These are the real `IntervalStagingStack` output values —
  this mission's own guardrails list exactly these identifiers as things that must never be
  committed, and CLAUDE.md's "Never expose or commit secrets" rule applies regardless of whether
  any individual value is technically embeddable in a client build.
- **Required mechanism: EAS-hosted environment variables**, scoped to the `preview`
  environment-variable environment (matching this profile's `"environment": "preview"` field) —
  created once the project is linked to an EAS account (see "Apple/EAS account state" below), via
  either the `eas env:create` CLI command or the expo.dev project dashboard. **This repository has
  not verified the exact current `eas env:create` flag syntax against a live linked account** (the
  project isn't linked — see below) — confirm current syntax with `eas env:create --help` (or the
  dashboard UI) at the time this is actually set up, rather than trusting a possibly-stale example
  here. Conceptually: one variable per name above, values taken from `IntervalStagingStack`'s real
  CDK outputs (`docs/cdk-infrastructure.md`), scoped to the `preview` EAS environment, visibility
  can be `plaintext` (none of these four values are secrets — see `.env.example`'s own comment —
  but they are still real, environment-specific identifiers that don't belong in Git).
- **No live value was committed anywhere in this batch** — confirmed by direct diff review of
  every changed file; `eas.json`'s only new literal value is the string `"staging"`.

## App identifier audit — no change made, STOP-and-report

Current, confirmed by direct read of `app.json` (unchanged by this batch):

- iOS: `com.anonymous.briefly-app`
- Android: `com.anonymous.brieflyapp`

Both are Expo's own auto-generated placeholder namespace (`com.anonymous.*`), not a reverse-DNS
identifier Interval/Briefly Studios actually owns. This was already flagged as a placeholder in
`CLAUDE.md`'s "Legacy Briefly identifiers" section and `docs/v3-beta-release-checklist.md`'s "EAS /
distribution" section before this batch.

**This batch makes no identifier change**, per its own explicit instruction to STOP and report
rather than invent one. What's confirmed:

- **A `staging-internal` (ad-hoc) build can technically proceed under the current placeholder
  identifier** — ad-hoc distribution doesn't require App Store review or a public listing, so it
  doesn't strictly force the identifier question first.
- **A real `staging` (App Store Connect / TestFlight) submission should not proceed under
  `com.anonymous.*`.** It's not the professional, permanently-owned identity a real beta (and
  eventual Production release) needs, and once an App Store Connect app record and real testers
  exist under one bundle identifier, changing it later means a **new** app record and testers
  reinstalling under the new identifier — painful mid-beta churn best avoided by deciding once,
  before real external distribution starts.
- **This repository does not choose the replacement.** A natural, already-owned starting point is
  the `briefly-studios.com` domain already used for
  `src/domain/supportContact.ts`'s support email (e.g. something in the shape of
  `com.brieflystudios.interval`) — offered here only as a reference point, not a recommendation to
  act on without the founder's explicit decision, tied to whatever Apple Developer Team actually
  holds the account.
- **Migration implications if/when it changes:** a new bundle identifier is a new native app
  identity — new provisioning, a new App Store Connect app record, a new local Xcode project
  product identity (`ios/` is gitignored and regenerated by `prebuild`/`expo run:ios`, so the
  *repository* side is low-risk), but any already-installed local Development builds and any
  already-distributed Staging testers would need a fresh install under the new identifier. Doing
  this **once, before starting real external tester distribution**, avoids doing it twice.

## Apple / EAS account state

Verified directly, not assumed:

- **Expo/EAS account linkage: NOT linked.** `app.json` has no `extra.eas.projectId`; `eas.json`
  has no `owner`; running `npx eas-cli config` in this repository returns "An Expo user account is
  required to proceed" — confirming no cached/linked session exists here. `eas login` / `eas init`
  have deliberately not been run (this mission's own instruction, consistent with the existing
  tech-debt note in CLAUDE.md).
- **Apple Developer Program membership: unverifiable from this repository.** Nothing in this repo
  (gitignored `ios/`, credentials, or otherwise) confirms or denies an active paid membership.
  **This is the actual first gate** for either distribution option below — both EAS Internal
  (ad-hoc) Distribution and TestFlight require a paid Apple Developer Program membership to
  generate distribution-capable signing (a free Apple ID's personal-team signing cannot be
  installed on another person's device remotely). Confirm this before anything else in this
  section.
- **App Store Connect app record: does not exist** (no evidence of one, and no bundle identifier
  has been finalized to create one against).
- **Provisioning: none exists in this repository** (expected — `ios/` is gitignored, and no
  credentials have been configured via EAS either, since the project isn't linked).

## Tester distribution options

| | EAS Internal Distribution | TestFlight |
| --- | --- | --- |
| Apple Developer Program required | Yes (ad-hoc signing) | Yes (App Store distribution signing) |
| Per-tester friction | Tester must send their device UDID to be registered (≤100 devices/year per membership) | Tester installs the TestFlight app, accepts an email/link invite — no UDID needed |
| Update workflow | New ad-hoc build + redistribute link each time | New build + `eas submit`; testers get a normal TestFlight update notification |
| Apple review | None | Brief "beta app review" for external testers (internal testers on the same team skip this) |
| Production-likeness | High (real native binary) but installs outside the normal App Store/TestFlight app | Highest — identical install experience to a real released app |
| Scale | Bounded (~100 devices/year) | Up to 10,000 external testers |

**Recommendation: TestFlight**, matching this mission's own steer and the actual audience —
"faculty/student" testers are exactly the population UDID-registration friction hurts most, and
the tester count is unlikely to stay comfortably under Internal Distribution's ~100-device/year
ceiling for long. `staging` (this batch's primary profile) is built for this path.

**Fallback:** if Apple Developer Program enrollment or the App Store Connect app record isn't
ready when Staging QA needs to start, `staging-internal` (same binary otherwise, ad-hoc signed)
lets a small initial QA group install sooner without blocking on that setup — not a long-term
substitute for TestFlight given the audience.

## Founder-interactive next commands

None of the following were run by this batch — every one requires interactive founder
authentication/approval:

```
eas login                          # link this machine to the Interval Expo account
eas init                           # link this repository to an EAS project (writes extra.eas.projectId to app.json)
eas env:create --environment preview --name EXPO_PUBLIC_API_BASE_URL ...          # repeat for the other 3 Staging values
eas build --profile staging --platform ios       # (once Apple Developer Program + App Store Connect app record exist)
eas build --profile staging-internal --platform ios   # (ad-hoc fallback, sooner)
eas submit --profile staging --platform ios      # after a successful `staging` build, to reach TestFlight
```

Verify exact current flags for `eas env:create` (and any other command above) with `--help` or the
expo.dev dashboard at the time each step is actually performed — not asserted here as guaranteed
current syntax, since this repository's tooling was not exercised against a live linked account.

## Native dependency / release build confirmation

Checked directly against `package.json` and `app.json` — all required native modules are ordinary
dependencies, autolinked into every build regardless of profile, so a `staging`/`staging-internal`
build carries the same native capabilities as Development:

- `expo-audio` (~1.1.1), `expo-asset` (~12.0.13) — Audio source player.
- `react-native-pdf` (7.0.1) + `@config-plugins/react-native-pdf` — PDF reader.
- `react-native-blob-util` (0.24.2) + `@config-plugins/react-native-blob-util` — PDF/file support.
- `expo-secure-store` (~15.0.8) — device ID + auth token storage.
- `fflate` (0.8.3) — client-only DOCX parsing (no native module; ordinary JS dependency, unaffected
  by build profile).
- `expo-dev-client` (~6.0.21) present in every build (see "Build configuration audit" above) but
  **inert at runtime** for any profile with `developmentClient: false` — confirmed via the standard
  Expo build-profile mechanism, not a new/unverified assumption.

**Confirmed: a `staging`/`staging-internal` tester build needs no Metro** (`developmentClient:
false` embeds the JS bundle at build time) **and shows no `expo-dev-client` UI** (Dev Launcher only
activates when `developmentClient: true`, and this batch's Dev Tools screen itself is now
additionally gated off by `isDevToolsEnabled()` regardless).

## Desired tester experience

1. Tester installs Interval (TestFlight app, or the ad-hoc link for `staging-internal`).
2. Taps the normal Interval icon.
3. App launches normally — no Dev Launcher screen, no Metro/QR prompt.
4. Signs into Staging Cognito (fresh account or existing Staging tester account).
5. Uses Staging data, syncs against `IntervalStagingStack`.
6. Uses v3.2 features (decks, cards, sync, Library, PDF/DOCX/Audio/TXT readers, `[MOCK]` Generate,
   Discover) like a normal user — no developer tooling visible anywhere.

## Tester smoke matrix (to run once a `staging`/`staging-internal` binary exists)

1. Cold launch without Metro running.
2. No Dev Launcher screen appears.
3. No Dev Tools UI reachable (long-press wordmark does nothing; no gear icon).
4. Staging Cognito sign-in.
5. Create a deck.
6. Create/edit cards.
7. Sync completes ("Up to date," no `Http500`).
8. Second-device sync, if a second Staging device/tester is available.
9. Library: attach/upload a source.
10. Library: retrieve/open that source's original on a second device.
11. PDF reader opens a PDF source.
12. DOCX reader opens a `.docx` (including a wide table).
13. Audio player opens/plays an audio source.
14. TXT source → Generate → `[MOCK]` deck produced, reviewable, savable.
15. `[MOCK]` labeling visibly present on generated content.
16. Discover: lessons load, session budget/stop-state work as expected.
17. Dark/light appearance toggle.
18. Arabic RTL spot-check (chrome mirrors correctly).
19. Kill and relaunch — session and data persist.
20. Offline edit → reconnect → change syncs and converges.

## What this batch did NOT do

- No AWS deployment, no infrastructure change (Development, Staging, and Production AWS are all
  untouched).
- No `eas login`, `eas init`, or any other account-linkage/credential command was run.
- No bundle identifier change.
- No App Store Connect submission, no TestFlight build actually produced.
- No `v3.2-rc1` tag created.
- No merge into `v3.2-dev` — this branch (`release/v3.2-staging-distribution`) awaits review.
- No v3.3 feature work, no real AI, no PDF/DOCX Generate, no OCR, no transcription, no Discover
  architecture change, no DOCX/Audio reader change, no sync behavior change.
- No dependency upgrade (Expo, CDK, or otherwise) and no `npm audit fix`.
