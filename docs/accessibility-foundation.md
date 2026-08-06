# Interval Accessibility Foundation

This document describes Interval's accessibility foundation as of the Accessibility Foundation
batch. It is a **foundation**, not a certification.

**Accessibility certification (WCAG, ADA, Section 508, or platform-specific certification) has
not been performed.** Nothing in this document should be read as such a claim. The goal here is
genuinely improved usability for assistive-technology users — a starting point to build from, not
a compliance statement.

## 1. Accessibility principles

1. Screen-reader semantics are correct by default on every new production control — role, label,
   state — not retrofitted later.
2. Nothing essential depends on color alone, animation alone, a gesture alone, or a tiny icon
   alone.
3. Interval follows the operating system's accessibility preferences (Reduce Motion, Dynamic
   Type) by default. Any in-app override is additive, explicit, and reversible — never a
   replacement for the system setting.
4. Assistive features (text-to-speech) are opt-in in effect, even when enabled by default: nothing
   speaks without an explicit tap.
5. Study content (card fronts/backs, quiz questions/answers) is never logged, cached for
   diagnostics, or sent anywhere — on-device only, same as the rest of Interval's offline-first
   data model.
6. Announcements are selective. Not every state change is announced — only ones a screen-reader
   user could otherwise miss (see §7).

## 2. Supported assistive behaviors

- VoiceOver (iOS) and TalkBack (Android) semantic navigation across every production screen.
- Dynamic Type / system font scaling (never disabled anywhere in the app).
- System Reduce Motion, honored by every animated surface Interval has (startup, sign-in
  transition) — plus an additional in-app override (§5).
- On-device text-to-speech for review and quiz questions/answers (§4).
- Color-independent status, selection, and correctness indicators throughout.

## 3. Screen-reader semantic standard

Required for every new production interactive element, and retrofitted onto the elements audited
this batch:

- `accessibilityRole` matching the control's real behavior (`button`, `radio`, `radiogroup`,
  `header`, `progressbar`, `switch`, `alert`, `text` for intentionally inert rows — see
  `src/ui/SettingsRow.tsx`'s own reasoning for why a disabled/inert row is rendered as plain text
  rather than a disabled `Pressable`).
- `accessibilityLabel` on every icon-only control, always localized, always describing *purpose*
  ("Edit deck," "Delete card"), never a raw icon name or the word "button."
- `accessibilityHint` only where it adds real information beyond the label (e.g. "Double tap to
  open. Long press for rename or delete options.") — not duplicated into the label itself.
- `accessibilityState` for `disabled`, `selected`, `checked`, and `busy` wherever the control has
  that state, so screen readers announce it instead of a sighted user having to infer it from
  color/opacity alone.
- Every production screen's main title carries `accessibilityRole="header"`, so VoiceOver's/
  TalkBack's "navigate by headings" gesture works consistently across the app (added this batch —
  see §9 for the one screen this deliberately does **not** apply to and why).
- English and Spanish accessibility copy is held to the same key-parity discipline as all other
  Interval strings — no accessibility label or hint exists in only one language.

## 4. Text-to-speech behavior

Architecture: `src/accessibility/speech.ts` (thin wrapper around `expo-speech`, the only file
allowed to import it directly) → `src/accessibility/useSpeech.ts` (screen-scoped controller:
preference-aware, lifecycle-aware) → `src/ui/SpeakButton.tsx` (shared control) → wired into
`app/deck/[id]/review.tsx` and `app/deck/[id]/quiz.tsx`.

- **On-device only.** `expo-speech` drives the OS's native TTS engine (AVSpeechSynthesizer / Android
  TextToSpeech). No network request, no cloud service, no third party.
- **Never logged.** No spoken text is ever passed to `console.*` or any diagnostic path. No
  spoken-content history is persisted anywhere.
- **Explicit action only.** Speech never starts automatically — only when the user taps the
  speaker control. Nothing about opening Review or Quiz, or moving between cards, triggers speech.
