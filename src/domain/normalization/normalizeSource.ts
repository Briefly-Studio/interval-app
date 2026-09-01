import { File } from "expo-file-system";

import { resolveSourceOriginal } from "../../cloud/librarySourceStorage/openSource";
import type { LibrarySourceRecord } from "../../models/librarySource";
import { prepareViewerInput } from "../sourceViewer";
import { normalizeAudioSource } from "./audioAdapter";
import { normalizeImageSource } from "./imageAdapter";
import { normalizePdfSource } from "./pdfAdapter";
import { inspectTextForNormalization, normalizeTextSource } from "./textAdapter";
import { NORMALIZATION_VERSION, type ExtractionStatus, type NormalizationResult, type NormalizedSourceContent } from "./types";

// Centralized adapter dispatch — the ONE place a future AI feature (or this file's own future
// extensions) asks "how do I get normalized content for this source", so sourceType branching
// never needs to be reinvented in a UI screen or a future generation pipeline. See
// docs/source-normalization-foundation.md for the full architecture record.
//
// Never logs source content — see `logNormalization` below; only source type, extraction status,
// byte/chunk counts, adapter name, and failure category are ever written to the console, and only
// in development builds.

function logNormalization(stage: string, detail?: Record<string, unknown>): void {
  if (!__DEV__) return;
  if (detail && Object.keys(detail).length > 0) {
    console.log(`[SourceNormalization] ${stage}`, detail);
  } else {
    console.log(`[SourceNormalization] ${stage}`);
  }
}

