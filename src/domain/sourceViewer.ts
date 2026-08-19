import * as Sharing from "expo-sharing";

import type { SourceType } from "../models/librarySource";
import { prepareExportCopy, prepareViewerCopy } from "../storage/librarySourceFileStorage";
import { prepareSourceExportFilename, resolveSourceHandoffHint, type SourceHandoffHint } from "./librarySourceFormat";

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

export type OpenFileResult = { ok: true } | { ok: false; reason: "unsupported-viewer" | "handoff-failed" };

export type PreparedSourceFileInput = SourceHandoffHint & {
  uri: string;
  dialogTitle: string;
  usedStagedCopy: boolean;
};

export async function prepareViewerInput(
  uri: string,
  source: { id: string; sourceType: SourceType; mimeType?: string; displayTitle: string }
): Promise<PreparedSourceFileInput> {
  const hint = resolveSourceHandoffHint(source);
  let handoffUri = uri;
  if (hint.extension) {
    const viewerCopyUri = await prepareViewerCopy(source.id, hint.extension);
    // Graceful degradation, not a hard failure: if the viewer copy couldn't be created for any
    // reason, still attempt the handoff with the original (extensionless) canonical file and
    // the MIME/UTI hints alone, rather than blocking "Open original" entirely.
    if (viewerCopyUri) handoffUri = viewerCopyUri;
  }

  return { ...hint, uri: handoffUri, dialogTitle: source.displayTitle, usedStagedCopy: handoffUri !== uri };
}

export async function prepareSourceExport(
  uri: string,
  source: {
    id: string;
    sourceType: SourceType;
    mimeType?: string;
    originalName?: string;
    displayTitle: string;
  }
): Promise<PreparedSourceFileInput> {
  const hint = resolveSourceHandoffHint(source);
  const exportFileName = prepareSourceExportFilename(source);
  const exportCopyUri = await prepareExportCopy(source.id, exportFileName);
  return { ...hint, uri: exportCopyUri ?? uri, dialogTitle: source.displayTitle, usedStagedCopy: !!exportCopyUri };
}

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

    const input = await prepareViewerInput(uri, source);
    await Sharing.shareAsync(input.uri, { mimeType: input.mimeType, UTI: input.UTI, dialogTitle: input.dialogTitle });
    return { ok: true };
  } catch (error) {
    if (__DEV__) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.warn(`[LibrarySourceOpen] openSourceFile failed — ${detail}`);
    }
    return { ok: false, reason: "handoff-failed" };
  }
}
