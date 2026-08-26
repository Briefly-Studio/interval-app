import { segmentText } from "./chunking";
import { NORMALIZATION_VERSION, type NormalizedSourceContent } from "./types";
import type { SourceType } from "../../models/librarySource";

// Plain TXT — the gold-standard first adapter (see docs/source-normalization-foundation.md).
// Deliberately separate from the existing Full Reader's own 25 MB device-memory safety ceiling
// (src/domain/sourceReaderText.ts's MAX_TEXT_READER_BYTES) rather than reusing it — normalization
// is a genuinely different workload with its own cost profile:
//   - The Reader's ceiling exists purely to bound a single JS string allocation for on-screen
//     display; normalization additionally runs paragraph-boundary regex scanning, per-chunk
//     line-range binary search, and per-chunk content hashing over that same text — real
//     additional CPU work proportional to size, run synchronously on demand (see the
//     Persistence/caching policy in the architecture doc — there is no background job here).
//   - A future AI consumer of normalized chunks has no realistic use for a single document
//     anywhere near 25 MB of raw text (order of several thousand book-equivalent pages) — a
//     document that large needs its own future "select relevant chunks from an oversized source"
//     design, not eager whole-document normalization today.
// 10 MB was chosen as a deliberately smaller, separately-justified ceiling: generous for any
// realistic book/chapter/article-length source (a very long novel is typically a few MB of plain
// text), while keeping normalization's own per-character work bounded to something that completes
// synchronously without risking a frozen UI thread if ever invoked from one.
export const MAX_NORMALIZATION_TEXT_BYTES = 10 * 1024 * 1024;

export type TextNormalizationInspection = { status: "readable" } | { status: "missing" } | { status: "too-large" };

export function inspectTextForNormalization(file: { exists: boolean; size?: number }): TextNormalizationInspection {
  if (!file.exists || file.size === undefined) return { status: "missing" };
  if (file.size > MAX_NORMALIZATION_TEXT_BYTES) return { status: "too-large" };
  return { status: "readable" };
}

/**
 * Normalizes line endings to LF-only WITHOUT removing any semantic content — `\r\n` and lone
 * `\r` both become `\n`; no blank lines are collapsed, no trailing whitespace is trimmed. All
 * chunk `charRange`/`lineRange` provenance refers to offsets in THIS normalized string, not the
 * raw bytes read from disk (documented on ChunkProvenance itself).
 */
export function normalizeLineEndings(rawText: string): string {
  return rawText.replace(/\r\n?/g, "\n");
}

export type TextAdapterOutcome =
  | { status: "ready"; content: NormalizedSourceContent }
  | { status: "empty"; content: NormalizedSourceContent }
  | { status: "too-large" }
  | { status: "failed" };

export type TextAdapterInput = {
  sourceId: string;
  sourceType: SourceType;
  title: string;
  originalName?: string;
  language?: string;
  byteSize: number;
  rawText: string;
};

/**
 * Pure — takes already-read raw text (the caller, normalizeSource.ts, is responsible for local-
 * first/cloud-fallback file resolution and the actual `File.text()` read; see that file for why
 * this split keeps the segmentation/normalization logic itself unit-testable without any RN
 * dependency). Deterministic: identical `rawText` always produces identical chunks/ids.
 */
export function normalizeTextSource(input: TextAdapterInput): TextAdapterOutcome {
  let normalized: string;
  try {
    normalized = normalizeLineEndings(input.rawText);
  } catch {
    return { status: "failed" };
  }

  if (normalized.length === 0) {
    return {
      status: "empty",
      content: {
        sourceId: input.sourceId,
        sourceType: input.sourceType,
        title: input.title,
        originalName: input.originalName,
        language: input.language,
        contentKind: "text",
        chunks: [],
        metadata: { byteSize: input.byteSize },
        extraction: { status: "empty", adapter: "text-v1" },
        normalizationVersion: NORMALIZATION_VERSION,
      },
    };
  }

  const { chunks, truncated } = segmentText(input.sourceId, normalized);
  if (truncated) return { status: "too-large" };

  return {
    status: "ready",
    content: {
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      title: input.title,
      originalName: input.originalName,
      language: input.language,
      contentKind: "text",
      chunks,
      metadata: { byteSize: input.byteSize },
      extraction: { status: "ready", adapter: "text-v1" },
      normalizationVersion: NORMALIZATION_VERSION,
    },
  };
}
