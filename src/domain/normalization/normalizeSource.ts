import { File } from "expo-file-system";

import { resolveSourceOriginal } from "../../cloud/librarySourceStorage/openSource";
import type { LibrarySourceRecord } from "../../models/librarySource";
import { prepareViewerInput } from "../sourceViewer";
import { normalizeAudioSource } from "./audioAdapter";
import { normalizeDocxSource } from "./docxAdapter";
import { normalizeImageSource } from "./imageAdapter";
import { normalizePdfTextSource } from "./pdfAdapter";
import { extractPdfPageTexts } from "./pdfTextExtraction";
import { normalizeSpreadsheetSource } from "./spreadsheetAdapter";
import { inspectTextForNormalization, MAX_NORMALIZATION_TEXT_BYTES, normalizeTextSource } from "./textAdapter";
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
 * Image and audio metadata come entirely from already-known `LibrarySourceRecord` fields — no
 * file resolution, since neither adapter extracts anything from the file's own bytes (no OCR, no
 * transcription; see imageAdapter.ts/audioAdapter.ts). `text`, `pdf`, and `docx` are the three
 * adapters that actually resolve/read the underlying file via the exact same local-first/
 * cloud-fallback resolution and viewer-input staging every Reader/Preview screen already uses —
 * `pdf` via native text extraction (pdfTextExtraction.ts, never OCR), `docx` via the existing
 * WordprocessingML block parser (docxAdapter.ts/sourceReaderDocx.ts, reused as-is from the DOCX
 * Reader). See each adapter's own header comment for its full data flow.
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
    const resolved = await resolveSourceOriginal(source);
    if (resolved.status === "error") {
      logNormalization("resolution failed", { sourceType: source.sourceType, reason: resolved.reason });
      return result("failed", stubContent(source, "failed", "pdf-text-v1", `source-resolution-${resolved.reason}`, source.fileSize));
    }

    const input = await prepareViewerInput(resolved.uri, source);
    if (!input.usedStagedCopy) {
      logNormalization("staging failed", { sourceType: source.sourceType });
      return result("failed", stubContent(source, "failed", "pdf-text-v1", "could-not-stage-local-copy", source.fileSize));
    }

    const extraction = await extractPdfPageTexts(input.uri);

    if (extraction.status === "unavailable") {
      // The native extraction module genuinely isn't loaded in this runtime (e.g. Expo Go, or a
      // build that hasn't picked up the native dependency yet) — this is a capability-not-ready
      // state, not evidence the PDF itself is unreadable, so it gets the same honest
      // `pending-extraction` treatment (and the same "not ready for generation yet" UI copy)
      // this adapter used before real extraction existed, rather than a scarier `failed`.
      logNormalization("done", { sourceType: source.sourceType, status: "pending-extraction" });
      return result(
        "pending-extraction",
        stubContent(source, "pending-extraction", "pdf-pending-v1", "native-pdf-extraction-module-unavailable", source.fileSize)
      );
    }
    if (extraction.status === "password-protected") {
      logNormalization("done", { sourceType: source.sourceType, status: "failed" });
      return result("failed", stubContent(source, "failed", "pdf-text-v1", "password-protected", source.fileSize));
    }
    if (extraction.status === "too-many-pages") {
      logNormalization("done", { sourceType: source.sourceType, status: "too-large" });
      return result("too-large", stubContent(source, "too-large", "pdf-text-v1", "exceeds-max-page-count-for-extraction", source.fileSize));
    }
    if (extraction.status === "failed") {
      logNormalization("done", { sourceType: source.sourceType, status: "failed" });
      return result("failed", stubContent(source, "failed", "pdf-text-v1", extraction.reason, source.fileSize));
    }
    if (extraction.status === "empty") {
      // Legitimately no usable text — most commonly a scanned/image-only PDF. Never OCR'd, never
      // invented; "empty" is the same honest status a zero-byte TXT file gets, and reuses the
      // same "nothing to generate from" UI copy.
      logNormalization("done", { sourceType: source.sourceType, status: "empty" });
      return result("empty", {
        sourceId: source.id,
        sourceType: source.sourceType,
        title: source.displayTitle,
        originalName: source.originalName,
        language: source.sourceLanguage,
        contentKind: "text",
        chunks: [],
        metadata: { byteSize: source.fileSize, pageCount: source.pageCount },
        extraction: { status: "empty", adapter: "pdf-text-v1", reason: "no-extractable-text-possibly-scanned" },
        normalizationVersion: NORMALIZATION_VERSION,
      });
    }

    // extraction.status === "ready" — real, non-empty, page-ordered text. Size-gated the same
    // way the text adapter gates raw file bytes, applied here to total extracted characters
    // (PDF file size doesn't predict extracted-text size the way a plain-text file's byte size
    // does — a large PDF can be mostly images with little text, or a small one can be dense).
    const totalExtractedChars = extraction.pages.reduce((sum, pageText) => sum + pageText.length, 0);
    if (totalExtractedChars > MAX_NORMALIZATION_TEXT_BYTES) {
      logNormalization("done", { sourceType: source.sourceType, status: "too-large" });
      return result("too-large", stubContent(source, "too-large", "pdf-text-v1", "exceeds-10mb-normalization-limit", source.fileSize));
    }

    const outcome = normalizePdfTextSource({
      sourceId: source.id,
      sourceType: source.sourceType,
      title: source.displayTitle,
      originalName: source.originalName,
      language: source.sourceLanguage,
      byteSize: source.fileSize,
      pages: extraction.pages,
    });

    if (outcome.status === "too-large") {
      logNormalization("done", { sourceType: source.sourceType, status: "too-large" });
      return result("too-large", stubContent(source, "too-large", "pdf-text-v1", "exceeds-chunk-count-safety-ceiling", source.fileSize));
    }
    if (outcome.status === "failed") {
      logNormalization("done", { sourceType: source.sourceType, status: "failed" });
      return result("failed", stubContent(source, "failed", "pdf-text-v1", "pdf-text-normalization-failed", source.fileSize));
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

  if (source.sourceType === "docx") {
    const resolved = await resolveSourceOriginal(source);
    if (resolved.status === "error") {
      logNormalization("resolution failed", { sourceType: source.sourceType, reason: resolved.reason });
      return result("failed", stubContent(source, "failed", "docx-structured-v1", `source-resolution-${resolved.reason}`, source.fileSize));
    }

    const input = await prepareViewerInput(resolved.uri, source);
    if (!input.usedStagedCopy) {
      logNormalization("staging failed", { sourceType: source.sourceType });
      return result("failed", stubContent(source, "failed", "docx-structured-v1", "could-not-stage-local-copy", source.fileSize));
    }

    let archiveBytes: Uint8Array;
    try {
      archiveBytes = await new File(input.uri).bytes();
    } catch (error) {
      logNormalization("docx read failed", { error: safeErrorDetail(error) });
      return result("failed", stubContent(source, "failed", "docx-structured-v1", "docx-file-read-failed", source.fileSize));
    }

    const outcome = normalizeDocxSource({
      sourceId: source.id,
      sourceType: source.sourceType,
      title: source.displayTitle,
      originalName: source.originalName,
      language: source.sourceLanguage,
      byteSize: source.fileSize,
      archiveBytes,
    });

    if (outcome.status === "too-large") {
      logNormalization("done", { sourceType: source.sourceType, status: "too-large" });
      return result("too-large", stubContent(source, "too-large", "docx-structured-v1", "exceeds-docx-size-or-block-ceiling", source.fileSize));
    }
    if (outcome.status === "unsupported") {
      // A valid ZIP that isn't a real WordprocessingML package — most commonly an encrypted/
      // password-protected DOCX (see docxAdapter.ts). Mapped to "failed" (not "unsupported") for
      // Generate Study Deck specifically: "unsupported" in this UI means "this FORMAT can never
      // work," which would misrepresent an otherwise-ordinary DOCX that merely couldn't be opened
      // this time — the same honest distinction PDF already makes for a password-protected file.
      logNormalization("done", { sourceType: source.sourceType, status: "failed" });
      return result("failed", stubContent(source, "failed", "docx-structured-v1", "encrypted-or-unrecognized-docx", source.fileSize));
    }
    if (outcome.status === "failed") {
      logNormalization("done", { sourceType: source.sourceType, status: "failed" });
      return result("failed", stubContent(source, "failed", "docx-structured-v1", "docx-normalization-failed", source.fileSize));
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

  if (source.sourceType === "xlsx") {
    const resolved = await resolveSourceOriginal(source);
    if (resolved.status === "error") {
      logNormalization("resolution failed", { sourceType: source.sourceType, reason: resolved.reason });
      return result(
        "failed",
        stubContent(source, "failed", "spreadsheet-structured-v1", `source-resolution-${resolved.reason}`, source.fileSize)
      );
    }

    const input = await prepareViewerInput(resolved.uri, source);
    if (!input.usedStagedCopy) {
      logNormalization("staging failed", { sourceType: source.sourceType });
      return result("failed", stubContent(source, "failed", "spreadsheet-structured-v1", "could-not-stage-local-copy", source.fileSize));
    }

    let archiveBytes: Uint8Array;
    try {
      archiveBytes = await new File(input.uri).bytes();
    } catch (error) {
      logNormalization("spreadsheet read failed", { error: safeErrorDetail(error) });
      return result("failed", stubContent(source, "failed", "spreadsheet-structured-v1", "spreadsheet-file-read-failed", source.fileSize));
    }

    const outcome = normalizeSpreadsheetSource({
      sourceId: source.id,
      sourceType: source.sourceType,
      title: source.displayTitle,
      originalName: source.originalName,
      language: source.sourceLanguage,
      byteSize: source.fileSize,
      archiveBytes,
    });

    if (outcome.status === "too-large") {
      logNormalization("done", { sourceType: source.sourceType, status: "too-large" });
      return result(
        "too-large",
        stubContent(source, "too-large", "spreadsheet-structured-v1", "exceeds-spreadsheet-size-or-row-ceiling", source.fileSize)
      );
    }
    if (outcome.status === "unsupported") {
      // A valid ZIP that isn't a real SpreadsheetML package — most commonly an encrypted/
      // password-protected workbook. Mapped to "failed" for the same reason DOCX's own encrypted
      // case is: "unsupported" in Generate Study Deck means "this FORMAT can never work," which
      // would misrepresent an otherwise-ordinary workbook that merely couldn't be opened this
      // time.
      logNormalization("done", { sourceType: source.sourceType, status: "failed" });
      return result(
        "failed",
        stubContent(source, "failed", "spreadsheet-structured-v1", "encrypted-or-unrecognized-spreadsheet", source.fileSize)
      );
    }
    if (outcome.status === "failed") {
      logNormalization("done", { sourceType: source.sourceType, status: "failed" });
      return result("failed", stubContent(source, "failed", "spreadsheet-structured-v1", "spreadsheet-normalization-failed", source.fileSize));
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

  if (source.sourceType !== "text") {
    // pptx (and any future SourceType this dispatcher hasn't been taught about yet).
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
