# Development Build Workflow

**Status: founder-QA verified on iOS Simulator and physical iPhone.** This document is the
authoritative record of Interval's migration from Expo Go to an Expo Development Build as the
development native runtime. Development Build is now the verified development native runtime on
iOS; EAS Build (cloud builds / physical-device distribution without a local Xcode/Mac) remains
prepared but not linked to an Expo account — see "EAS status" below.

## Why this migration

Expo Go only bundles a fixed set of native modules chosen by Expo for a given SDK version. Interval
has already hit at least one instance of this (a legacy `expo-file-system` native module not being
guaranteed present under Expo Go on this SDK generation — see
`docs/library-and-source-architecture.md`'s "Local file URI rule and local source file durability"
incident record), and future work (e.g. a true in-app document viewer) is expected to need a
native module Expo Go cannot provide at all. A Development Build is Interval's own compiled native
shell — every native module the project actually depends on is included, nothing more, nothing
Expo didn't choose to ship in Expo Go.

This migration changes only the native **shell** used during development. It does not change React
Native, TypeScript, Expo Router, Metro, Fast Refresh, npm, or any AWS/backend architecture.

## What changed

- Added `expo-dev-client` (installed via `npx expo install expo-dev-client`, which resolved the
  SDK 54–compatible version) — the package that turns a compiled native build into a development
  client capable of connecting to a running Metro server, the same way Expo Go does.
- Declared explicit, **preserved** native identifiers in `app.json` (`ios.bundleIdentifier`,
  `android.package`) — see "Native identifier decision" below for why these are unchanged values,
  not new ones.
- Added a minimal `eas.json` with `development` and `development-simulator` build profiles — see
  "EAS status" below for what this does and does not enable yet.
- No app.json plugin entry was added for `expo-dev-client` — current Expo tooling detects and
  applies its native configuration automatically from the package being installed; adding it to
  the `plugins` array is unnecessary and not part of Expo's own documented setup for it.

## Native identifier decision

Interval's tracked Expo config previously declared no explicit `ios.bundleIdentifier` or
`android.package` at all. Local native-project generation therefore fell back to Expo's own
anonymous/slug-derived default: `com.anonymous.briefly-app` (iOS) and `com.anonymous.brieflyapp`
(Android) — confirmed directly from this machine's already-generated (gitignored, untracked)
`ios/`/`android/` directories and a locally-succeeded prior Simulator build using those exact
values with ad-hoc "Sign to Run Locally" signing (no provisioning profile, no App Store Connect
identity, no prior real signing history tied to them).

A Development Build needs an explicit, stable, authoritative native identifier — an implicit,
re-derived-per-machine default is not suitable once the identifier needs to stay consistent across
builds, devices, and (eventually) EAS. Rather than choosing a new, rebranded identifier
(`com.interval.app` or similar), the existing values were made explicit and tracked, unchanged, in
`app.json`. This is a deliberate, conservative choice, not an oversight: nothing in this repository
or the local generated projects proves these identifiers are free of any external significance,
and this migration's mandate is a platform/runtime change, not a native identity rebrand — see
`CLAUDE.md`'s "Legacy Briefly identifiers" section for the same reasoning applied elsewhere in this
codebase. Revisiting these identifiers (e.g. before a real App Store submission) is a separate,
explicit, founder-approved decision.

## Scheme / deep link

No new URL scheme was needed. `app.json` already declares `"scheme": ["interval", "briefly"]`,
and Expo's own tooling additionally derives a bundle-identifier-based scheme
(`com.anonymous.briefly-app`) and an Expo-CLI launch scheme (`exp+briefly-app`) automatically —
all four are present in the generated `Info.plist` after this migration. `expo-dev-client` uses
whatever scheme(s) the app already declares to construct its own launch deep links; nothing here
needed to change.

## Native project / Continuous Native Generation (CNG) strategy

`ios/` and `android/` remain gitignored, generated, disposable native projects — not tracked
source. Nothing about this migration changes that. `app.json` (plus `app.config.ts`'s environment
`extra` injection) remains the single authoritative native configuration source; native projects
are regenerated from it on demand via `npx expo prebuild` (automatically invoked by
`npx expo run:ios`/`run:android` when needed). No manual Xcode/Gradle project maintenance was
introduced.

The previously-generated `ios/`/`android/` directories on this machine were confirmed safe to
regenerate before doing so: both were gitignored, contained only standard CNG-generated files
(no hand-authored native source, no custom Podfile/Gradle modifications visible), and used
ad-hoc "Sign to Run Locally" signing only — no provisioning profile or signing configuration of
any real value existed to lose. `npx expo prebuild --clean` was run for both platforms as part of
validating this migration's configuration; both completed successfully.

