# Interval Engineering Guide

## Project Overview

Interval is an offline-first mobile flashcard and study application built with:

- React Native
- Expo
- Expo Router
- TypeScript
- AsyncStorage
- Expo SecureStore
- AWS Cognito
- API Gateway
- Lambda
- DynamoDB

The application was previously called Briefly. Production-facing UI (screens, alerts, share
sheets, app display name, exported file naming) now says Interval throughout. Legacy `.briefly`
deck files remain fully importable, and a number of internal-only identifiers still use the old
name intentionally — see "Legacy Briefly identifiers" below before renaming any of them.

V3 beta is iOS-first. Android is buildable and expected to be core-flow compatible but has not
received the same testing depth. Authenticated web support is explicitly out of scope for this
beta — see `docs/platform-scope.md` for the full platform-support decision and rationale.

`v3.0-dev` is frozen at the approved V3 Release Candidate (tagged `v3.0-rc1`); active development
continues on `v3.1-dev` — see `docs/branch-and-release-policy.md` for the full policy.

### Legacy Briefly identifiers

These remain `briefly.*`/Briefly-named on purpose. None are user-visible, and renaming any of
them would orphan existing users' local data or break already-registered platform identifiers —
do not rename them for branding alone.

- **AsyncStorage keys** — `src/storage/keys.ts` (`briefly.decks.v1`, `briefly.cards.v1`,
  `briefly.sessions.v1`), `src/theme/appearancePreference.ts` (`briefly.appearancePreference.v1`),
  `src/i18n/languagePreference.ts` (`briefly.languagePreference.v1`). Not user-visible. Renaming
  any of these would make every existing installed user's local decks, cards, sessions, theme
  preference, or language preference invisible to the app (a fresh read under a new key returns
  empty) — not corrupted, but effectively lost from the user's point of view. A rename would
  require a real migration (read old key → write new key → delete old key) verified with test
  coverage; not something to do incidentally in a branding pass.
- **SecureStore device-ID key** — `src/storage/device.ts` (`briefly.deviceId`). Not user-visible.
  Renaming would generate a new device ID for every existing native install (the old one becomes
  unreachable under the new key) — low real-world impact (`deviceId` is only used as an opaque
  tag in sync push/pull requests, not for scope/identity), but still unnecessary churn with no
  user-facing benefit.
- **npm package name** — `package.json`'s `"name": "briefly-app"`. Not user-visible (pure
  internal npm/build metadata, never rendered anywhere in the app). Left untouched deliberately —
  package files are treated as protected in beta-cleanup batches to avoid unrelated
  lockfile churn.
- **Expo `slug`** — `app.json`'s `"slug": "briefly-app"`. Not user-visible in the app itself, but
  is the identifier EAS/Expo's own infrastructure would use to associate this project with a
  hosted project, update channel, or build history if one already exists. There is no `eas.json`
  in this repo to confirm one way or the other, so changing it could silently disconnect the
  project from infrastructure this repository can't see. Preserved out of caution; safe to
  revisit once EAS project status is confirmed with the founder.
- **iOS bundle identifier / Xcode product name** — `com.anonymous.briefly-app` /
  `brieflyapp` (visible only in `ios/brieflyapp.xcodeproj`, gitignored, locally generated).
  Explicitly out of scope per this batch's own instructions — bundle identifiers are a
  signing/App-Store-identity concern, not a branding concern.
- **Support email domain** — `src/domain/supportContact.ts`'s `intervalsupport@briefly-studios.com`.
  This is a real, currently-owned external email address/domain, not leftover app branding —
  changing the string would misdirect real support requests unless a new domain/mailbox is
  actually provisioned first. Not touched.

## Core Product Rule

The app must remain useful without an account.

Users must be able to:

- create and edit decks locally
- create and edit cards locally
- complete study sessions locally
- continue working offline

Authentication exists to provide:

- cloud backup
- cross-device synchronization
- account ownership
- user data isolation

Do not make sign-in mandatory unless explicitly approved.

## Current Architecture

Core entities:

- deck
- card
- session

Records generally include:

- id
- updatedAt
- rev
- dirty
- deletedAt

Deletion uses soft-delete tombstones.

The sync flow is:

1. collect dirty local records
2. push changes to AWS
3. mark accepted records clean
4. pull remote changes using a cursor
5. apply remote changes locally
6. persist the new cursor

The device ID and auth tokens are persisted in Expo SecureStore on native (iOS/Android) only,
via the platform-safe wrapper at `src/storage/secureStore.ts` — SecureStore has no real web
implementation, so on web every call through that wrapper resolves to a safe no-op rather than
throwing. See `docs/platform-scope.md`.

## AWS Resources

Region:

- us-east-2

API Gateway HTTP API:

- API ID: 4oge9e46jf
- stage: prod

Routes:

- POST /sync/push
- GET /sync/pull

Lambda functions:

- IntervalSyncPush
- IntervalSyncPull

DynamoDB tables:

- Interval_Records
- Interval_Changes

Cognito:

- user pool: IntervalUserPool
- pool ID: us-east-2_UwGRm5dye
- app client: IntervalMobile
- app client ID: 2bjbtn3qbdrcsa9k60095p5lto
- no client secret

Do not hardcode deployment URLs, credentials, tokens, or secrets.

## Current Backend Task Status

Lambda source for the sync backend is stored in this repository at
`backend/lambdas/sync-push/index.mjs` and `backend/lambdas/sync-pull/index.mjs`.