- **One utterance at a time.** Starting new speech always stops any Interval speech already in
  progress first (`speech.ts`'s `speak()` calls `Speech.stop()` before `Speech.speak()`) — this is
  what makes rapid repeated taps safe by construction rather than by tracked state.
- **Stops on navigation and on content change.** `useSpeech`'s cleanup effect stops speech on
  unmount; `review.tsx` and `quiz.tsx` additionally stop speech whenever the card/question index
  (or, in Review, the flip state) changes, so speech never continues over stale content.
- **Review**: a speaker control reads the currently-displayed side of the card (question before
  reveal, answer after) — one button whose label and target text follow the flip state.
- **Quiz**: a speaker control reads the current question. Answer choices are deliberately **not**
  auto-read as a block — `src/ui/AnswerOption.tsx` already carries a real accessibility label per
  choice, so screen-reader users navigate choices the same natural way sighted users read them,
  rather than sitting through a spoken list read in a fixed, possibly confusing order.
- **Failures never block studying.** `speech.ts` never throws; a platform-level TTS failure routes
  to `onError`, which just resets the "speaking" state — the same as speech ending normally.
- **Language**: follows Interval's own current UI language (`en`/`es`, mapped to `en-US`/`es-ES`)
  — never inferred from card content, which this app has no reliable way to detect. This is a
  deliberate, evidence-based choice, not an oversight (see `src/accessibility/speech.ts`).
- **Rate**: user-configurable (Slower / Standard / Faster) under Settings → Accessibility.
- **Not added**: TTS on the card-editing screens (add/edit card). The mission scoped this as
  "only if architecturally useful," and previewing content you are actively typing has no clear
  use case distinct from just reading what you typed — skipped rather than added speculatively.

## 5. Reduced-motion behavior

**Before this batch**: Interval already had real reduced-motion support — `src/ui/BrandStartup.tsx`
(the branded startup animation) and `app/sign-in-transition.tsx` (the post-sign-in fade) both
already called `AccessibilityInfo.isReduceMotionEnabled()` and shortened/removed their animation
accordingly (startup skips its motion sequence and settles immediately; the transition fade
duration drops to 0). This was confirmed by direct code reading, not assumed. No other screen in
the app uses any animation library (`react-native-reanimated`/`Animated`) at all — review, quiz,
and every other screen have no motion to reduce in the first place.

**What changed this batch**: an additional, explicit, in-app "Reduce motion in Interval" toggle
(Settings → Accessibility) that layers on top of — never replaces — the system signal. Both
`BrandStartup.tsx` and `sign-in-transition.tsx` now check `reduced = systemReduceMotion ||
inAppOverride`. This exists for users who want calmer motion in Interval specifically without
changing a device-wide OS setting (or who don't know the OS setting exists). The default is off;
the system preference alone still governs unless a user explicitly opts in.

Requirements confirmed:
- No required information depends on animation (the startup sequence's content is identical with
  or without motion, just presented instantly instead of animated).
- No screen can become stuck on a skipped animation-completion callback — both reduced-motion
  paths were already backstop-timed before this batch (BrandStartup has an explicit 300ms
  reduce-motion-query backstop; the override is folded into that exact same backstop path).
- The normal-motion startup sequence for users with neither signal enabled is untouched, byte-for-
  byte, by this batch.

### Reduced motion: two paths, both intentional

Founder iOS Simulator QA observed two visibly different (but both correct) startup experiences
depending on *which* reduced-motion signal is active, and confirmed this is expected rather than
an inconsistency to fix:

- **System Reduce Motion enabled** (the OS-level setting): the native splash screen itself can
  read this preference before React Native ever starts, so Interval skips the startup animation
  entirely — the native splash hands off straight into the app.
- **Only Interval's in-app override enabled** (system setting off, override on in Settings →
  Accessibility): the native splash has no way to know about this preference — it's stored in
  AsyncStorage, which is only readable once the JavaScript runtime has initialized. So the native
  splash hands off normally, React Native mounts, `BrandStartup` reads the persisted override
  (see `initAccessibilityPreferences()` in `app/_layout.tsx`), and — because it's now known to be
  a reduced-motion session — renders a static Interval logo bridge frame instead of the animated
  sequence, then proceeds into the app. The result is a brief static-logo frame rather than an
  instant hand-off, purely because of *when* each signal becomes readable, not because the
  override "does less" than the system setting.

Both paths converge on the same outcome that matters: no animated motion sequence plays. Neither
path can become stuck, and neither depends on information the other path doesn't also provide.
This timing difference is a property of how native splash screens and AsyncStorage-backed
preferences resolve at different points in app startup — not a bug, and not planned to be
"fixed" into pixel-identical behavior, since doing so would require either delaying the native
splash hand-off (regressing launch speed for everyone) or giving the override native-level
storage it doesn't need for any other reason.

## 6. Large-text expectations

Audited, no code changes required — evidence, not assumption:
- Zero uses of `allowFontScaling={false}` anywhere in the app (confirmed by repository-wide
  search). Font scaling has never been disabled.
- Zero uses of `maximumFontSizeMultiplier` anywhere in the app.
- `src/ui/Button.tsx`, `src/ui/SettingsRow.tsx`, and other interactive rows size themselves with
  `minHeight` (grows with content), never a fixed `height` that could clip scaled text.
- `numberOfLines` is used in a small number of places (deck titles, screen headers, filenames) for
  visual truncation — this is a standard, acceptable pattern: VoiceOver/TalkBack read the full
  underlying text regardless of visual truncation, since the accessibility label is the full
  string, not the visually-clipped one.

No focused layout fix was made under this heading because no concrete clipping/blocking issue was
found by direct evidence. This is a "verified clean," not an "assumed clean."

## 7. Sensory considerations

- Interval does not currently use haptics anywhere (`expo-haptics` is an installed dependency but
  has zero call sites in the app) — no haptics toggle was added, since there is nothing to
  control yet. Documented here so a future haptics addition remembers to add the toggle at that
  time, not before.
- Interval's animation surface is already minimal (§5) — no separate "reduce visual transitions"
  toggle was added beyond the reduced-motion override, since it would control the exact same two
  animated surfaces and would be a redundant, unimplemented-feeling second switch.
- "Calmer study presentation" was considered and not implemented as its own toggle: Review and
  Quiz have no animation or visual density to dial back independently of what reduced motion
  already covers, and inventing new visual behavior here would be a redesign, out of this batch's
  scope.
- Announcements (via `AccessibilityInfo.announceForAccessibility`) are used selectively, not for
  every state change — see §3's screen-reader standard and the two concrete additions in §9.

## 8. Localization expectations

Every accessibility label, hint, and the new Accessibility settings screen's copy has full
English/Spanish key parity, following the same convention as the rest of the app (see
`src/i18n/locales/en.ts` / `es.ts`). No accessibility-specific string is exempt from translation.

## 9. Known limitations

- **No certification.** Restated from the top of this document deliberately — this is a
  foundation, not a compliance claim.
- **No VoiceOver/TalkBack device testing has been performed by this batch.** Every claim above is
  a code-level, static-evidence claim (role/label/state present, logic verified by reading), not a
  runtime-verified claim. See `docs/v3-beta-release-checklist.md`'s Accessibility section for what
  still needs a real device pass.
- **`app/deck/[id]/quiz.tsx`'s question text (`typography.title` styling) is intentionally not
  marked `accessibilityRole="header"`** — unlike every other screen's title, this text is dynamic
  quiz content, not a page heading, and mislabeling it would be semantically wrong.
- **Review mode has no "previous card" control** — this reflects the app's actual current study
  flow (forward-only, matching its spaced-repetition-adjacent design), not an accessibility gap.
  Adding previous-card navigation would be a new study feature, out of scope for this batch.
- **Neither Review nor Quiz has inline difficulty controls** — difficulty is set when creating/
  editing a card, or in bulk from deck detail. Not an accessibility gap; reflects existing product
  scope.
- **No formal contrast audit was performed.** No specific marginal-contrast case was identified by
  this batch's review, but this batch also did not run pixel-level contrast measurement tooling —
  absence of a finding here is not the same as a clean bill of health.
- **Android has not received TalkBack testing** — consistent with Interval's existing "Android
  buildable, manual QA pending" status (see `docs/platform-scope.md`).

## 10. Required checklist for every future feature

Before shipping any new screen or interactive control:

- [ ] Every icon-only control has a localized `accessibilityLabel` describing its purpose.
- [ ] `accessibilityRole` matches the control's real behavior.
- [ ] `accessibilityState` reflects disabled/selected/checked/busy where applicable.
- [ ] No information is conveyed by color alone.
- [ ] No interaction requires a gesture with no button/control equivalent.
- [ ] No essential information depends on an animation completing.
- [ ] New animation respects Reduce Motion (system signal, combined with
      `getAccessibilityPreferences().reduceMotionOverride`).
- [ ] New text does not disable font scaling (no `allowFontScaling={false}`, no
      `maximumFontSizeMultiplier` unless a specific, documented reason exists).
- [ ] New English strings have a Spanish counterpart, including accessibility copy.
- [ ] If the feature reads or generates study content, speech/logging rules from §4 are followed
      (never auto-play, never log content).

## 11. Future document/AI accessibility requirements

No document upload or AI features exist in this batch — this section exists so a future batch
that adds them inherits an accessible foundation instead of retrofitting one. When that work
happens, it must support:

- **Reading imported notes aloud** — reuse `src/accessibility/speech.ts`/`useSpeech.ts` rather
  than building a second speech path; imported note content is still study content under §4's
  "never logged" rule.
- **Reading AI-generated flashcards aloud** — same reuse; AI-generated content should be
  announced as such (see "source/provenance announcements" below) before being read, so a user
  isn't misled about what they're hearing.
- **Accessible file-picker controls** — `expo-document-picker` (already used by `app/import.tsx`)
  already integrates with the OS's own accessible file picker UI; a future document-upload flow
  should keep using the OS picker rather than a custom in-app file browser, which would need to
  reimplement accessibility from scratch.
- **Accessible Review & Approve screens** — any future "review AI output before saving" screen
  must follow §3's semantic standard from day one: real headers, real labels on approve/reject/
  edit controls, and correctness/status never conveyed by color alone (the same standard
  `src/ui/AnswerOption.tsx` already meets today).
- **Generated-content headings** — AI- or import-generated screens need real
  `accessibilityRole="header"` landmarks the same as every other screen (§3), so screen-reader
  users can navigate generated content structurally, not just linearly.
- **Source/provenance announcements** — where content is imported or AI-generated rather than
  user-authored, that provenance should be exposed to assistive technology (e.g. as part of a
  card's accessibility label or a heading), not conveyed only through visual styling (an icon or
  badge color).
- **Accessible progress indicators during parsing/generation** — reuse the existing
  `accessibilityRole="progressbar"` pattern already established in `src/ui/ProgressBar.tsx`
  (role + `accessibilityValue`), rather than a purely visual spinner with no accessible progress
  semantics.

No speculative components were built for any of this in the current batch — this section is
documentation only, per the mission's explicit scope.

## Voice and Recorded-Audio Input — Future Requirements

Nothing in this section is implemented. No voice-created decks, no recorded-lecture ingestion, no
document upload, and no AI exist in this batch or are planned for the current one. This is
documentation only, written now so that whenever this work does happen, it inherits the same
accessibility discipline the rest of the app already has, rather than needing an accessibility
retrofit afterward. No vendor, pricing, or backend implementation is specified or implied below —
those are separate decisions for whenever this work is actually planned.

### 1. Short-form voice-created deck flow

A future flow where a user speaks a short prompt to create a deck or cards, rather than typing:

- Explicit microphone activation only — recording never starts implicitly (e.g. from opening a
  screen); it requires a distinct, deliberate user action, consistent with §1's "explicit user
  action" principle already applied to text-to-speech.
- Speech-to-text conversion of what the user said.
- AI organization of the transcribed text into draft study material.
- The result is a set of **draft** cards/questions, not final data.
- A Review & Approve step — the user reviews and explicitly approves before anything is saved as
  real deck/card data.
- No automatic saving of AI-produced drafts. This mirrors this app's existing "no destructive
  action without confirmation" pattern (see e.g. Recently Deleted, Force Resync) applied to
  content creation instead of deletion.

### 2. Long-form recorded-lecture flow

A future flow for recording or uploading a longer audio source (e.g. a lecture) and generating
study material from it:

- The user records audio directly in-app, or uploads an existing audio file.
- The original audio is treated as a private source file, stored in a future "Library" area —
  not automatically shared, exported, or synced anywhere beyond the user's own account scope.
- Transcription of the audio into text.
- Topic segmentation of the transcript into logical sections.
- Generation of summaries, cards, quizzes, and/or practice exams from the segmented transcript.
- Provenance linking: every generated piece of study material should be traceable back to the
  specific recording and transcript section it came from — not presented as if it appeared from
  nowhere.
- A Review & Approve step, same as the short-form flow — generated material is draft material
  until the user explicitly approves it.

### 3. Accessibility requirements

These apply to both flows above, whenever they're built:

- All controls (record, stop, cancel, upload, approve, reject, edit) carry real, localized
  `accessibilityLabel`s — no icon-only control without one, per §3's existing standard.
- Recording state (recording / paused / stopped / processing) is announced to assistive
  technology, not conveyed only by a visual indicator changing.
- Elapsed recording time is not color-only — shown as text (e.g. a numeric timer), the same
  color-independence principle already applied throughout this app (§7, and e.g.
  `src/ui/AnswerOption.tsx`'s existing correct/incorrect handling).
- Stop/cancel is always reachable while recording — never a state the user can get stuck in
  without an exit.
- The transcript is navigable by headings (topic segments become real
  `accessibilityRole="header"` landmarks — see §11's "generated-content headings" requirement,
  which applies here too).
- Generated drafts (summaries, cards, quizzes) are readable aloud — reuse
  `src/accessibility/speech.ts`/`useSpeech.ts` rather than a second speech implementation, per
  §11.
- No auto-recording and no auto-speech — both require the same explicit user action this app
  already requires for text-to-speech (§4) and any destructive action.

### 4. Trust and safety requirements

- Explicit consent before any recording begins — a clear, understandable statement of what will
  happen to the audio (transcribed, processed, stored), not buried in a general terms document.
- Clear microphone permission handling, using the OS's own permission prompt — no attempt to
  infer or bypass it.
- A reminder about recording-law and institutional-policy considerations (e.g. some jurisdictions
  and institutions restrict recording lectures or conversations without consent from other
  parties present) — surfaced to the user before recording, not assumed to be their problem alone.
- Recorded audio and transcripts are private by default — scoped to the user's own account,
  never shared or made discoverable to anyone else by default.
- The user can delete both the audio and its transcript, and deletion should actually remove them
  (subject to this app's existing soft-delete/tombstone and sync model — see
  `docs/sync-invariants.md` — the same honest "soft delete, not instantly purged everywhere"
  framing already used for decks/cards should apply here too, not a stronger promise this app
  can't currently keep).
- Duration and/or file-size limits, so a user can't unknowingly start an unbounded recording or
  upload.
- No study-content logging — recorded audio, transcripts, and generated content are study content
  under §4's existing "never logged" rule; this extends that rule rather than creating a new one.
- No background recording without explicit action — recording must not continue, or restart,
  without the user actively choosing it each time.
