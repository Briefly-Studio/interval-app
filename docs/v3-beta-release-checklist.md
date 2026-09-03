# V3 Beta Release Checklist

Legend: `[x]` confirmed · `[ ]` pending · `[~]` accepted limitation (not a blocker, tracked
intentionally — see "Known accepted beta limitations" below).

Items are pre-filled `[x]` **only** where this repository's own tooling confirmed them (current
validation commands or static code facts), or where the founder has explicitly confirmed
something in conversation. Everything else starts `[ ]` — do not mark an item passed without
actually doing it.

The bulk of this checklist below was **last reconciled against `acb813f`** (Beta Readiness +
Interval rebrand, `origin/v3.0-dev`) and predates the `v3.1-dev` and `v3.2-dev` integration
waves. The v3.0-era `[x]` items are historical evidence, not a current pass — re-verify at
actual release time. The current picture is in "v3.2 stabilization status" and "v3.2 integrated
capabilities" immediately below.

---

## v3.2 stabilization status

**v3.2 FEATURE FREEZE — effective at canonical `v3.2-dev`
`b460271df1eaa09ac339d6b137b37c51d838d9e2`.** From this point until Staging RC sign-off, only
release blockers, safety/security fixes, broken-flow fixes, release/config corrections,
documentation, and Staging-specific environment preparation are in scope. No feature expansion,
UX redesign, new providers, new source formats, or Discover/AI feature expansion.

The automated stabilization audit was reconciled against `bc255e48…` (the merge immediately
before this docs commit; `b460271` adds only documentation on top of it — no code change).

- **Automated v3.2 stabilization audit — [x] PASSED.** `git diff --check` clean; `npx tsc
  --noEmit` clean; `npm run lint` clean; `npm run test:sync` 39/39; `npm run test:ai` 20/20;
  `npm run test:docx` 11/11; `node --check backend/lambdas/ai-generate-study-deck/index.mjs`
  clean; `npx expo-doctor` 17/18 (known patch-drift baseline — 7 packages). No product-behavior
  release blocker identified. No secrets, no AI provider key on mobile, no token/claims/source
  content logging.
- **Documentation reconciliation — [x] complete** (`docs: reconcile repository with v3.2`,
  `docs: freeze v3.2 release boundary`).
- **Founder canonical full-app QA — [x] PASSED (Development build).** Founder canonical full-app
  QA passed for the integrated v3.2 Development build. Expected preview boundaries were observed:
  Generate remains `[MOCK]` / TXT-only, Discover uses localized chrome with English fixture
  lesson content, unsupported video remains "Open original". This is a Development-build pass; it
  does not imply a Staging or Production pass.
- **Staging infrastructure prerequisite — [x] PASSED.** The founder deployed the `ea61356`
  sync-Lambda hardening to `IntervalStagingStack` from AWS CloudShell. Confirmed post-deploy:
  `interval-staging-sync-push` and `interval-staging-sync-pull` both `MemorySize: 256`,
  `Timeout: 15`, `Runtime: nodejs24.x`; `interval-staging-library-source-storage` unchanged at
  `MemorySize: 128`, `Timeout: 3`, `Runtime: nodejs24.x`. A Library Lambda asset delta noticed
  before deploy was investigated and found to be additive-only (two legacy MIME types,
  `application/vnd.ms-powerpoint` and `application/vnd.ms-excel`, already present in the allow
  list) — not a drift concern. Final `npx cdk diff IntervalStagingStack` returned **"Number of
  stacks with differences: 0."** See "v3.2 Staging RC plan" below for what this unblocks and what
  is still pending.
- **Staging client/beta RC QA — [ ] pending.** Infrastructure is ready; the Staging RC QA matrix
  below (auth, sync, Library, readers, Generate, Discover) has not been run against a Staging
  build yet.
- **Beta distribution build — [ ] pending.** No production-like Staging binary exists yet — see
  "EAS / distribution" below and the upcoming Production-like Staging Distribution Foundation work
  (Dev Tools gating for external testers).
- **`v3.2-dev` is now frozen as the release/beta maintenance line** at
  `4f0593eef1a6a9a3708758408f82cfb38e05f3ab` (this stabilization + the Staging infrastructure
  prerequisite above). `v3.3-dev`, cut from that exact commit, is the active development branch —
  see `docs/branch-and-release-policy.md`.
