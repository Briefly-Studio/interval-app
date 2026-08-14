
# Interval

Interval is an offline-first mobile study app built with React Native and Expo. It centers on
flashcards, review, and quizzes, with a growing Library for organizing study sources, and optional
authenticated cloud continuity across devices. The app was formerly called Briefly — see "About the
name" below.

Every core study feature works fully offline, without an account. Signing in adds cloud backup,
cross-device sync, and account ownership on top of that — it is never required to use the app.

---

## Current capabilities

**Study**
- Create, edit, and delete decks and cards
- Flip-card review mode
- Multiple-choice quiz mode with a results screen and retry
- Study sessions with basic statistics (cards attempted, score)
- Difficulty tagging per card, with a difficulty-aware "smart shuffle" for review order
- Soft-delete/restore (Recently Deleted) for decks and cards, so accidental deletes are recoverable

**Organization**
- Deck Collections — local, user-created groupings of decks
- Library — a dedicated place to track study sources (title, type, tags, course, semester, and
  more) as metadata, separate from decks/cards
- Library source collections, with a root-vs-filed organizational model: a source appears at the
  Library root only until it's filed into a collection, then lives in that collection's own view

**Cloud (optional account)**
- Authentication via AWS Cognito (sign-up, sign-in, session restoration)
- Offline-first sync for decks, cards, and study sessions once signed in — local changes queue and
  sync when a connection is available, and converge correctly across devices
- Library metadata sync (sources and collections, including cross-device collection membership) —
  enabled for internal Development testing and the Staging/Beta environment; not yet enabled in
  Production
- Private original-file storage for Library sources — upload a source's original file to
  authenticated, per-account private cloud storage, and securely retrieve it on another
  signed-in device — also enabled for Development and Staging/Beta, not yet Production

**Accessibility and localization**
- English and Spanish throughout, including accessibility labels and hints
- A light/dark/warm appearance system
- Screen-reader-friendly controls, Reduce Motion support, and no information conveyed by color alone

---

## Offline-first model

Interval works fully without an account. A user can create and edit decks, create and edit cards,
and complete study sessions entirely offline, indefinitely.

Signing in with an authenticated account adds:
- cloud backup of local data
- cross-device synchronization
- account-based ownership and data isolation between users

Nothing about core local study functionality depends on being signed in.

---

## Tech stack

**Mobile client**
- React Native
- Expo
- Expo Router (file-based navigation)
- TypeScript

**Local persistence (client)**
- AsyncStorage for decks, cards, sessions, and Library metadata
- Expo SecureStore for auth tokens and device ID (native platforms only)
- Device-local file storage for durable copies of Library source originals

**Cloud (AWS)**
- Cognito — authentication and per-user identity
- API Gateway — HTTPS API surface
- Lambda (Node.js) — sync and source-storage backend logic
- DynamoDB — synced record/change storage
- S3 — private original Library source file storage
- AWS CDK (TypeScript) / CloudFormation — infrastructure as code for non-production environments

**Tooling**
- Node.js and npm (used for backend Lambda code and CDK infrastructure — not the mobile runtime)
- Git / GitHub

---

## High-level architecture

```
React Native / Expo client
        |
        |  HTTPS + Cognito JWT
        v
   API Gateway
        |
        v
     Lambda
     |      |
DynamoDB    S3
```

Infrastructure for non-production environments is defined as code:

```
AWS CDK (TypeScript)  →  CloudFormation  →  Development / Staging AWS resources
```

The client never talks to DynamoDB or S3 directly — every request goes through an authenticated
API Gateway route backed by a Lambda function, which derives the caller's identity from a verified
Cognito JWT rather than trusting anything the client sends.

---

## Environments

Interval runs three separate AWS environments:

- **Development** — the active engineering environment, managed with AWS CDK. Used for building
  and verifying new functionality before it goes anywhere else.
- **Staging/Beta** — also CDK-managed, used for broader validation ahead of production changes,
  with more conservative data-retention settings than Development.
- **Production** — the existing live environment. It predates the CDK-managed infrastructure and
  is intentionally not managed by CDK; any change to it requires explicit, deliberate approval.

No live URLs, account IDs, or resource identifiers are published here. See
[`docs/environment-separation-plan.md`](docs/environment-separation-plan.md) and
[`docs/cdk-infrastructure.md`](docs/cdk-infrastructure.md) for the full environment architecture.

---

## Platform support

The current beta is **iOS-first** — built, exercised, and tested primarily on iOS (device and
Simulator).

Android is a core target and builds from the same codebase with no platform-specific code paths
removed, but has not received the same testing depth as iOS yet.

Authenticated web support does not currently exist.

See [`docs/platform-scope.md`](docs/platform-scope.md) for the full, current platform-by-platform
breakdown.

---

## Repository structure

- **`app/`** — screens and navigation, using Expo Router's file-based routing
- **`src/`** — storage, sync, auth, domain logic, theming, and localization, organized by feature
- **`backend/`** — AWS Lambda source code for the sync and source-storage backend
- **`infra/`** — AWS CDK (TypeScript) infrastructure definitions for Development and Staging
- **`docs/`** — architecture and policy documentation (see below)
- **`assets/`** — images and static assets bundled with the app

---

## Documentation

- [`docs/platform-scope.md`](docs/platform-scope.md) — current platform support, per platform
- [`docs/sync-invariants.md`](docs/sync-invariants.md) — offline-first sync model and guarantees
- [`docs/environment-separation-plan.md`](docs/environment-separation-plan.md) — the
  Development/Staging/Production environment architecture
- [`docs/cdk-infrastructure.md`](docs/cdk-infrastructure.md) — implemented AWS CDK infrastructure
- [`docs/library-and-source-architecture.md`](docs/library-and-source-architecture.md) —
  Library and study-source architecture, current and planned
- [`docs/deck-collections.md`](docs/deck-collections.md) — Deck Collections design
- [`docs/accessibility-foundation.md`](docs/accessibility-foundation.md) — accessibility
  requirements and current status
- [`docs/branch-and-release-policy.md`](docs/branch-and-release-policy.md) — branch and release
  policy
- [`docs/development-build-workflow.md`](docs/development-build-workflow.md) — Expo Development
  Build setup and daily development workflow

---

## Development

Requirements: Node.js and npm.

```bash
npm install
cp .env.example .env   # then fill in real values for your target environment
npx expo start
```

`.env` is git-ignored and never committed; `.env.example` documents the shape of every value
required, without any real credentials or endpoints. Environment configuration determines which
backend the app talks to when signed in — it has no effect on offline/local-only usage.

Interval's development native runtime is an Expo Development Build, founder-QA verified on iOS
Simulator and physical iPhone. See
[`docs/development-build-workflow.md`](docs/development-build-workflow.md) for the full setup,
build/install steps, and daily workflow.

---

## About the name

Interval was previously called Briefly. All user-facing product surfaces — screens, alerts, share
sheets, and exported file names — say Interval today. Legacy `.briefly` deck export files remain
fully importable. A small number of internal, non-user-visible identifiers (local storage keys, a
few filenames) still reference the old name intentionally, to avoid breaking existing users' local
data — this does not affect the product experience.
