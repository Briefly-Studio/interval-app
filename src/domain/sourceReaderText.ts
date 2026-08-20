import { chunkTextPreviewContent, TEXT_PREVIEW_CHUNK_CHARS } from "./sourcePreviewText";

// Full Reader text strategy — deliberately distinct from ./sourcePreviewText.ts's 1 MB Quick
// Preview threshold, which stays exactly as-is (see that file). This is NOT a streaming or
// byte-range reader: `expo-file-system`'s `File.text()` (used by the reader route) reads the
// entire file into a single JS string in one operation, the same primitive Quick Preview already
// uses for files under its threshold. True ranged/partial reads exist on `File` only for
// `position`/`length`-qualified Base64 reads or the lower-level `readableStream()`/`slice()`
// primitives — neither is used here: Base64 range slicing risks splitting a multi-byte UTF-8
// character across a chunk boundary (a real risk for this app's non-Latin-script locales), and
// `readableStream()` on this Expo SDK/New Architecture combination has not been device-verified
// for this app, so it is deliberately deferred rather than shipped unverified — see this file's
// own comment trail in the mission history for that reasoning.
//
// What IS actually bounded: render-time native view count. `chunkTextReaderContent` (a direct
// reuse of Quick Preview's own chunking algorithm — same fix for the same iOS giant-single-Text
// blank-render failure mode) splits the fully-read string into fixed-size pieces that the reader
// route renders through a virtualized `FlatList`, so only the chunks near the visible viewport are
// ever mounted as native Text nodes, regardless of total file length.
export const MAX_TEXT_READER_BYTES = 25 * 1024 * 1024;

export type TextReaderFileInspection = { status: "readable" } | { status: "missing" } | { status: "too-large" };

/**
 * `too-large` here is a device-memory safety ceiling (25 MB — 25x Quick Preview's UX-oriented 1 MB
 * threshold), not a product-imposed reading limit: every realistic book/chapter/article-length
 * text source (typically well under 5 MB even for a full novel) reads successfully. It exists
 * only to avoid attempting a single-string JS allocation large enough to risk an out-of-memory
 * crash on a genuinely pathological file.
 */
export function inspectTextReaderFile(file: { exists: boolean; size?: number }): TextReaderFileInspection {
  if (!file.exists || file.size === undefined) return { status: "missing" };
  if (file.size > MAX_TEXT_READER_BYTES) return { status: "too-large" };
  return { status: "readable" };
}

export { TEXT_PREVIEW_CHUNK_CHARS as TEXT_READER_CHUNK_CHARS };
export const chunkTextReaderContent = chunkTextPreviewContent;