function safeErrorDetail(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Builds the uniform empty-chunk content shape shared by every non-ready/empty-with-text
 * outcome this dispatcher itself produces directly (as opposed to an adapter module's own
 * richer content, e.g. image/audio/pdf, which already include their own real metadata). */
function stubContent(
  source: LibrarySourceRecord,
  status: ExtractionStatus,
  adapter: string,
  reason: string,
  byteSize?: number
): NormalizedSourceContent {
  return {
    sourceId: source.id,
    sourceType: source.sourceType,
    title: source.displayTitle,
    originalName: source.originalName,
    language: source.sourceLanguage,
    contentKind: "unsupported",
    chunks: [],
    metadata: { byteSize },
    extraction: { status, adapter, reason },
    normalizationVersion: NORMALIZATION_VERSION,
  };
}

function result(status: ExtractionStatus, content: NormalizedSourceContent): NormalizationResult {
  return { status, content };
}

/**
 * Computes normalized, provenance-carrying content for a Library source. Always computed on
 * demand (see the architecture doc's Persistence policy) — nothing here writes to any storage
 * layer, cache, DynamoDB, or S3; calling this twice for the same source does the same work twice,
 * deterministically producing the same result both times (see chunking.ts).
 *
 * PDF and DOCX intentionally never attempt local-first/cloud-fallback file resolution at all —
 * their result (`pending-extraction`) is fixed regardless of whether the file is actually
 * available on this device or in the cloud, so resolving/downloading it first would be wasted
 * I/O (and, for a cloud-only source, an unnecessary network fetch) for an answer that's already
 * known. Image and audio metadata come entirely from already-known LibrarySourceRecord fields,
 * for the same reason. Only the `text` adapter — the one adapter that can actually produce
 * content in this batch — ever resolves/reads the underlying file.
 */
export async function normalizeSource(source: LibrarySourceRecord): Promise<NormalizationResult> {
  logNormalization("start", { sourceType: source.sourceType });

  if (source.sourceType === "image") {
    const outcome = normalizeImageSource({
      sourceId: source.id,
      sourceType: source.sourceType,
      title: source.displayTitle,
      originalName: source.originalName,
      language: source.sourceLanguage,
      byteSize: source.fileSize,
    });
    logNormalization("done", { sourceType: source.sourceType, status: outcome.status, adapter: outcome.content.extraction.adapter });
    return result(outcome.status, outcome.content);
  }

  if (source.sourceType === "audio") {
    const outcome = normalizeAudioSource({
      sourceId: source.id,
      sourceType: source.sourceType,
      title: source.displayTitle,
      originalName: source.originalName,
      language: source.sourceLanguage,
      byteSize: source.fileSize,
      durationSeconds: source.audioDuration,
    });
    logNormalization("done", { sourceType: source.sourceType, status: outcome.status, adapter: outcome.content.extraction.adapter });
    return result(outcome.status, outcome.content);
  }

  if (source.sourceType === "pdf") {
    const outcome = normalizePdfSource({
      sourceId: source.id,
      sourceType: source.sourceType,
      title: source.displayTitle,
      originalName: source.originalName,
      language: source.sourceLanguage,
      byteSize: source.fileSize,
      pageCount: source.pageCount,
    });
    logNormalization("done", { sourceType: source.sourceType, status: outcome.status, adapter: outcome.content.extraction.adapter });
    return result(outcome.status, outcome.content);
  }

  if (source.sourceType === "docx") {
    // See docxAdapter.ts's header comment — the real WordprocessingML parser lives on the
    // unmerged feat/document-reader-docx branch, which this mission must not touch or duplicate.
    logNormalization("done", { sourceType: source.sourceType, status: "pending-extraction", adapter: "docx-pending-v1" });
    return result(
      "pending-extraction",
      stubContent(source, "pending-extraction", "docx-pending-v1", "structured-document-adapter-not-yet-integrated", source.fileSize)
    );
  }

  if (source.sourceType !== "text") {
    // pptx/xlsx (and any future SourceType this dispatcher hasn't been taught about yet).
    logNormalization("done", { sourceType: source.sourceType, status: "unsupported" });
    return result(
      "unsupported",
      stubContent(source, "unsupported", "unsupported-format-v1", "no-normalization-adapter-for-this-format", source.fileSize)
    );
  }

  // Text: the one adapter that actually reads the file — reuses the exact same local-first/
  // cloud-fallback resolution and viewer-input staging every Reader/Preview screen already uses
  // (no second download pipeline, no persisted signed URL — see openSource.ts/sourceViewer.ts).
  const resolved = await resolveSourceOriginal(source);
  if (resolved.status === "error") {
    logNormalization("resolution failed", { sourceType: source.sourceType, reason: resolved.reason });
    return result(
      "failed",
      stubContent(source, "failed", "text-v1", `source-resolution-${resolved.reason}`, source.fileSize)
    );
  }

  const input = await prepareViewerInput(resolved.uri, source);
  if (!input.usedStagedCopy) {
    logNormalization("staging failed", { sourceType: source.sourceType });
    return result("failed", stubContent(source, "failed", "text-v1", "could-not-stage-local-copy", source.fileSize));
  }

  let file: { exists: boolean; size?: number };
  try {
    const f = new File(input.uri);
    file = f.exists ? { exists: true, size: f.size } : { exists: false };
  } catch (error) {
    logNormalization("file inspect failed", { error: safeErrorDetail(error) });
    return result("failed", stubContent(source, "failed", "text-v1", "file-inspection-failed", source.fileSize));
  }

  const inspection = inspectTextForNormalization(file);
  if (inspection.status === "missing") {
    return result("failed", stubContent(source, "failed", "text-v1", "local-file-missing-after-resolution", file.size));
  }
  if (inspection.status === "too-large") {
    return result("too-large", stubContent(source, "too-large", "text-v1", "exceeds-10mb-normalization-limit", file.size));
  }

  let rawText: string;
  try {
    rawText = await new File(input.uri).text();
  } catch (error) {
    logNormalization("text read failed", { error: safeErrorDetail(error) });
    return result("failed", stubContent(source, "failed", "text-v1", "text-read-failed", file.size));
  }

  const outcome = normalizeTextSource({
    sourceId: source.id,
    sourceType: source.sourceType,
    title: source.displayTitle,
    originalName: source.originalName,
    language: source.sourceLanguage,
    byteSize: file.size ?? 0,
    rawText,
  });

  if (outcome.status === "too-large") {
    return result("too-large", stubContent(source, "too-large", "text-v1", "exceeds-chunk-count-safety-ceiling", file.size));
  }
  if (outcome.status === "failed") {
    return result("failed", stubContent(source, "failed", "text-v1", "text-normalization-failed", file.size));
  }

  logNormalization("done", {
    sourceType: source.sourceType,
    status: outcome.status,
    adapter: outcome.content.extraction.adapter,
    chunkCount: outcome.content.chunks.length,
    byteSize: outcome.content.metadata.byteSize,
  });

  return result(outcome.status, outcome.content);
}

export { NORMALIZATION_VERSION };