## EAS status

`eas.json` defines two build profiles (`development`, `development-simulator`) but **no EAS
project link exists yet** — this machine is not logged into any Expo account
(`npx expo whoami` → "Not logged in"), and no `eas init`/`eas build:configure` was run, since both
require interactive account authentication and would bind this repository to a specific Expo
account/project. That step was deliberately not performed autonomously — see "Founder actions
still required" below.

**Local builds are the primary path for this migration** and require no Expo/EAS account at all:
`npx expo run:ios` (device or Simulator) uses Xcode's own local build-and-install mechanism
directly. This has been founder-QA verified end-to-end for both physical iPhone and Simulator
without any interactive Expo/EAS account step. EAS Build (cloud builds, useful later for
distributing a build without a local Xcode/Mac, or CI) remains prepared-but-inactive
infrastructure until the founder deliberately logs in and links a project.

### Founder actions still required (if EAS Build is wanted)

```bash
eas login              # interactive — authenticate with the correct Expo account
eas init                # links this repository to an EAS project under that account
eas build --profile development --platform ios
```

None of the above was run. Do not run `eas login`/`eas init` against an assumed or default account.

## Physical iPhone: build and install

```bash
npx expo run:ios --device
```

Xcode will prompt for device selection if more than one is connected/available; a paid or free
Apple Developer account configured in Xcode (Settings → Accounts) is required for on-device code
signing (a free account works for local installs, subject to Apple's standard free-provisioning
constraints). This is a local Xcode operation — no Expo/EAS account is involved.

## iOS Simulator: build and install

```bash
npx expo run:ios
```

Or target a specific simulator explicitly:

```bash
npx expo run:ios --device "iPhone 17"
```

## Normal daily workflow after migration

```bash
npx expo start
```

Then open the already-installed Interval Development Build on the device/Simulator (or let
`expo run:ios` launch it automatically the first time) — it connects to the running Metro server
exactly the way Expo Go used to, and Fast Refresh works the same way for ordinary source edits.

### When a native rebuild IS required

- A native package is added, removed, or has its native code changed
- A config plugin is added, removed, or its options change
- Native permissions or entitlements change
- `ios.bundleIdentifier` / `android.package` (or any other native identifier) changes
- The Expo SDK is upgraded
- Any native (Swift/Kotlin/Objective-C/Java) source is added or changed

### When a native rebuild is NOT required

- React component changes
- TypeScript/JavaScript logic changes
- Styling changes
- Any other ordinary JS-only code change — Fast Refresh handles these exactly as before

## Founder QA — PASSED

Verified on both iOS Simulator and physical iPhone (local build via `npx expo run:ios --device`,
local Xcode/Apple Developer signing — no EAS build was used for this verification).

**Startup**
1. Interval Development Build launches
2. Connects to Metro
3. App startup branding works
4. No Expo Go dependency remains in the normal QA workflow
5. Fast Refresh works after a trivial source change

**Environment**
6. Dev Tools reports Development
7. Existing `.env` configuration reaches the app correctly

**Auth**
8. Sign-in works
9. Sign-out works
10. SecureStore token/session behavior survives relaunch

**Sync**
11. Force Resync works
12. Decks/cards/sessions sync
13. Library metadata sync still works
14. Second-device behavior remains consistent

**Library files**
15. DocumentPicker works
16. Durable source attachment works
17. S3 upload works
18. Cloud source retrieval works
19. Existing Open Original/share flow still works
20. Force-close/relaunch preserves local file behavior

**General app**
21. Decks · 22. Cards · 23. Review · 24. Quiz · 25. Collections · 26. Library · 27. EN/ES ·
28. Appearance modes · 29. Speech/haptics where applicable · 30. No obvious navigation regression

**Simulator**
31. Development Build runs in iOS Simulator
32. Metro/Fast Refresh works there

**Physical iPhone**
- Local Apple Development signing identity configured and valid in Xcode
- Physical iPhone paired, Developer Mode enabled
- `npx expo run:ios --device` compiled and installed Interval successfully
- Development Build launches on the physical device and connects to Metro
- App runtime behaves normally on-device

**Environment separation**
33. This migration did not modify Staging or Production
34. No AWS resource changes occurred

## Confirmations

- No AWS/CDK/Lambda/API Gateway/Cognito/DynamoDB/S3 change was made or is required by this
  migration.
- No PDF viewer or PDF-related package (`react-native-pdf`, `react-native-blob-util`, or similar)
  was installed. Open Original's current OS share/open behavior is unchanged.
- `.env`/`app.config.ts` environment injection (`INTERVAL_ENV`, API base URL, Cognito region/pool
  ID/app client ID) is untouched — Development Build reads it exactly the same way Expo Go did.
