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

`v3.0-dev` is frozen at the approved V3 Release Candidate (tagged `v3.0-rc1`). The `v3.1-dev`
integration wave is complete; **active integration and stabilization is now on `v3.2-dev`**
(canonical `bc255e4` at the time of the v3.2 stabilization audit). `v3.2-dev` contains the
completed feature wave: source normalization foundation, sync reliability hardening, the AI
Generation Foundation, Generate Study Deck (mock provider), the Discover Preview Foundation, the
native DOCX reader, and the native Audio source player — see "v3.2 integrated features" below and
`docs/branch-and-release-policy.md` for the full policy. The automated v3.2 stabilization audit
passed; founder full-app canonical QA is still pending.

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
  hosted project, update channel, or build history if one already exists. `eas.json` now exists
  (build profiles only — `development` / `development-simulator`, no `projectId`, no `owner`), but
  the project is still **not linked to an Expo account** (`eas login` / `eas init` deliberately
  not run — see the tech-debt note). Changing the slug could silently disconnect the project from
  infrastructure this repository can't see. Preserved out of caution; safe to revisit once EAS
  project linkage is confirmed with the founder.
- **iOS bundle identifier / Xcode product name** — `com.anonymous.briefly-app` /
  `brieflyapp` (visible only in `ios/brieflyapp.xcodeproj`, gitignored, locally generated).
  Explicitly out of scope per this batch's own instructions — bundle identifiers are a
  signing/App-Store-identity concern, not a branding concern.
- **Support email domain** — `src/domain/supportContact.ts`'s `intervalsupport@briefly-studios.com`.
  This is a real, currently-owned external email address/domain, not leftover app branding —
  changing the string would misdirect real support requests unless a new domain/mailbox is
  actually provisioned first. Not touched.

## Documentation Hierarchy

For anything not covered directly in this file, these are the authoritative documents, in order:

1. `CLAUDE.md` (this file) — repository guardrails and implementation rules.
2. `docs/branch-and-release-policy.md` — branch/release/environment policy.
3. `docs/environment-separation-plan.md` — the Development/Staging/Production AWS environment
   architecture. **Development and Staging are now deployed and live; Production remains the
   existing grandfathered baseline outside CDK** — see that document's §16 for exact phase status.
