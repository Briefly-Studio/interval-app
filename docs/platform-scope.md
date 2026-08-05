# V3 Beta Platform Scope

This document defines what Interval V3 beta actually supports, per platform. It exists so that
"is X supported" has one honest answer instead of being re-derived (or assumed) per conversation.
Language here is deliberate: something is "not supported in this beta" — never "broken" (it may
never have been attempted) and never "coming soon" (no committed timeline exists unless stated).

## Supported / primary

- iOS native build (device and Simulator)
- Production appearance system and adaptive startup behavior
- Authentication (Cognito sign-in/sign-up/sign-out/session restoration)
- Offline local storage (decks, cards, sessions — fully usable without an account, per this
  repository's Core Product Rule)
- Cloud sync (push/pull, offline-first queuing, malformed-record validation, partial-sync
  warnings — see docs/sync-invariants.md)
- Decks, cards, review, quiz, Recently Deleted, cross-platform Edit Deck
- English and Spanish localization

iOS is the platform this beta is actually built, exercised, and founder-tested against. Every
other platform's status below is relative to this one.

## Supported, manual QA required

- Android native build — buildable and expected to be core-flow compatible (same React Native
  codebase, same storage/sync/auth layer, no Android-specific code paths removed or skipped this
  batch), but has not received the same founder testing depth as iOS. Treat as "should work,
  needs a real pass" rather than "verified."
- Core deck/card flows (create/edit/delete deck and card, review, quiz) on Android
- The cross-platform Edit Deck screen (app/deck/[id]/edit.tsx) specifically — it replaces an
  iOS-only Alert.prompt flow precisely so it can be manually verified on Android too; that
  verification has not been performed as part of this batch (no device/simulator access here —
  see the Manual QA checklist in this batch's report)
- Theme behavior (System/Light/Dark/Warm) on Android
- Sync behavior on Android

## Not supported in V3 beta

- **Authenticated web app.** `expo-secure-store` has no real web implementation (see
  `src/storage/secureStore.ts`), and no web-specific auth/session/sync path has been built or
  tested. Rather than let web silently degrade into an unverified, partially-working experience,
  the entire app is gated behind a single honest "not available on web yet" screen
  (`app/_layout.tsx`) before any route mounts. `expo export --platform web` still succeeds (the
  gate is a runtime screen, not a build change) — this is a scope decision, not a build failure.
- **Advanced multi-device conflict resolution.** Sync is rev-only last-writer-wins with no merge
  and no conflict UI. An offline device's un-pushed edit can be silently superseded by another
  device's already-synced edit, with no user-facing notice beyond the calm, permanent note on the
  Sync Status screen. See docs/sync-invariants.md's "no conflict UI for concurrent multi-device
  edits" section — this is a known, accepted beta risk, not a solved problem.
- **Session resume after a force-kill.** Review/quiz progress lives only in React state; killing
  the app mid-session loses that session's progress entirely (not partially) with no checkpoint
  ever written. Nothing is silently corrupted — there is simply nothing to resume.
- **Guaranteed permanent deletion across a forced resync.** Recently Deleted's soft-delete
  tombstones can, in principle, be re-delivered by a full resync (e.g. after Force Resync, or a
  fresh device's first sync) and reappear locally. See `app/recently-deleted.tsx`'s in-code
  documentation of this exact tradeoff.
- **Full accessibility certification.** Most interactive elements carry `accessibilityLabel`/
  `accessibilityRole`, but no formal VoiceOver/TalkBack audit or certification has been performed
  — see the Accessibility section of docs/v3-beta-release-checklist.md.

## What changed this batch

- Edit Deck is now a real, cross-platform route (`app/deck/[id]/edit.tsx`) instead of an
  iOS-only `Alert.prompt`, closing a real inconsistency between iOS and Android/web.
- `expo-secure-store` calls are now routed through a single platform-safe wrapper
  (`src/storage/secureStore.ts`) that never calls a missing native method on web, independent of
  and in addition to the app-level web gate above.
- Web no longer hangs or throws — it now shows the gate screen above, deterministically, once the
  theme finishes initializing.

Native (iOS/Android) behavior is unchanged by any of the above — the wrapper passes every call
straight through to the real `expo-secure-store` on native, and the web gate only ever renders
different content on `Platform.OS === "web"`.

## Note: Expo Router still statically includes gated route files

Expo Router's file-based routing generates a route for every file under `app/` at build time,
regardless of any runtime `__DEV__`/platform gating inside that file. `app/dev-tools.tsx` and
`app/theme-lab.tsx` are both still present in `expo export`'s route list (including the web
export) even though both are unreachable from the production UI (see the "Development-only route
guards" note below) — this is expected Expo Router behavior, not a leftover bug, and is not
something this batch attempted to work around with a custom router-generation step (out of scope,
and unnecessary: the route existing in the bundle is not the same as it being reachable or
exposing anything at runtime).

## Development-only route guards

`app/dev-tools.tsx` and `app/theme-lab.tsx` both gate their actual content behind `if (!__DEV__)`.
As of this batch, their entry points are gated too, not just their content: the Home screen's
long-press-to-open-Dev-Tools gesture (`app/index.tsx`) and its `__DEV__`-only gear icon both now
only register at all in development builds (`onTitleLongPress` is `undefined` in production, so
React Native never even attaches the long-press gesture recognizer) — previously the long-press
itself was always active, and a production user who found it would land on dev-tools.tsx's own
"only available in development" stub rather than being unable to navigate there at all. Theme Lab
has no entry point outside Dev Tools, so gating Dev Tools' entry covers it too.
