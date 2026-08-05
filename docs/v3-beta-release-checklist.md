# V3 Beta Release Checklist

Legend: `[x]` confirmed · `[ ]` pending · `[~]` accepted limitation (not a blocker, tracked
intentionally — see "Known accepted beta limitations" below).

Items are pre-filled `[x]` **only** where this repository's own tooling confirmed them during the
V3 Beta Readiness batch (dated against commit `bc06207` plus the uncommitted changes in that
batch), or where the founder has explicitly confirmed something in conversation. Everything else
starts `[ ]` — do not mark an item passed without actually doing it.

---

## Repository

- [ ] Working tree clean before tagging/release build
- [ ] HEAD is the expected, reviewed commit
- [ ] No secrets, tokens, or credentials in the diff or history
- [ ] No debug UI reachable from production navigation (Dev Tools / Theme Lab entry points
      `__DEV__`-gated — see docs/platform-scope.md)
- [ ] No uncommitted files before building for distribution
- [ ] No AI/co-author metadata in any commit intended for release

## Build

- [ ] `npx tsc --noEmit` passes with 0 errors
- [ ] `npm run lint` passes with 0 errors, 0 warnings
- [ ] `npx expo-doctor` — passing, or any failing check explicitly triaged and accepted (see
      Expo SDK patch-drift note below)
- [ ] `expo export --platform ios` succeeds
- [ ] `expo export --platform android` succeeds
- [ ] `expo export --platform web` succeeds
- [ ] iOS native build succeeds (Xcode/EAS)
- [ ] Android native build succeeds, when a native Android build is actually attempted

## Auth

- [ ] Sign in (correct credentials)
- [ ] Account restoration on cold launch (already-signed-in session resumes)
- [ ] Sign out
- [ ] Expired-session behavior (silent-refresh success case, and the forced-sign-out-on-4xx case)
- [ ] Wrong-password / invalid-credential error copy is clear and localized

## Core data

- [ ] Create / edit (new Edit Deck screen) / delete deck
- [ ] Create / edit / delete card
- [ ] Recently Deleted restore (deck and card)
- [ ] Offline mutation (create/edit/delete while offline, confirm it queues and later syncs)
- [ ] Restart persistence (force-quit and relaunch; local data intact)

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

## Appearance

- [ ] System Light
- [ ] System Dark
- [ ] Explicit Light
- [ ] Explicit Dark
- [ ] Warm
- [ ] Reduced motion variant (BrandStartup)
- [ ] Adaptive native splash (light/dark) matches the resolved theme
- [ ] No startup flash / wrong-theme frame on cold launch

## Localization

- [ ] English — full pass
- [ ] Spanish — full pass
- [ ] No layout overflow/truncation from longer Spanish strings on key screens
- [ ] Alerts (including the new Edit Deck / web-unsupported copy added this batch) localized
      correctly in both languages
- [ ] Sync status copy (including `syncedWithWarnings`) localized correctly in both languages

## Platforms

- [ ] iOS founder QA (device and/or Simulator)
- [ ] Android manual QA — not yet performed; do not mark passed without an actual device/emulator
      pass (see docs/platform-scope.md's "supported, manual QA required" list)
- [ ] Web unsupported-state QA — confirm the gate screen appears, no console exceptions, no
      infinite loading, native platforms unaffected
- [x] Platform-scope documentation exists and is current — `docs/platform-scope.md` (added this
      batch)

## Accessibility

- [ ] VoiceOver smoke test (iOS)
- [ ] TalkBack smoke test (Android)
- [ ] Dynamic text / basic scaling check
- [ ] Contrast review (Light/Dark/Warm)
- [ ] Reduced-motion behavior confirmed on-device
- [~] Full accessibility certification is explicitly out of scope for this beta — see
      docs/platform-scope.md. A smoke test is expected; formal certification is not.

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