- **Production release — [ ] not approved.** Production remains grandfathered; none of the v3.2
  features have been widened to Production. Production's own sync Lambdas remain `128 MB / 3 s`
  (a separate, founder-gated question, out of v3.2 scope).

### v3.2 release decision — Discover Production exposure — RESOLVED

- [x] **Discover will remain visible in Production for v3.2.** Founder decision: Discover is
  fixture/local-only, makes no AI provider call, has no backend content service, incurs no
  runtime provider cost, is a bounded experience with localized chrome, English fixture lesson
  content is accepted for this beta boundary, and Generate-from-Discover stays disabled. **Do not
  add a Production gate.** Future AI-backed Discover is a separate, later effort: authenticated
  backend, provider-backed content generation, user app-language/locale passed as generation
  context, generated content returned in the requested language with explicit content-language
  metadata, mobile never holding provider secrets.

---

## v3.2 integrated capabilities

Each reconciled onto canonical and integrated via its own `--no-ff` merge. No AWS resource,
`infra/` stack, or backend Lambda changed for any of them.

| Capability | Maturity | Environment exposure | Cloud/backend | Automated tests |
|---|---|---|---|---|
| Source normalization foundation | Implemented | all (domain layer) | none | (covered under `test:ai` context prep) |
| Sync reliability hardening (`ea61356`) | Code + CDK on canonical; **deployed + founder-QA verified on Development**; **deployed to Staging** (CloudShell, `cdk diff IntervalStagingStack` now clean — see "v3.2 Staging RC plan") | client hardening ships in every build; server hardening now live on both Development and Staging | existing sync backend (Lambda config + code only) | `test:sync` — 39 |
| AI Generation Foundation | Implemented — **mock provider only** | all (mock) | reference Lambda exists in repo, **not in the CDK stack, not deployed** — do not deploy it | `test:ai` — 20 |
| Generate Study Deck | Implemented, founder-QA verified — `[MOCK]` output | **Development/Staging only; hidden in Production** | none | (domain-covered) |
| Discover Preview | Implemented, founder-QA verified | **currently ungated — visible in Production** (decision pending) | none | none |
| DOCX reader | Implemented, founder-QA verified (native build) | all (local) | none | `test:docx` — 11 |
| Audio source player | Implemented, founder native-runtime QA verified | all (local) | none — `audio` `uploadSupported: false` | none (pure helpers testable — future `test:audio`) |

---

## v3.2 Staging RC plan

### AWS delta — what a v3.2 Staging RC needs

**Client-only, no AWS change:** Discover, DOCX reader, Audio player, and the mock Generate UX are
100% client-side. The AI reference Lambda (`backend/lambdas/ai-generate-study-deck/`) is **not**
in the CDK stack (`infra/lib/interval-sync-stack.ts` only packages `sync-push`, `sync-pull`,
`library-source-storage`) and must **not** be deployed — deploying it would create a fake
provider-backed capability that does not exist.

**Founder-gated AWS deploy — the sync-Lambda hardening (`ea61356`) — [x] DONE.** Deployed via AWS
CloudShell; `IntervalStagingStack` reached `UPDATE_COMPLETE`; final `npx cdk diff
IntervalStagingStack` returned zero differences. Detail retained below for the record.

- `infra/lib/interval-sync-stack.ts` now sizes both sync Lambdas at **256 MB / 15 s** (up from
  `128 MB / 3 s`) and excludes `*.test.mjs` from the Lambda asset; `backend/lambdas/sync-push/`
  and `sync-pull/` were restructured (bounded concurrency, `MAX_CHANGES_PER_PUSH = 500` → 413,
  `{entity,id}` acknowledgement identity, `SK`-derived pull cursor).
- This was deployed to and founder-QA verified on **`IntervalDevelopmentStack`** first. It is now
  **also deployed to `IntervalStagingStack`** (CloudShell, confirmed `UPDATE_COMPLETE`,
  `interval-staging-sync-push`/`interval-staging-sync-pull` both `256 MB / 15 s / nodejs24.x`) —
  the "256 MB / 15 s (Development and Staging)" wording in `docs/cdk-infrastructure.md` now
  reflects a confirmed Staging deploy, not just the shared CDK construct.