4. `docs/aws-current-state-audit.md` — live-confirmed Production AWS resource inventory (2026-08-08
   audit, predates Development/Staging's existence — scoped to Production only).
5. `docs/environment-config-contract.md` — the implemented client/repository environment-identity
   and public config contract (`INTERVAL_ENV` and related). Client-side only — see the document's
   own "Current status" section for which environments it can now reach for real.
6. `docs/cdk-infrastructure.md` — the implemented AWS CDK Development and Staging stacks
   (`infra/`), both deployed and founder-QA verified. Production is not managed by CDK — see that
   document's own status line and "Production grandfathering" section.
7. `docs/platform-scope.md` — currently supported platforms and beta boundaries.
8. `docs/accessibility-foundation.md` — accessibility requirements, current and future.
9. `docs/library-and-source-architecture.md` — Library and source architecture. **Substantially
    implemented in Development and Staging**: local metadata/UI (every environment/guest),
    cross-device metadata sync, private original-file storage, and source open/preview are all
    deployed and founder-QA verified in both Development and Staging — see the document's own
    "Implementation status" section for the exact current/future split. Production remains
    grandfathered and has not received cloud metadata sync or private source storage. Embedded
    local readers for PDF / image / text / DOCX and the Audio player **are now implemented** (see
    items 19–24). Real provider-backed AI generation, OCR/transcription, in-platform sharing, and
    Canvas integration remain specification-only.
10. `docs/library-ui-foundation.md` — the implemented local-only Library UI foundation.
11. `docs/library-cross-device-diagnosis.md` — historical diagnosis document. Accurate when
    written (Library metadata had no transport mechanism at all); now superseded for Development
    and Staging builds, where Library metadata sync is implemented and founder-QA verified — still
    accurate as written for Production and guests, where Library metadata remains local-only.
12. `docs/library-cloud-sync-contract.md` — the Library metadata cloud sync contract.
    **Implemented and founder-QA verified end-to-end in Development and Staging.**
13. `docs/canvas-companion-spec.md` — future Canvas integration and reminder architecture.
    **Specification only — not implemented.**
14. `docs/sync-invariants.md` — current offline-first sync invariants.
15. `docs/deck-ordering.md` — the implemented canonical, deterministic deck ordering rule.
16. `docs/deck-collections.md` — the implemented local-only Deck Collections foundation.
17. `docs/v3-beta-release-checklist.md` — current verification/QA state.
18. `docs/development-build-workflow.md` — the Expo Development Build migration. **Founder-QA
    verified on iOS Simulator and physical iPhone** — this is now the active development native
    runtime; see that document for the full record and EAS Build's separate, still-inactive status.
19. `docs/source-normalization-foundation.md` — the provider-neutral `NormalizedSourceContent`
    layer (`src/domain/normalization/`). **Implemented and integrated into `v3.2-dev`.**
20. `docs/ai-generation-foundation.md` — the provider-neutral, provenance-aware AI service
    contract and boundary (`src/domain/ai/`). **Implemented and integrated into `v3.2-dev`;
    mock provider only** — no real provider SDK, prompt, network AI call, or deployed AI backend.
21. `docs/generate-study-deck-ux.md` — the Library Source → Generate Study Deck workflow.
    **Implemented, founder-QA verified, integrated into `v3.2-dev`; `[MOCK]` output only**, gated
    to Development/Staging (hidden in Production).
22. `docs/discover-preview-foundation.md` — the bounded fixture-based Discover preview.
    **Implemented, founder-QA verified, integrated into `v3.2-dev`; local-only, no backend, and
    currently NOT environment-gated** — see "Discover" below.
23. `docs/docx-reader.md` — the native/client-only DOCX reader (`fflate`, structured blocks,
    deterministic wide-table layout). **Implemented, founder-QA verified, integrated into
    `v3.2-dev`.**
24. `docs/audio-source-player.md` — the `expo-audio` playback-only Audio source player.
    **Implemented, founder native-runtime QA verified, integrated into `v3.2-dev`; playback-only,
    no recording, no background audio.**

Historical version documents (`docs/versions/*.md`, `docs/v2.0_kickoff.md`) remain historical and
must never be treated as, or edited to look like, current specifications — see each file's own
dating for why. Current-facing documentation and in-app copy use Interval branding throughout,
except where legacy `.briefly` compatibility is being explicitly explained (see "Legacy Briefly
identifiers" above).

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

### Library (local metadata foundation, plus Development/Staging private source storage)

`app/library/**` implements a Library UI foundation — local-only metadata for every guest/
Production build, with Development-and-Staging cloud metadata sync and Development-and-Staging
private original-file storage layered on top. See `docs/library-ui-foundation.md`,
`docs/library-and-source-architecture.md`'s "Implementation status" section, and
`docs/cdk-infrastructure.md`'s "Library source storage" section for what is and is not implemented
and deployed. Guardrails when touching this area:

- **Root Library organization rule** (local-only, every environment/guest — no gating): the root
  Library screen shows only sources with zero *active* collection memberships ("unfiled"); a filed
  source lives only inside its collection's own detail view
  (`app/library/collections/[id].tsx`), never duplicated on root. Computed by
  `src/domain/libraryOrganize.ts`'s `getUnfiledLibrarySources` — never re-introduce a "filter by
  collection" chip on the root screen (it was deliberately removed: once root is unfiled-only, that
  filter would always show zero results). This rule must never apply to Archived or Recently
  Deleted — Collection Detail only ever queries active sources, so an archived-and-filed source
  would become unreachable from anywhere if Archived also hid filed sources. See
  `docs/library-and-source-architecture.md`'s "Root Library rule" before changing this.
- **Private source storage (`src/cloud/librarySourceStorage/**`, Development and Staging)**: gated
  by its own separate capability check, `isLibrarySourceStorageEnabled()`
  (`src/cloud/librarySourceStorage/capability.ts`) — deliberately NOT the same gate as
  `isLibraryMetadataCloudSyncEnabled()`, since metadata sync and file storage are independent
  capabilities that may roll out to Production on a different schedule than each other. Do not
  merge these two gates. A device-local file URI must NEVER be added to `LibrarySourceRecord` or
  any other synced type — it lives only in `src/storage/librarySourceLocalFiles.ts`, a completely
  separate, unsynced storage key; see that file's header comment before changing this. That URI must always
  point into Interval's own durable `documentDirectory`-backed copy
  (`src/storage/librarySourceFileStorage.ts`), never the raw `DocumentPicker`
  `copyToCacheDirectory` URI directly — the OS is free to purge its cache directory at any time
  while the app isn't running, which is not durable enough for a `pending` upload that may sit for
  hours or days; see that file's header comment before changing the persistence directory or key
  scheme. The backend Lambda
  (`backend/lambdas/library-source-storage/index.mjs`) and its dedicated IAM role
  (`infra/lib/interval-sync-stack.ts`) must never be granted `s3:DeleteObject` — this batch never
  deletes a cloud original on metadata tombstone, by design (see
  `docs/library-and-source-architecture.md`'s "Delete behavior"). See that same doc's "Private
  source storage architecture" section before changing object-key derivation, IAM scope, or the
  upload state machine.
- **Source open/preview (`src/cloud/librarySourceStorage/openSource.ts`,
  `src/domain/sourceViewer.ts`)**: Source Detail's "Open original" action must go through
  `openSourceOriginal` only — never let a screen call `downloadSourceOriginal`, `expo-sharing`, or
  raw filesystem APIs directly. Local resolution always comes first (`getPersistedSourceFileUri`);
  a cloud download only happens on an explicit user tap, never automatically during sync. A
  cloud-downloaded original is deliberately committed to the SAME canonical
  `src/storage/librarySourceFileStorage.ts` path local attach uses (not a second directory) so it
  becomes durably available for future offline opens — see
  `docs/library-and-source-architecture.md`'s "Source open/preview" section for the retention
  reasoning and its known, deferred eviction-policy limitation. Never gate the "Open original"
  action on `cloudUploadState === "uploaded"` alone — a source with a local copy must remain
  openable regardless of upload state. Viewer handoff uses `expo-sharing` (already installed,
  already used by `app/deck/[id]/export.tsx`) — do not add a PDF-rendering or WebView-based
  dependency for this without a concrete, founder-approved need. The canonical durable file stays
  extensionless (`librarySourceFiles/<sourceId>`) — do not hand its URI to `Sharing.shareAsync`
  directly; iOS's share sheet/Quick Look determines file type primarily from the URL's extension,
  not from `mimeType`/`UTI` hints alone (founder-QA-proven). `openSourceFile` must always route
  through `prepareViewerCopy` (`src/storage/librarySourceFileStorage.ts`) to get a short-lived,
  extension-bearing copy first; never rename/move the canonical file itself, and never derive the
  extension from `originalName` or any other user-supplied string — only from the small, hardcoded
  table in `src/domain/sourceViewer.ts`.

- `LibrarySourceRecord` (`src/models/librarySource.ts`) is metadata only. Never add a field that
  could hold a file URI, binary content, extracted text, or AI-generated content without an
  explicit founder decision — that is real product-architecture work, not a small addition.
- Storage keys are `interval.librarySources.v1` / `interval.sourceCollections.v1`
  (`src/storage/libraryKeys.ts`), scoped through the existing `scopedKey(WorkspaceScope, ...)`
  mechanism — same guest-vs-`user:<sub>` local partitioning as decks/cards. Do not bypass this
  scoping or introduce a device-wide Library store.
- There is no cloud Library record with a separate `ownerId` field — ownership is Cognito `sub`
  from trusted authorizer claims only, exactly like decks/cards/sessions, never from client input.
- **Library metadata cloud sync (`librarySource`/`sourceCollection`) is implemented and
  founder-QA verified end-to-end in Development and Staging** (physical iPhone via Expo Go/
  Development Build + iOS Simulator — see `docs/library-cloud-sync-contract.md`'s status note for
  the full verified checklist), gated to Development and Staging, in
  `src/cloud/sync/SyncService.ts`/`types.ts`/`validateChange.ts` plus
  `src/cloud/sync/libraryMetadataSyncCapability.ts`. No backend Lambda or AWS resource changed for
  this feature (the existing sync backend was already entity-agnostic). Do not widen
  `ALLOWED_ENVIRONMENTS` in `libraryMetadataSyncCapability.ts` beyond `development`/`staging`
  without explicit founder approval — this is the single centralized gate; do not add a second,
  scattered `INTERVAL_ENV` check elsewhere for this feature. Source binaries/content are still
  never synced anywhere — only the metadata fields already on
  `LibrarySourceRecord`/`SourceCollectionRecord` (private source-file storage is separate work,
  implemented and deployed to Development and Staging — see the "Private source storage" guardrail
  above).

### Deck Collections (local-only foundation)

`app/deck-collections/**` implements a **local-only** Deck Collections foundation — see
`docs/deck-collections.md` for full detail. Not the same feature as Library Source Collections
(`src/models/sourceCollection.ts`) — do not conflate the two in code, docs, or copy. Guardrails:

- `DeckCollectionRecord` (`src/models/deckCollection.ts`) tracks deck membership on its own
  `deckIds` field. **Never add a collection reference to `DeckRecord`** (`src/models/deck.ts`) —
  decks already participate in the live Production sync path (`src/cloud/sync/SyncService.ts`
  pushes the entire deck record whenever `dirty`), so any field added there reaches Production the
  next time any signed-in user syncs. Deck Collections were deliberately designed to avoid this by
  keeping membership on the collection side instead — see `docs/deck-collections.md`'s "Why
  collection-owned membership, not a `DeckRecord` field" section before changing this.
- Storage key is `interval.deckCollections.v1` (`src/storage/deckCollectionKeys.ts`), scoped
  through the existing `scopedKey(WorkspaceScope, ...)` mechanism — same convention as decks/cards
  and Library. Do not bypass this scoping.
- No cloud Deck Collection record, no `ownerId`, no Cognito authorization check anywhere in this
  code, and Deck Collections are not wired into `src/cloud/sync/**` — see `docs/deck-collections.md`'s
  "Future cloud sync" section for what a future implementation must satisfy before this changes.
- **Add never implicitly moves a deck between collections.** The Add Decks picker
  (`app/deck-collections/[id]/add.tsx`) must only ever offer unfiled decks
  (`getUnfiledDecks` in `src/domain/deckCollectionMembership.ts`) — never a deck already in this
  or another collection. Moving an already-assigned deck is its own explicit action ("Move to
  collection", `app/deck/[id]/move-to-collection.tsx`). Do not reintroduce "select any deck,
  silently reassign it" behavior into Add — see `docs/deck-collections.md`'s "Interaction model"
  section for why this was deliberately changed after founder QA.

## v3.2 integrated features

All of the following were reconciled onto the current canonical tree and integrated into
`v3.2-dev` (each via its own `--no-ff` merge). None of them changed any AWS resource, `infra/`
stack, or backend Lambda. Each has its own doc (see items 19–24 of the Documentation Hierarchy).

### Source Normalization Foundation (`src/domain/normalization/`)

Provider-neutral `NormalizedSourceContent` — a common shape (`chunks`, location metadata,
`fullSourceIncluded`, `excludedChunkCount`) that PDF / text / image / DOCX / audio adapters all
produce, so AI features consume one representation instead of format-specific code. **Implemented
and integrated.** Pure domain code, no network, no AWS. The image and audio adapters are
structural stubs — real OCR/transcription is not implemented.

### AI Generation Foundation (`src/domain/ai/`) — mock provider only

A provider-neutral, provenance-aware `ModelProvider` seam plus `generateStudyDeck()`,
`validateGeneratedDeckResponse()`, and `prepareGenerationContext()`. **Implemented and
integrated.** The only provider is `createMockProvider()` (`mock-v1`, deterministic, `[MOCK]`
prefixes). **There is no real model provider, no provider SDK, no prompt, and no network AI
call.** A reference backend Lambda (`backend/lambdas/ai-generate-study-deck/`) exists as a
contract stub but is **not referenced in `infra/` and not deployed** — it imports no provider SDK
and never reads a credential from the request. **The mobile client must never hold a provider
key or secret.** Real provider-backed generation is a separate, founder-gated future change.
`npm run test:ai` — 20 tests.

### Generate Study Deck (`app/library/[id]/generate/**`) — `[MOCK]` output, gated

Library Source → Generate → choose options → review draft → edit/delete cards → edit title →
explicit Save → real `DeckRecord` + `CardRecord`s via the normal `addDeck`/`setCards` path (so a
generated deck syncs exactly like any hand-made deck; **never add a source-origin field to
`DeckRecord`** — Production sync path). **Implemented, founder-QA verified, integrated.** Gated by
`isGenerateStudyDeckEnabled()` (`src/domain/ai/generateStudyDeckCapability.ts`) to
`["development","staging"]` — **hidden in Production**. Do not widen that allow-list without
explicit founder approval, and do not add a second scattered `INTERVAL_ENV` check for it.
Safeguards to preserve: captured `sourceScope` + `sameScope` re-checks (stale scope blocks save),
screen-level `savingRef`/`savedRef` and domain-level `saveInFlight` duplicate-save guards, typed
non-throwing `SaveDraftOutcome`, deck rollback if card persistence fails, route/session id
verification, discontiguous provenance ranges preserved (adjacent/overlapping merged), final
`validateDraftForSave`, `[MOCK]` labels expected.

### Discover Preview Foundation (`app/discover/**`) — local-only, currently ungated

A bounded microlearning preview: 10 English fixture lessons (`src/content/discoverLessons.ts`),
a finite 7-lesson session budget, a calm stop state, local bookmarks and per-workspace progress
(`interval.discoverProgress.v1` via `scopedKey`), Generate-from-Discover disabled ("coming
soon"). **Implemented, founder-QA verified, integrated.** **No AI, no network, no content
backend, no cost.** Not wired into `src/cloud/sync/**` — progress is local-only everywhere (same
posture as Deck Collections). Lesson *bodies* are explicitly English-only and pinned LTR; the
chrome follows the active locale. **Discover currently has NO `INTERVAL_ENV` gate** — it is
visible in a Production build. This is safe (local-only, no backend/cost) but whether it should
ship visible in Production is a **founder product decision that is still pending** — do not add a
gate or make that call without the founder.

### Embedded source readers — PDF / image / text / DOCX / Audio (local, client-only)

`app/library/[id]/reader.tsx` + `src/domain/sourceReader.ts` is the single centralized
capability model. `resolveSourceReaderStrategy(source)` maps `sourceType` → one mutually
exclusive strategy: `pdf-reader`, `image-reader`, `text-reader`, `docx-reader` (only when the
resolved extension is `docx`), `audio-player`, else `unsupported`. Every kind has its own render
branch and is reachable; `docx-reader` is the render chain's final fallthrough. Unsupported
sources (video, `.xlsx`, `.pptx`, legacy `.doc`, encrypted DOCX, …) offer only "Open original"
(OS handoff via `expo-sharing`).

- **PDF**: `react-native-pdf` native view (pre-v3.2).
- **image / text**: native `<Image>` / chunked FlatList (pre-v3.2).
- **DOCX**: `fflate` 0.8.3, on-device structured parse, native rendering, no WebView, no cloud
  conversion, deterministic wide-table layout (120 dp minimum column, wide tables horizontally
  scroll as one unit). See `docs/docx-reader.md`. `npm run test:docx` — 11 tests.
- **Audio**: `expo-audio ~1.1.1` + `expo-asset ~12.0.13`, **playback-only** (no recording, no
  microphone permission, no background audio — `shouldPlayInBackground: false`), local source
  resolution, play/pause/seek/speed, cleanup on navigation. `sourceType: "audio"` is decided by
  audio MIME/extension or manual selection — **video is never treated as audio**, and **file
  size never affects classification or reader selection**. `audio` is `uploadSupported: false`
  (no cloud audio anywhere). See `docs/audio-source-player.md`. No dedicated test suite yet.

Do not add a WebView, a cloud/document-conversion service, an AI-based renderer, a video reader,
or a real AI provider to any of this without an explicit, founder-approved need.

## AWS Resources

Named by resource/role, not by live identifier — live IDs are unnecessary coupling that goes
stale easily and are never required to work in this repository; retrieve them from the deployed
stack outputs (`docs/cdk-infrastructure.md`) or `.env` when actually needed, never from this file.

Region (all environments): `us-east-2`.

**Production baseline** (grandfathered, not CDK-managed — see "Environment Safety" below):

- API Gateway HTTP API: `IntervalSyncApi`, stage `prod`, routes `POST /sync/push` and
  `GET /sync/pull`
- Lambda functions: `IntervalSyncPush`, `IntervalSyncPull`
- DynamoDB tables: `Interval_Records`, `Interval_Changes`
- Cognito user pool: `IntervalUserPool`; app client: `IntervalMobile` (no client secret)

Development and Staging resource names follow the same shape with `interval-dev-*`/
`interval-staging-*` prefixes — see `docs/cdk-infrastructure.md`'s "Development resource names"
and "Staging resource names" sections for the complete, current list.

Do not hardcode deployment URLs, account IDs, ARNs, bucket names, credentials, tokens, or secrets
anywhere in this repository.

## Current Backend Task Status

Lambda source for the sync backend is stored in this repository at
`backend/lambdas/sync-push/index.mjs` and `backend/lambdas/sync-pull/index.mjs`.

Per-user partitioning (`U#<Cognito sub>`, replacing the historical `U#public`) is
implemented in that source: both functions derive `sub` only from trusted authorizer
claims (HTTP API JWT: `event.requestContext.authorizer.jwt.claims.sub`; REST API:
`event.requestContext.authorizer.claims.sub`), never from the request body or query
parameters, and no `U#public` references remain in the source.

**Development and Staging: verified, not just source-confirmed.** Both stacks' Lambdas are
packaged directly from this repository's `backend/lambdas/**` source via CDK (`lambda.Code.fromAsset`),
so deployed code is this source by construction, and the authenticated sync flow (fresh account,
sign-up/sign-in, deck/card creation, repeated Force Resync, cross-device convergence on physical
phone + Simulator) has been founder-QA verified end-to-end against both environments. The Library
source-storage Lambda's source-id validator was corrected and redeployed to Development during
founder QA (see "Library" below) — do not assume any other repository source change to
`backend/lambdas/**` is automatically live in Development/Staging without a redeploy.

**Production is a separate question.** Production is not CDK-managed and was never deployed from
this repository's `backend/lambdas/**` source — whether its live Lambda code matches this
repository's source has not been verified here, since that would require inspecting live
Production AWS resources. Do not assume Production's deployed functions match this source.

Never accept the user ID from the request body or query parameters.

## Environment Safety

**The three-environment architecture is now operational.** Interval runs three separate AWS
environments in `us-east-2`:

- **Production** — the existing, grandfathered baseline (see "AWS Resources" above). Live before
  this architecture existed, untouched by it, and still **not managed by CDK** — never imported,
  renamed, or recreated. Protected from routine development work; changes require explicit
  founder approval every time (see the guardrails below).
- **Development** (`IntervalDevelopmentStack`, `infra/`, `docs/cdk-infrastructure.md`) — deployed
  and founder-QA verified end-to-end: fresh Cognito account creation, sign-up/sign-in, repeated
  Force Resync, deck/card creation and sync, and cross-device (phone + simulator) consistency all
  confirmed working, with Production confirmed isolated throughout. For active engineering/testing
  — its DynamoDB tables and Cognito pool use a disposable `DESTROY` removal policy on purpose.
- **Staging/Beta** (`IntervalStagingStack`, same `infra/` project) — deployed and founder-QA
  verified end-to-end with the identical checklist as Development. For **external beta-tester
  validation before Production** — its DynamoDB tables and Cognito pool use `RemovalPolicy.RETAIN`
  plus Cognito deletion protection, deliberately different from Development, because real external
  beta-tester accounts/data may exist there. See `docs/cdk-infrastructure.md`'s "Staging
  removal/deletion policy" before ever changing this in code.

The authoritative plan is `docs/environment-separation-plan.md` (§16 tracks phase-by-phase status
— Phases A through F are now complete); the founder-performed, read-only CloudShell audit
(2026-08-08) that originally confirmed Production's live state, before Development/Staging
existed, is recorded in `docs/aws-current-state-audit.md`. The client/repository-side
`INTERVAL_ENV` config contract (`docs/environment-config-contract.md`) is implemented and now has
two real, live AWS environments to point at (`development`, `staging`) in addition to Production —
the founder currently switches between them by hand-editing the single gitignored local `.env`;
no per-environment env files or switching scripts exist, by design, for now.

**What "operational" does and does not mean:** infrastructure deployed successfully and app-level
founder QA passed for both Development and Staging — that is what's complete. It does **not** mean
either environment is fully hardened. Known, deliberately-deferred hardening work: DynamoDB
point-in-time recovery (PITR) remains off in all three environments and its own future enablement
is a separate decision, not a defect; the CDK `pointInTimeRecovery` API is deprecated in favor of
`pointInTimeRecoverySpecification` (a synth-time warning, not a functional issue) and remains
unaddressed cleanup work; Production is still not managed by CDK, by design, pending its own
future, separate, explicit decision (see `docs/cdk-infrastructure.md`'s "Production
grandfathering"). None of this blocked closing out the three-environment milestone.

- No Production AWS mutation without explicit founder approval, every time — a prior approval does
  not carry forward to a new mutation.
- Before any AWS write, identify the exact target environment and resource by name — never infer
  it from context or from whatever the CLI happens to be configured for.
- Read-only AWS inspection (`get`/`describe`/`list` calls) may be used freely to verify live state;
  mutating calls (`create-*`/`update-*`/`delete-*`/`put-*`/deploy) require the explicit approval
  above.
- Never assume Production's deployed Lambda matches this repository's `backend/lambdas/**`
  source — that has not been verified end-to-end and Production is not CDK-managed, so there is no
  build-time guarantee either (see "Current Backend Task Status"). Development and Staging don't
  have this problem — their Lambdas are packaged directly from this repository's source by CDK.
- Future environment-specific values (table names, pool IDs, bucket names) come from configuration
  injected per environment, never from a code fork or an environment-specific branch of logic.
- Library (`app/library/**`) private source-file storage is implemented, deployed, and founder-QA
  verified in Development and Staging (see "Library" guardrails above and
  `docs/library-and-source-architecture.md`'s "Private source storage architecture") — Production
  remains local metadata only, with no source-storage AWS resource of any kind. Widening source
  storage or metadata sync to Production requires explicit founder approval, every time, same as
  any other environment-boundary change in this file.

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
- Production AWS infrastructure is not yet managed through Infrastructure as Code, and this
  remains true by design (see "Production grandfathering" in `docs/cdk-infrastructure.md`) — the
  Development and Staging CDK stacks (`infra/`) are both deployed and live, but Production is not
  imported or managed by CDK, and there is no current plan to change that without a separate,
  explicit founder decision.
- DynamoDB point-in-time recovery (PITR) remains disabled in Development, Staging, and Production
  — a deliberate, separate future hardening decision, not an oversight of the environment
  separation milestone. The CDK `pointInTimeRecovery` API used in `infra/lib/interval-sync-stack.ts`
  is itself deprecated in favor of `pointInTimeRecoverySpecification` (a `cdk synth`-time warning
  only, not a functional issue) — remains unaddressed cleanup work.
- No broad app-level / end-to-end / UI automated test harness exists — all app-flow verification
  is manual founder QA plus local static checks (`tsc`, lint, `cdk synth`). What automated
  coverage does exist is three focused, zero-dependency `node --test` suites of pure-logic unit
  tests (70 tests total), not full application coverage:
  - `npm run test:sync` (39) — sync push/pull helpers (`backend/lambdas/sync-{push,pull}/lib.test.mjs`),
    also covering the client push helpers in `src/cloud/sync/pushHelpers.mjs`.
  - `npm run test:ai` (20) — AI foundation helpers (`src/domain/ai/*.test.ts`,
    `backend/lambdas/ai-generate-study-deck/*.test.mjs`) via `scripts/ai-test-loader.mjs`.
  - `npm run test:docx` (11) — the pure `computeDocxTableLayout` table-sizing helper
    (`src/domain/docxTableLayout.test.ts`).
  There is no Audio-specific suite yet (`src/domain/sourceAudioPlayer.ts`'s pure helpers are a
  reasonable future `test:audio`), and no automated coverage of the DOCX parser or any RN
  rendering.
- Development/Staging sync Lambdas were raised from `128 MB / 3 s` to `256 MB / 15 s` after a
  confirmed 2026-08 Development incident (`interval-dev-sync-push` timing out at exactly 3000 ms
  on every invocation → `Http500`), then further hardened after an independent audit of that
  fix: client-side **sequential push chunking** (`PUSH_BATCH_SIZE`, so a backlog over the
  server's `MAX_CHANGES_PER_PUSH` no longer deadlocks), **`{entity, id}` acknowledgement
  identity** in the push response (an `id` alone is not unique across entity types), and a
  **`SK`-derived pull cursor** (a legacy row missing the `changeKey` attribute no longer wedges
  the pull). See `docs/cdk-infrastructure.md`'s "Sync Lambda sizing incident (2026-08)".
  Remaining lower-priority item: whether Production's grandfathered `128 MB / 3 s` sync Lambdas
  need the same sizing change (separate, founder-gated). **Rollback for any of this is
  redeploy-the-previous-revision, never `cdk destroy IntervalDevelopmentStack`** (that is an
  environment teardown that deletes Development's Cognito accounts + DynamoDB data).
- `expo-doctor` reports a known, accepted 17/18 due to 7 packages sitting one SDK patch version
  behind (`expo`, `expo-file-system`, `expo-font`, `expo-linking`, `expo-router`,
  `expo-splash-screen`, `expo-web-browser` as of the v3.2 stabilization audit) — tracked, not a
  regression each time it's re-confirmed. `expo-audio` / `expo-asset` (added in v3.2) are **not**
  flagged.
- Whether Production's deployed Lambda functions match this repository's `backend/lambdas/`
  source has not been verified end-to-end (Production is not CDK-managed, so there is no
  build-time guarantee the way there is for Development/Staging — see "Current Backend Task
  Status" above). Development and Staging are not affected by this — their Lambdas are packaged
  directly from this repository's source and have been founder-QA verified end-to-end.
- Library metadata (sources and collections) cross-device sync is implemented and founder-QA
  verified in **Development and Staging** — a Production build (and every guest) still sees
  local-only Library metadata, the same account showing different Library contents on different
  devices, exactly as originally diagnosed (`docs/library-cross-device-diagnosis.md`,
  `docs/library-cloud-sync-contract.md`). Widening to Production requires explicit founder
  approval. Private original-file storage is likewise **deployed and founder-QA verified in
  Development and Staging** (not repository-only) — see `docs/library-and-source-architecture.md`'s
  "Private source storage architecture". Retained local/cloud-downloaded source files have no
  storage-eviction policy yet — a device that opens many cloud-only sources accumulates their
  local copies indefinitely; deferred future work, not a defect.
- Deck ordering was previously non-deterministic across devices (storage-array-order dependent —
  see `docs/deck-ordering.md`); now fixed for Home via a canonical comparator. Deck Collections
  (`docs/deck-collections.md`) remain local-only in every environment, including Development and
  Staging (unlike Library metadata above, which now syncs in both) — same device sees the same
  organization, a second device signed into the same account does not yet, anywhere.
- Embedded in-app source readers now exist for **PDF, image, text, DOCX, and audio**
  (`app/library/[id]/reader.tsx` — see "Embedded source readers" and `docs/docx-reader.md` /
  `docs/audio-source-player.md`). DOCX and Audio are founder-QA verified on a native Development
  Build; PDF/image/text predate v3.2. "Open original" (`expo-sharing` OS handoff) remains the
  fallback for every format without an embedded reader (video, `.xlsx`, `.pptx`, legacy `.doc`,
  encrypted DOCX). Still not implemented in-app: any editing, annotation, highlighting, OCR, or
  text extraction of an opened source, and any **video** reader (there is no `video` `SourceType`).
- EAS Build is prepared (`eas.json`) but not yet linked to an Expo account/project — that step
  requires interactive founder action (`eas login`, `eas init`) and was deliberately not performed
  autonomously; local builds (`npx expo run:ios`) remain the founder-QA-verified path for both
  physical iPhone and Simulator. Do not run `eas login`/`eas init` against an assumed or default
  account.
- **Real provider-backed AI generation is not implemented.** The AI Generation Foundation and the
  Generate Study Deck UX are integrated, but generation is `createMockProvider()` only. Wiring a
  real model provider, selecting/deploying an AI backend, and defining prompt/rate/cost/abuse
  handling is a separate, founder-gated body of work. The mobile client must never hold a
  provider secret.
- **Discover Production exposure is an unresolved founder decision.** Discover has no
  `INTERVAL_ENV` gate, so a Production build shows it. It is fixture/local-only with no backend
  and no cost, so this is not unsafe — but it is a product call the founder has not yet made.
  Do not add a gate or decide this autonomously.
- **Discover progress and Deck Collections do not sync across devices.** Both are local-only in
  every environment (unlike Library metadata, which syncs in Development/Staging). Same device is
  consistent; a second device signed into the same account does not see the same Discover
  progress or deck organization anywhere.
- **No dedicated Audio automated test suite.** `src/domain/sourceAudioPlayer.ts`'s pure helpers
  (`formatPlaybackTime`, `playbackProgress`, `clampPlaybackPosition`, `isPlaybackComplete`) are
  trivially testable; a `test:audio` suite matching `test:docx` would be a small, worthwhile
  addition.
- **No video source support.** `SourceType` has no `video` member and the format table has no
  `video/*` MIME or `.mp4`/`.mov` extension. Video files are correctly handed off via "Open
  original", never routed to the Audio player. Adding in-app video (or extracting a video's audio
  track) is out of scope and would be a deliberate future feature.
- DOCX cache media (`Paths.cache/librarySourceReaderDocxMedia/<sourceId>`) is cleared on every
  reader load, but shares the same known gap as the rest of the cache/retained-file story: there
  is no proactive eviction policy for the canonical durable `librarySourceFiles/` store.

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
7. New English strings — including accessibility labels/hints — need a counterpart in **every**
   locale file (`src/i18n/locales/*.ts`): `en, es, fr, pt-BR, it, de, nl, ru, zh-Hans, ja, ko,
   hi, ar`. `en` is the source-of-truth shape and `tsc` fails if any locale is missing a key.
   Document *bodies* (e.g. Discover lesson content) are deliberately English-only and are not a
   translation obligation — only UI chrome/labels are.
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
16. For feature/fix work (not documentation-only changes), founder runtime QA must pass before
    committing — passing `tsc`/lint is a baseline, not a substitute. The required workflow:
    implement → static validation → founder/reviewer inspects the diff → founder runtime QA →
    any bugs found return to implementation → founder QA passes → only then commit → only then
    push → deploy only when actually required. Do not suggest or perform a commit merely because
    TypeScript and lint passed.

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