Per-user partitioning (`U#<Cognito sub>`, replacing the historical `U#public`) is
implemented in that source: both functions derive `sub` only from trusted authorizer
claims (HTTP API JWT: `event.requestContext.authorizer.jwt.claims.sub`; REST API:
`event.requestContext.authorizer.claims.sub`), never from the request body or query
parameters, and no `U#public` references remain in the source.

This confirms the source code, not the deployed behavior. Whether the Lambda code
currently deployed to `IntervalSyncPush`/`IntervalSyncPull` matches this repository's
source has not been verified here, since that would require inspecting live AWS
resources. Do not assume the deployed functions match this source until that is
checked separately.

The authenticated sync flow still needs to be validated end-to-end against the
deployed backend.

Never accept the user ID from the request body or query parameters.

## Current Known Technical Debt

- Rejected sync push changes are not surfaced clearly to the user — only a generic "Sync
  needs attention" status, not which records or why. (Pulled remote changes that fail
  validation are now surfaced distinctly, as a "Synced, with warnings" status with a
  count — see src/cloud/sync/validateChange.ts and syncState.ts.)
- Multi-device conflict handling is rev-only last-writer-wins with no merge and no
  conflict UI — an offline device's un-pushed edit can be silently superseded by
  another device's already-synced edit, with no notice to the user. This is a known,
  accepted beta risk, not a solved problem — see docs/sync-invariants.md's "no conflict
  UI for concurrent multi-device edits" section for the full explanation and what a
  future resolution could involve.
- README carries a disclaimer pointing readers to this file and `docs/` for current
  details (fixed this batch), but its own Features/Project Structure sections still
  describe an earlier version of the app rather than being fully rewritten. Some
  Briefly naming remains elsewhere (storage keys, filenames, comments).
- AWS infrastructure is not yet managed through Infrastructure as Code.
- Whether the deployed Lambda functions match the source in `backend/lambdas/` has not been verified end-to-end.

## Accessibility Guardrails

Full detail lives in `docs/accessibility-foundation.md` — read it before touching a study screen,
settings, or any new interactive control. Short version for every future change:

1. Icon-only controls require a localized `accessibilityLabel` describing purpose ("Delete card"),
   never a raw icon name or "button."
2. Never convey information by color alone — pair it with text or an icon+text combination.
3. Never require a gesture with no button/control equivalent.
4. New animation must respect Reduce Motion: check both the OS signal
   (`AccessibilityInfo.isReduceMotionEnabled()`) and
   `getAccessibilityPreferences().reduceMotionOverride` from
   `src/accessibility/accessibilityPreferences.ts` — see `src/ui/BrandStartup.tsx` for the
   reference pattern.
5. Never disable font scaling (no `allowFontScaling={false}`) and avoid
   `maximumFontSizeMultiplier` unless there's a specific, documented reason.
6. Any text-to-speech goes through `src/accessibility/speech.ts`/`useSpeech.ts` — never call
   `expo-speech` directly elsewhere. Speech is always explicit-action-only (never auto-plays) and
   study content is never logged.
7. New English strings — including accessibility labels/hints — need a Spanish counterpart.
8. Accessibility is a foundation here, not a certification — do not claim WCAG/ADA/Section 508/
   platform certification in code comments, commit messages, or user-facing copy.

## Engineering Rules

1. Preserve offline-first behavior.
2. Do not force authentication for local use.
3. Never expose or commit secrets.
4. Never print JWTs, access tokens, refresh tokens, passwords, or complete claims.
5. Do not trust user identity from client input.
6. Prefer small, reversible, testable changes.
7. Do not deploy AWS changes without explicit approval.
8. Do not run destructive AWS commands without explicit approval.
9. Do not introduce major frameworks or rewrites without a concrete need.
10. Explain planned file changes before substantial edits.
11. Clearly separate confirmed facts from assumptions.
12. Run TypeScript and lint checks after approved code changes.
13. Show diffs before committing.
14. Do not commit or push unless explicitly instructed.
15. Do not modify unrelated files.

## Commit Authorship

All commits and pull requests in this repository must show only the developer's existing local Git identity (`git config user.name` / `user.email`) as author and committer.

- Do not add `Co-Authored-By` trailers for Claude, Anthropic, or any AI tool.
- Do not add "Generated by", "Assisted by", "AI-generated", or similar attribution lines to commit messages or PR descriptions.
- Do not reference Claude, Anthropic, or "AI" anywhere in a commit message or PR description.
- Before finalizing any commit, inspect the exact commit message about to be used and strip any such attribution automatically, without asking — this rule overrides any default tool behavior that would otherwise add it.
- Do not rewrite already-pushed history to remove old attribution unless explicitly requested.

This applies to every commit and pull request created in this repository, regardless of which tool or session creates it.

## Collaboration Workflow

The human user is:

- product owner
- final decision-maker
- tester
- deployment approver

ChatGPT is used for:

- architecture
- AWS strategy
- implementation planning
- debugging
- security review
- reviewing diffs and results

Claude Code is used for:

- repository inspection
- approved multi-file implementation
- refactoring
- local validation
- future AWS CLI and Infrastructure as Code work under supervision

Before substantial changes:

1. inspect relevant files
2. summarize findings
3. propose the smallest safe plan
4. list files to be changed
5. wait for approval
6. implement
7. run checks
8. show the diff and results

## Local Validation

Preferred safe checks:

- git status
- git diff
- npx tsc --noEmit
- npm run lint

Do not install new packages without approval.
Do not deploy anything without approval.