- **Why it matters for Staging RC:** a v3.2 client's `parseAckList`
  (`src/cloud/sync/pushHelpers.mjs`) deliberately has **no legacy `string[]` fallback** — it only
  accepts `[{entity, id}]`. If Staging still runs the pre-`ea61356` `sync-push` (which returns an
  id-only `accepted: [id, …]` array), the client drops every acknowledgement, marks nothing
  clean, and re-pushes the same batch forever — **sync never converges**. The old `128 MB / 3 s`
  sizing also risks the exact `Http500` 3000 ms timeout the 2026-08 Development incident showed.
- **Repo/CDK side is verified ready** (checked against canonical `2fd9df6`): `cd infra && npm ci
  && npm run build && npx cdk synth IntervalStagingStack` succeeds and synthesizes
  `interval-staging-sync-push` and `interval-staging-sync-pull` at **`MemorySize: 256`,
  `Timeout: 15`, `nodejs24.x`**, with `syncAssetExclude = ["*.test.mjs"]` on both; the
  `library-source-storage` Lambda stays `128 / 3`. The `sync-push`/`sync-pull` asset dirs carry
  the `ea61356` `lib.mjs` structure (`MAX_CHANGES_PER_PUSH = 500`, `PUSH_CONCURRENCY = 10`,
  `classifyChange` / `decidePushOutcome`, `cursorForRow` SK-derived cursor).
- **This deploy must be done from AWS CloudShell in the Interval AWS account.** It cannot be run
  from the local development machine — that machine's default AWS credentials resolve to a
  different account with zero Interval resources in `us-east-2` (the same account mismatch
  `docs/aws-current-state-audit.md` records for the local Mac). Do not switch credential profiles
  or run `cdk deploy` locally — it would attempt to create the whole Staging stack in the wrong
  account.
- **Action (founder, CloudShell) — [x] DONE.** `IntervalStagingStack` was confirmed not to carry
  `ea61356` and was deployed. Before deploying, a Library Lambda asset delta noticed in the diff
  was investigated: the only difference between the deployed and canonical
  `library-source-storage` source was two additive legacy MIME types already intended for the
  allow list (`application/vnd.ms-powerpoint`, `application/vnd.ms-excel`) — not an unexpected
  drift, so the deploy proceeded. In-place Lambda config + code update only — no change to
  DynamoDB tables, the Cognito pool, the S3 bucket, IAM roles, or API routes. Final `npx cdk diff
  IntervalStagingStack` returned **"Number of stacks with differences: 0."**

```
# In AWS CloudShell, region us-east-2, confirmed to be the Interval account (read-only checks first)
git clone <repo> && cd interval-app/infra
npm ci
npm run build                       # tsc
npx cdk diff IntervalStagingStack   # REVIEW: expect only the two sync Lambdas (Code/Memory/Timeout) + asset exclude, or empty
npx cdk deploy IntervalStagingStack # only if the diff is non-empty AND matches exactly that scope
# read-only post-deploy:
#   aws lambda get-function-configuration --function-name interval-staging-sync-push  (expect MemorySize 256, Timeout 15)
#   aws lambda get-function-configuration --function-name interval-staging-sync-pull  (expect MemorySize 256, Timeout 15)
#   aws cloudformation describe-stacks --stack-name IntervalStagingStack --query "Stacks[0].StackStatus"  (UPDATE_COMPLETE)
```

Rollback if a redeployed revision misbehaves: **redeploy the previous good revision**, never
`cdk destroy` (see `docs/cdk-infrastructure.md` "Rollback / removal").

### Staging client configuration

Environment is a pure JS/manifest concern — `app.config.ts` reads `INTERVAL_ENV`,
`EXPO_PUBLIC_API_BASE_URL`, and `EXPO_PUBLIC_COGNITO_*` from the local gitignored `.env` into
`expo.extra`, and `src/config/environment.ts` reads them from `Constants.expoConfig.extra` at
runtime. Nothing environment-specific touches `plugins`, `ios.bundleIdentifier`,
`android.package`, or any native config. To point a build at Staging: set `.env`
`INTERVAL_ENV=staging` plus the four Staging values (from `IntervalStagingStack` outputs — never
committed), then `npx expo start -c`. No native rebuild is needed **for the environment switch
itself**.

### Native build

