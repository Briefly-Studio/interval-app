# V3 Beta Release Checklist

Legend: `[x]` confirmed · `[ ]` pending · `[~]` accepted limitation (not a blocker, tracked
intentionally — see "Known accepted beta limitations" below).

Items are pre-filled `[x]` **only** where this repository's own tooling confirmed them (current
validation commands or static code facts), or where the founder has explicitly confirmed
something in conversation. Everything else starts `[ ]` — do not mark an item passed without
actually doing it. Last reconciled against commit `acb813f` (Beta Readiness + Interval rebrand,
pushed to `origin/v3.0-dev`) plus founder simulator/device QA reported after that push.

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
5. **Expo SDK patch drift (8 packages)** — `expo`, `expo-constants`, `expo-file-system`,
   `expo-font`, `expo-linking`, `expo-router`, `expo-splash-screen`, `expo-web-browser` are all
   one or more patch versions behind what the installed Expo SDK expects. Investigated this
   batch (`npx expo install --check`) and deliberately deferred rather than bundled into beta
   cleanup — see the batch report for the exact recommended versions and the reasoning.
6. **Android has not received founder-level manual QA depth.** Expected to work (same codebase,
   no Android-specific code removed), but "should work" is not the same claim as "verified."
7. **No automated test suite exists.** Every checklist item above requires a real manual pass;
   none of this is enforced by CI.
8. **Accessibility is a foundation, not a certification.** Screen-reader semantics, text-to-speech,
   reduced-motion, and large-text support are implemented and code-verified (see
   `docs/accessibility-foundation.md`), but no VoiceOver/TalkBack device testing, no formal
   contrast audit, and no WCAG/ADA/Section 508/platform certification has been performed.
