# Audio Source Player

**Status: implemented and integrated into `v3.2-dev`; founder native-runtime QA verified**
(rebuilt Development Build containing the ExpoAudio native module, physical iPhone). Reconciled
onto the current canonical tree and merged via `merge: reconcile Audio player with v3.2
foundation` → `merge: integrate Audio source player`.

The Audio player is one of Interval's embedded Library source readers (alongside PDF, image,
text, and DOCX). It plays an audio Library source inside the app. It is **playback-only**.

## Dependencies

- **`expo-audio` `~1.1.1`** — native audio playback (`useAudioPlayer` / `useAudioPlayerStatus`).
- **`expo-asset` `~12.0.13`** — companion asset dependency pulled in with `expo-audio`.

Both are SDK-54-compatible (SDK 54 pins `expo-audio ~1.1.0`, `expo-asset ~12.0.11`);
`npx expo-doctor` does not flag either. No `app.json` config-plugin entry is required for
playback-only use.

## Architecture — native, client-only, playback-only

`app/library/[id]/reader.tsx` (`AudioPlayerView`) + `src/domain/sourceAudioPlayer.ts` (pure
helpers).

- **Local source resolution first.** The route uses the same local-first / on-demand
  cloud-fallback resolver as every other reader and "Open original" path
  (`resolveSourceOriginal` → `prepareViewerInput`). The audio kind has no special `load()`
  branch — it uses the common resolver tail, then hands the resolved file URI to `useAudioPlayer`.
- **`setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false })`** — audio
  plays with the ring/silent switch on (normal for a media player), but **not** in the
  background. Navigating away or backgrounding the app stops playback.
- **No recording. No microphone permission.** `allowsRecording` is never set; there is no
  `NSMicrophoneUsageDescription` and no `RECORD_AUDIO`. This feature is not an audio recorder and
  its scope must not be expanded to recording.
- **No background-audio entitlement.** No `UIBackgroundModes: audio`, no
  `staysActiveInBackground`. Background playback is not a current product requirement.
- **Cleanup**: `player.pause()` runs on component unmount and on source change; `useAudioPlayer`
  releases the native player when the component unmounts. Opening a different audio source does
  not leave the previous one playing.

## Controls

Play / pause / resume / replay, ±15-second seek, a draggable progress track, elapsed-time and
duration display, and a playback-speed row (`AUDIO_PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2]`).
Loading, buffering, "finished", and failure states each have their own copy. Source Detail shows
a **"Listen in Interval"** call to action for `sourceType: "audio"` (vs "Open in Interval" for
document readers).

## RTL / content direction

App chrome follows the active locale (RTL for Arabic). The **progress track is pinned
`direction: "ltr"`** so playback position always advances left-to-right regardless of chrome
direction.

## Source classification boundary — audio vs video

`sourceType: "audio"` is assigned by `src/domain/librarySourceFormat.ts` when the file's MIME
type is one of `audio/aac`, `audio/mpeg`, `audio/mp4`, `audio/wav`, `audio/x-m4a`, `audio/x-wav`
(MIME wins), else when the extension is `aac` / `m4a` / `mp3` / `wav`, else by the user's manual
source-type selection at add time.

- **There is no `video` `SourceType`** and no `video/*` MIME or `.mp4` / `.mov` extension in the
  format table. A video file is not detected as audio; `detectSourceTypeFromFile` returns
  `undefined`, the source is not routed to the Audio player, and only "Open original" (OS
  handoff) is offered.
- **File size does not affect classification or reader selection.** There is no size threshold
  anywhere in intake or reader resolution — `formatFileSize` is display-only. A large screen
  recording that is a video container is correctly handed off to the OS, not squeezed into the
  audio player; a smaller audio-only recording (`.m4a` / `.mp3`) plays in-app.

## Cloud / backend

- **No audio backend, no transcription.** The `audio` format is `uploadSupported: false` — audio
  originals are not accepted by the cloud-upload allow-list in any environment, so cross-device
  audio playback is limited to devices that already hold a local copy. Widening this is separate,
  backend-gated future work.
- Audio playback creates no storage record and no sync entity — playback state is in-memory only.

## Native build requirement

`expo-audio` contains native code, so runtime QA requires a Development Build that actually
contains the ExpoAudio module. From the audio worktree:
`npx expo run:ios --device` (or `xed ios` → Run in Xcode as the fallback), then
`npx expo start -c`.

## Tests

There is **no dedicated automated test suite for Audio.** `src/domain/sourceAudioPlayer.ts`'s
pure helpers (`formatPlaybackTime`, `playbackProgress`, `clampPlaybackPosition`,
`isPlaybackComplete`, `isAudioPlaybackRate`) are trivially testable and a `test:audio` suite
(matching `test:docx`) is a reasonable future addition.

## Known limitations / future work

- No cross-device audio (originals not cloud-synced anywhere).
- No background playback (by design, pending a real product requirement).
- No dedicated pure-helper test suite yet.
- No video source support anywhere in the app.