v3.2 added `expo-audio` (a native module) + `expo-asset`. A Staging RC binary **must contain
ExpoAudio**, i.e. be built from `bc255e4` / `801ba60` (Audio integration) or later —
`b460271` is native-identical to `bc255e4` (docs-only on top).

- If the founder's ExpoAudio-containing Development Build from Audio runtime QA is still
  installed, pointing it at Staging (`.env` + `npx expo start -c`) is sufficient.
- Otherwise, one native rebuild is required. **Recommended for a clean Staging RC** regardless:
  rebuild once from the canonical worktree with `.env` set to Staging —
  `cd /Users/joseangulo/Projects/interval-app && npx expo run:ios --device` (fallback: `xed ios`
  → Run in Xcode). Then `npx expo start -c` from that worktree.

### EAS / distribution

`eas.json` has `development` and `development-simulator` profiles only, and the project is **not
linked to an Expo account** (no `owner`, no `projectId`; `eas login` / `eas init` deliberately
not run).

- **Staging RC internal QA needs no EAS** — the founder-QA-verified path is local
  `npx expo run:ios --device`.
- **External beta / TestFlight** later requires, as separate founder-interactive work: `eas
  login` + `eas init`; a `preview` (or `production`) EAS build profile; a **real bundle
  identifier** (the current `com.anonymous.briefly-app` is a placeholder — App Store distribution
  needs a reverse-DNS ID tied to the Apple Developer team); `eas build` + `eas submit` /
  App Store Connect + TestFlight setup. None of this is a v3.2 Staging RC prerequisite.

### Release-candidate identifier

Following the established pattern (`v3.0-rc1` is the immutable tag at the founder-approved V3 RC
checkpoint), the v3.2 RC tag is **`v3.2-rc1`**, created **only after Staging RC QA passes** — not
now. Cut it on the exact `v3.2-dev` commit that passed Staging QA.

### Staging RC QA matrix (Staging build pointed at `IntervalStagingStack`)

Run **after** the sync-Lambda deploy above. ~18 checks, Staging-specific / high-risk surfaces:

**Auth**
1. Fresh Staging Cognito sign-up → sign-in → app usable.
2. Kill & relaunch → session restored; still signed in.

**Sync (the deploy-sensitive surface)**
3. Create a deck + cards → they sync (status returns to "Up to date"), no `Http500`.
4. Second Staging device / Simulator on the same account sees the deck + cards.
5. Create a **generated** (`[MOCK]`) deck → it syncs and appears on the second device.
6. Force Resync (if exposed) → converges, no duplication, no data loss.
7. Offline: make an edit, kill network, reconnect → the edit pushes and converges.

**Library (Staging source storage)**
8. Create source metadata → syncs to the second device.
9. Attach an original file → uploads to Staging private storage.
10. Retrieve that original on the second device ("Open original").
11. Archive / restore a source; delete / restore.

**Readers**
12. Open a PDF in-app.
13. Open a `.docx` — normal content + a wide table (horizontal scroll as one unit).
14. Open an audio source — "Listen in Interval"; play / pause / ±15 s seek / speed; navigate
    away → playback stops; reopen → clean init.

**Generate (Staging exposure)**
15. TXT source → "Generate study deck" is visible → run → `[MOCK]` draft with provenance → save
    once → exactly one deck → it syncs.

**Discover**
16. Discover is visible; open a lesson; bookmark; complete the bounded session (English fixture
    content, localized chrome).

**UI**
17. Light / Dark spot check across a reader + Generate + Discover.
18. Switch to Arabic → chrome RTL; an English `.docx`/TXT body stays LTR; audio progress bar
    fills left→right.

**Failure**
19. Kill Metro / go offline mid-sync → app shows an honest offline/needs-attention state and
    recovers on reconnect (no stuck spinner, no crash).

---

## Repository

- [ ] Working tree clean before tagging/release build (re-check immediately before the actual
      release build — was clean as of `acb813f`, but this must be re-verified at build time, not
      assumed from an earlier checkpoint)
- [ ] HEAD is the expected, reviewed commit (re-check at actual release time)
- [x] No secrets, tokens, or credentials in the diff or history — verified by direct diff
      inspection before committing `acb813f`
- [x] No debug UI reachable from production navigation (Dev Tools / Theme Lab entry points
      `__DEV__`-gated — verified by code inspection; see docs/platform-scope.md)
