import * as Sharing from "expo-sharing";

import type { SourceType } from "../models/librarySource";
import { prepareViewerCopy } from "../storage/librarySourceFileStorage";

// Platform-native "open original" handoff — deliberately NOT a bespoke embedded viewer. Uses
// expo-sharing's OS-native share/activity sheet (iOS UIActivityViewController — which offers an
// inline preview of the file before the user picks an action — and Android's ACTION_SEND
// chooser), the exact same already-proven pattern this app already uses for deck export (see
// app/deck/[id]/export.tsx). Already installed (`expo-sharing`), already Expo-Go-compatible on
// this SDK (confirmed by that existing usage), no new dependency, no native-module/Development
// Build risk. See docs/library-and-source-architecture.md's "Source open/preview" section for the
// full architecture decision record (why not a bespoke PDF renderer, why not a WebView-based
// viewer).
//
// Android nuance, documented rather than silently assumed: expo-sharing's Android implementation
// issues an `ACTION_SEND` intent (a "share/open with" chooser), not `ACTION_VIEW` (a dedicated
// "view" intent). In practice the same installed apps (Files, Drive, Acrobat, image/gallery apps,
// etc.) handle both for common document/image types, so the user-visible outcome — pick an app,
// see the file — is equivalent even though the underlying Android intent action differs from
// iOS's inline-preview-capable share sheet.
//
// FILE-EXTENSION FIX (founder QA incident): the `mimeType`/`UTI` options below are hints only —
// founder QA on physical iPhone/Simulator proved they are NOT sufficient by themselves. iOS's
// share sheet / Quick Look preview determines file type primarily from the file extension on the
// URL it's handed, not from these accompanying hints — handed the canonical durable path directly
// (which is deliberately extensionless, see src/storage/librarySourceFileStorage.ts), iOS showed
// a generic "File"/"data" classification using the bare source id as the filename, and Quick Look
// could not render the PDF. The fix: before handing off, this module asks
// `prepareViewerCopy` for a short-lived, extension-bearing COPY of the durable original
// (`<sourceId>.<safeExtension>`, Cache-based, never the canonical file) and hands that copy's URI
// to `Sharing.shareAsync` instead — the canonical durable file itself is never renamed or touched.

type ViewerHint = { mimeType: string; UTI: string; extension?: string };

// UTI (iOS) / mimeType (both platforms) / extension hints per source type, used only to help the
// OS present the right preview/app choices — never used to validate or gate anything. `extension`
// is deliberately a small, hardcoded, trusted set — NEVER derived from an original filename (a
// user- or picker-supplied string), which is exactly what would let unvalidated text reach a
// filesystem path (see prepareViewerCopy's own SAFE_EXTENSION check for the defense-in-depth
// backstop). `docx` distinguishes real legacy `.doc` (application/msword) from modern `.docx`
// using the source's actual captured MIME type — sourceType alone can't tell them apart, since a
// user picking a legacy Word file still selects "docx" from the metadata form's type dropdown.
const VIEWER_HINTS: Partial<Record<SourceType, (mimeType: string | undefined) => ViewerHint>> = {
  pdf: () => ({ mimeType: "application/pdf", UTI: "com.adobe.pdf", extension: "pdf" }),
  docx: (mimeType) =>
    mimeType === "application/msword"
      ? { mimeType, UTI: "com.microsoft.word.doc", extension: "doc" }
      : {
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          UTI: "org.openxmlformats.wordprocessingml.document",
          extension: "docx",
        },
  text: () => ({ mimeType: "text/plain", UTI: "public.plain-text", extension: "txt" }),
  pptx: () => ({
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    UTI: "org.openxmlformats.presentationml.presentation",
    extension: "pptx",
  }),
  xlsx: () => ({
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    UTI: "org.openxmlformats.spreadsheetml.sheet",
    extension: "xlsx",
  }),
};

// Real MIME type was already captured from the picked file at attach time (see
// app/library/add.tsx) — more accurate than guessing jpeg vs. png vs. heic from sourceType alone.
// Only a small, trusted, known-safe set gets a viewer-copy extension; an unrecognized image MIME
// type falls back to no extension (see resolveViewerHint) rather than guessing wrong.
const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
};

function resolveViewerHint(source: { sourceType: SourceType; mimeType?: string }): ViewerHint {
  const known = VIEWER_HINTS[source.sourceType];
  if (known) return known(source.mimeType);
  if (source.sourceType === "image") {
    const mimeType = source.mimeType || "image/jpeg";
    const extension = IMAGE_MIME_EXTENSIONS[mimeType];
    return { mimeType, UTI: "public.image", extension };
  }
  // audio and any future/unlisted type: no audio file-intake UI exists yet (see
  // docs/library-and-source-architecture.md's "Supported input scope"), so this generic fallback
  // is only ever reached defensively, never as an expected path today. No safe extension exists
  // for a generic/unknown type — never fabricate one (e.g. never default to "pdf").
  return { mimeType: source.mimeType || "application/octet-stream", UTI: "public.data" };
}

export type OpenFileResult = { ok: true } | { ok: false; reason: "unsupported-viewer" | "handoff-failed" };

/**
 * Hands a local file off to the OS-native viewer/share surface. `uri` must already be a local
 * `file://` path to the CANONICAL durable original — this never fetches anything itself (see
 * src/cloud/librarySourceStorage/openSource.ts for local-first resolution + cloud fallback).
 * Internally may substitute a short-lived, extension-bearing viewer copy for the actual handoff
 * (see this file's header comment) — the canonical file at `uri` is never modified either way.
 */
export async function openSourceFile(
  uri: string,
  source: { id: string; sourceType: SourceType; mimeType?: string; displayTitle: string }
): Promise<OpenFileResult> {
  try {
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      return { ok: false, reason: "unsupported-viewer" };
    }

    const { mimeType, UTI, extension } = resolveViewerHint(source);

    let handoffUri = uri;
    if (extension) {
      const viewerCopyUri = await prepareViewerCopy(source.id, extension);
      // Graceful degradation, not a hard failure: if the viewer copy couldn't be created for any
      // reason, still attempt the handoff with the original (extensionless) canonical file and
      // the MIME/UTI hints alone, rather than blocking "Open original" entirely.
      if (viewerCopyUri) handoffUri = viewerCopyUri;
    }

    await Sharing.shareAsync(handoffUri, { mimeType, UTI, dialogTitle: source.displayTitle });
    return { ok: true };
  } catch (error) {
    if (__DEV__) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.warn(`[LibrarySourceOpen] openSourceFile failed — ${detail}`);
    }
    return { ok: false, reason: "handoff-failed" };
  }
}