- [ ] No uncommitted files before building for distribution (re-check at build time)
- [x] No AI/co-author metadata in any commit intended for release — verified for `acb813f`
      (author/committer both the founder's local Git identity, no trailers)

## Build

- [x] `npx tsc --noEmit` passes with 0 errors — confirmed against `acb813f`
- [x] `npm run lint` passes with 0 errors, 0 warnings — confirmed against `acb813f`
- [x] `npx expo-doctor` — 17/18; the one failing check is the Expo SDK patch-drift note below,
      explicitly triaged and deferred, not an unreviewed failure
- [x] `expo export --platform ios` succeeds — confirmed against `acb813f`
- [x] `expo export --platform android` succeeds — confirmed against `acb813f`
- [x] `expo export --platform web` succeeds — confirmed against `acb813f`
- [ ] iOS native build succeeds (Xcode/EAS) — not performed by this tooling; founder has run the
      app on-device/Simulator, but an explicit from-source native build has not been re-verified
      since the branding changes to `app.json`
- [ ] Android native build succeeds, when a native Android build is actually attempted

## Auth

- [ ] Sign in (correct credentials)
- [ ] Account restoration on cold launch (already-signed-in session resumes)
- [ ] Sign out
- [ ] Expired-session behavior (silent-refresh success case, and the forced-sign-out-on-4xx case)
- [ ] Wrong-password / invalid-credential error copy is clear and localized

## Core data

- [x] Create / edit (new Edit Deck screen) / delete deck — founder-confirmed: cross-platform Edit
      Deck is reachable and behaves correctly; normal deck workflows looked correct
- [x] Create / edit / delete card — founder-confirmed: normal card workflows looked correct
- [ ] Recently Deleted restore (deck and card) — not explicitly exercised in the founder QA
      reported so far
- [ ] Offline mutation (create/edit/delete while offline, confirm it queues and later syncs) —
      not explicitly exercised in the founder QA reported so far
- [x] Restart persistence (force-quit and relaunch; local data intact) — founder-confirmed
      ("existing local data remains available"; persistence after full kill confirmed under
      Appearance/Startup)

## Study flows

- [ ] Review mode
- [ ] Quiz mode
- [ ] Results screens (review and quiz)
- [ ] History screen
- [~] Killed-session limitation acknowledged — review/quiz progress is not checkpointed; a
      force-kill mid-session loses that session's progress entirely (not partially). Documented
      in docs/platform-scope.md.

## Sync

- [ ] Push
- [ ] Pull
- [ ] Offline → online transition triggers a sync
- [ ] Partial-sync warning (`syncedWithWarnings`) actually appears when a malformed pulled
      record is skipped
- [ ] `needsAttention` state appears on a genuine push rejection / unexpected failure
- [ ] Malformed pull-response handling (hard failure, cursor preserved, no partial apply — see
      docs/sync-invariants.md)
- [~] Multi-device conflict limitation acknowledged — rev-only last-writer-wins, no merge, no
      conflict UI. Documented in docs/sync-invariants.md and docs/platform-scope.md.

## Portability / branding

- [x] App visibly branded Interval — founder-confirmed
- [x] Import screen branded Interval — founder-confirmed
- [x] Export screen branded Interval — founder-confirmed
- [x] New `.interval` export works — founder-confirmed
- [x] New `.interval` import works — founder-confirmed
- [x] Legacy `.briefly` import still works — founder-confirmed
- [x] Export → reimport round trip works — founder-confirmed
- [x] Deck/card content remains correct through export/import — founder-confirmed

## Appearance

- [x] System Light — founder-confirmed
- [x] System Dark — founder-confirmed
- [x] Explicit Light — founder-confirmed
- [x] Explicit Dark — founder-confirmed
- [x] Warm — founder-confirmed
- [ ] Reduced motion variant (BrandStartup) — not specifically founder-confirmed; do not treat
      the general appearance confirmation above as covering this
- [x] Adaptive native splash (light/dark) matches the resolved theme — founder-confirmed
- [x] No startup flash / wrong-theme frame on cold launch, no deck-screen blink —
      founder-confirmed

## Localization

- [ ] English — full pass
- [ ] Spanish — full pass
- [ ] No layout overflow/truncation from longer Spanish strings on key screens
- [ ] Alerts (including the new Edit Deck / web-unsupported copy added this batch) localized
      correctly in both languages
- [ ] Sync status copy (including `syncedWithWarnings`) localized correctly in both languages

## Platforms

- [x] iOS founder QA (device and/or Simulator) — founder has exercised Edit Deck, import/export,
      branding, and appearance directly
- [ ] Android manual QA — not yet performed; do not mark passed without an actual device/emulator
      pass (see docs/platform-scope.md's "supported, manual QA required" list)
- [x] Web unsupported-state screen displays — founder-confirmed
- [x] Web: no SecureStore runtime exception — founder-confirmed
- [x] Web: no infinite loading — founder-confirmed
- [x] Platform-scope documentation exists and is current — `docs/platform-scope.md` (added this
      batch)

## Accessibility

See `docs/accessibility-foundation.md` for the full accessibility foundation this section
verifies. Items below are founder-confirmed via focused iOS Simulator QA where marked `[x]`; every
other item is still genuinely pending a real device/assistive-technology pass — a code-level
foundation is not the same claim as a tested one, and this list does not blur that line.

**Founder-confirmed (iOS Simulator, this round):**

- [x] Accessibility settings screen renders correctly and looks coherent/production-ready
- [x] Speech enabled/disabled control works
- [x] Speech rate controls render and behave correctly
- [x] Text-to-speech: question is read aloud correctly (Review and Quiz)
- [x] Text-to-speech: answer is read aloud correctly (Review, after reveal)
- [x] Quiz reads the question only, by design — answer choices remain individually available
      through normal interaction and are not automatically spoken as one block
- [x] Text-to-speech: starting new speech interrupts speech already playing, without overlap
- [x] Text-to-speech: repeated/rapid playback does not queue competing speech
- [x] Text-to-speech: leaving the card, deck, Review screen, or Quiz screen stops speech
- [x] Text-to-speech in English
- [x] Text-to-speech in Spanish
- [x] No speech-related crash observed
- [x] iOS system Reduce Motion enabled → Interval skips the startup animation
- [x] Interval's in-app Reduce Motion override alone → launch goes from the native loading screen
      to a static Interval logo and then into the app, with no animated sequence in between (see
      docs/accessibility-foundation.md's "Reduced motion: two paths" note for why this differs
      from the system-level path — it is expected, not a bug)
- [x] No stuck startup overlay, unwanted animation, or launch failure observed
- [x] Existing Interval behavior (core deck/card/study/sync/appearance flows) remains healthy
      alongside the accessibility additions

**Still pending — do not treat as passed:**

- [ ] VoiceOver smoke test (iOS) — attempted but not successfully completed this round; see the
      VoiceOver checklist in the batch report for the full screen-by-screen list
- [ ] TalkBack smoke test (Android)
- [ ] Android accessibility generally (consistent with Android's existing "buildable, manual QA
      pending" status — see docs/platform-scope.md)
- [ ] Large system text at the largest Dynamic Type sizes — not fully completed this round
- [ ] Formal contrast audit
- [ ] Color-independent study state confirmed on-device (icon + text already present in code;
      not yet device-verified)
- [ ] No study action requires a gesture with no button/control equivalent — confirmed by code,
      not yet device-verified
- [~] Full accessibility certification is explicitly out of scope for this beta — see
      docs/accessibility-foundation.md and docs/platform-scope.md. A smoke test is expected;
      formal certification is not, and none is claimed here.

## Library Foundation (local metadata only)

See `docs/library-ui-foundation.md` for full detail. This section covers only the local-metadata
UI foundation; it does not cover, and this beta does not yet include, any real file intake, cloud
Library, AI generation, or Canvas integration (see `docs/library-and-source-architecture.md`'s
"Implementation status" section).

### Founder-confirmed working (final — third iOS Simulator pass)

Only what the founder explicitly exercised and confirmed is marked `[x]` here. Nothing broader
(lifecycle detail, workspace isolation, restart persistence, language/theme variations not
explicitly named, or device-level accessibility) is marked passed merely because it's adjacent to
something that was confirmed — see "Remaining intentionally pending" below and the granular
checklists further down for what that excludes.

- [x] Library route opens
- [x] Library navigation is understandable (Home entry, Settings entry, guest and signed-in access)
- [x] Empty Library state renders and reads correctly
- [x] Collections route opens
- [x] Collection creation works
- [x] Collection search works
- [x] Metadata-only source creation works
- [x] Source editing works
- [x] Source detail screen renders and is understandable
- [x] Source cards visibly communicate that they are actionable
- [x] Source Details actions are discoverable
- [x] Manage Collections works
- [x] An existing source can be reassigned to a newly-created collection
- [x] Source search works and is discoverable
- [x] Sorting and composable filtering work
- [x] Active/Archived organization is understandable
- [x] Archive/restore works
- [x] Recently Deleted works
- [x] Recently Deleted title layout is fixed (fits without clipping)
- [x] Recently Deleted remains accessible even when no active sources remain
- [x] "Delete from Library" wording is understandable
- [x] Dev Tools scrolling works
- [x] Add/Edit Source scrolling works
- [x] The global `Screen` scrolling change produced no observed regressions elsewhere in the app
- [x] Dev-only Library fixture seeding works
- [x] Product direction reads as valuable and visually consistent with Interval

This consolidates and closes out three rounds of founder iOS Simulator testing. The first pass
found the underlying behavior sound but surfaced layout/discoverability defects (scrolling,
Recently Deleted's title, main-screen hierarchy, search visibility, source-card affordance, action
discoverability, collection reassignment). The second pass confirmed those fixes and surfaced three
narrower issues (collection search, "Delete metadata" wording, recovery navigation hidden on an
empty active list). This third pass confirms all three of those are resolved, alongside a full
final smoke test — see `docs/library-ui-foundation.md`'s "Founder QA remediation" sections (first
and second pass) for the technical detail behind each fix.

**Navigation**
- [ ] Library reachable from Home while signed out (guest)
- [ ] Library reachable from Home while signed in
- [ ] Library reachable from Settings while signed in
- [ ] Existing Home/deck navigation, back behavior, and startup behavior unaffected

**Data safety / workspace scoping**
- [ ] Restart persistence (force-quit and relaunch; Library metadata intact)
- [ ] Sign out while the Library screen is open/focused — the list must update to the signed-out
      (guest) workspace, not keep showing the previous account's sources (this stabilization pass
      added a workspace-change subscription to the Library screen specifically for this case —
      still needs a real device pass, not just a code review)
- [ ] Sign in / switch accounts where practical — confirm Library metadata is scoped per local
      account, same as decks, and one account's sources never appear under another's
- [ ] Decks, cards, sessions, and account state are unaffected by any Library action

**Empty and seed states**
- [ ] Empty state — English, Spanish, Light/Dark/Warm, larger text (Dynamic Type)
- [ ] Dev-only Library fixture seed — confirmed development-only, confirmed exercises long titles,
      an archived item, multiple types, and multiple collections
- [ ] Dev-only Library fixture reset — requires confirmation, confirmed isolated from decks/cards/
      sessions/account/appearance/language/accessibility preferences, confirmed scoped to the
      current workspace only

**Source creation and editing**
- [ ] Add source details — each prioritized type (PDF, Word, Text, Image, Audio)
- [ ] Add source details — required-title validation, long-title layout, Spanish copy
- [ ] Numeric fields (file size, page/slide/sheet count, duration) — invalid text, negative
      values, and zero are all handled without crashing or corrupting the saved value
- [ ] Edit source details, including collection assignment
- [ ] Edit source details — switching source type after entering a type-specific value (e.g. page
      count) does not leave a stale, incompatible value on the saved record
- [ ] No file picker, upload, sync, or AI action appears anywhere in these flows

**Organization**
- [ ] Search — title, filename, tag, course, semester; case-insensitive; Spanish text
- [ ] Every sort option (Recently used, Recently added, Alphabetical, Newest, Oldest)
- [ ] Composed filters (e.g. type + collection together)
- [ ] Clearing one filter and clearing all filters
- [ ] A filter pointing at a collection deleted from another screen resets itself rather than
      silently showing a stuck, unexplained empty result

**Lifecycle**
- [ ] Archive an active source, then restore it
- [ ] Delete a source ("Delete from Library"), then restore it from Library Recently Deleted
- [ ] Delete an already-archived source, then restore it from Library Recently Deleted — it should
      return to Archived, not jump straight to Active
- [ ] Deletion confirmation copy is accurate and plain-language: local details only, no external
      file, no cloud claim

**Collections**
- [ ] Create, rename (including duplicate-name handling), and delete a collection
- [ ] Deleting a collection preserves its sources (they become unassigned, not deleted)
- [ ] A deleted collection no longer appears in the Add/Edit source collection picker

**Accessibility**
- [~] VoiceOver/TalkBack not yet tested on any Library screen — acknowledged limitation, same
      standard as the rest of this beta's Accessibility section above.

## Release decision

- [ ] Known risks reviewed and accepted by the founder (see "Known accepted beta limitations")
- [ ] Beta cohort defined
- [ ] Support contact path verified working (Help & Feedback screen)
- [ ] Privacy notice and beta notice reviewed for accuracy
- [ ] Tag / release-branch decision made
- [ ] Final founder approval given

---

## Known accepted beta limitations

These are documented, intentional, currently-unsolved tradeoffs — not omissions from this
checklist, and not things a future contributor should "discover" and treat as new bugs:

1. **No authenticated web app this beta.** `expo-secure-store` has no web implementation; the
   entire app is gated behind an honest "not available on web yet" screen. See
   `docs/platform-scope.md`.
2. **Multi-device conflict resolution is rev-only last-writer-wins.** An offline device's edit can
   be silently superseded by another device's already-synced edit. See
   `docs/sync-invariants.md`.
3. **No session-progress checkpointing.** A force-killed review/quiz session's progress is lost
   entirely, with no partial save.
4. **Recently Deleted tombstones can theoretically reappear** after a forced full resync — "soft
   delete and restore" is the honest promise; "permanently gone" is not currently guaranteed.
   See the in-code note in `app/recently-deleted.tsx`.
5. **Expo SDK patch drift (7 packages)** — `expo`, `expo-file-system`, `expo-font`,
   `expo-linking`, `expo-router`, `expo-splash-screen`, `expo-web-browser` are all one patch
   version behind what the installed Expo SDK expects (`npx expo-doctor` 17/18). Tracked and
   deliberately deferred, not a per-run regression. `expo-audio` / `expo-asset` (added in v3.2)
   are not flagged.
6. **Android has not received founder-level manual QA depth.** Expected to work (same codebase,
   no Android-specific code removed), but "should work" is not the same claim as "verified."
7. **No broad end-to-end / UI automated test suite exists.** There are three focused,
   zero-dependency `node --test` unit suites — `test:sync` (39), `test:ai` (20), `test:docx`
   (11), 70 tests — covering pure sync/AI/table-layout helpers only. Every checklist flow above
   still requires a real manual pass; none of it is enforced by CI.
8. **Accessibility is a foundation, not a certification.** Screen-reader semantics, text-to-speech,
   reduced-motion, and large-text support are implemented and code-verified (see
   `docs/accessibility-foundation.md`), but no VoiceOver/TalkBack device testing, no formal
   contrast audit, and no WCAG/ADA/Section 508/platform certification has been performed.

### v3.2-specific accepted limitations

9. **Generate Study Deck is a `[MOCK]` preview.** Cards come from a deterministic local mock, not
   a model. The workflow is gated to Development/Staging and hidden in Production. Real
   provider-backed generation is unstarted, founder-gated future work.
10. **Discover is fixture/local-only and currently ungated by environment** — visible in a
    Production build. Progress does not sync across devices. Production exposure is a pending
    founder decision (see "Unresolved v3.2 release decision" above).
11. **Discover progress and Deck Collections do not sync across devices** — local-only in every
    environment.
12. **Audio playback is local-only and has no dedicated automated tests.** Audio originals are
    not accepted for cloud upload anywhere (`uploadSupported: false`), so cross-device audio
    playback only works on a device that already holds a local copy. No background playback, no
    recording.
13. **No in-app video reader.** Video files (including large screen recordings) are handed off to
    the OS via "Open original"; they are never routed to the Audio player. File size does not
    affect this — classification is by MIME/extension only.
14. **DOCX reader fidelity is deliberately partial.** Ordered lists render as bullets, no
    pagination/exact fonts/tracked-changes, legacy binary `.doc` is unsupported. See
    `docs/docx-reader.md`.
