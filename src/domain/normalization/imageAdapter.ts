import { NORMALIZATION_VERSION, type NormalizedSourceContent } from "./types";
import type { SourceType } from "../../models/librarySource";

// Image sources carry no extractable text in this batch — no OCR, no vision model call, exactly
// as scoped (see docs/source-normalization-foundation.md). This adapter exists so `normalizeSource`
// still returns a real NormalizedSourceContent for an image source (contentKind: "image", zero
// chunks, extraction.status: "unsupported") rather than a bare error — a future AI feature can
// inspect `content.metadata`/`content.title` even though there is no text to chunk today, and a
// future OCR/vision adapter has a clear, already-defined slot to fill in (see the architecture
// doc's "Future image/audio adapters" section) without changing this contract's shape.
//
// IMPORTANT: `title`/`displayTitle` is NEVER treated as extracted image content — it's the
// source's own identity field, populated on every content kind, not a substitute for text this
// adapter has no way to actually read from the image's pixels.
export type ImageAdapterInput = {
  sourceId: string;
  sourceType: SourceType;
  title: string;
  originalName?: string;
  language?: string;
  byteSize?: number;
};

export function normalizeImageSource(input: ImageAdapterInput): { status: "unsupported"; content: NormalizedSourceContent } {
  return {
    status: "unsupported",
    content: {
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      title: input.title,
      originalName: input.originalName,
      language: input.language,
      contentKind: "image",
      chunks: [],
      metadata: { byteSize: input.byteSize },
      extraction: { status: "unsupported", adapter: "image-metadata-v1", reason: "no-ocr-in-this-batch" },
      normalizationVersion: NORMALIZATION_VERSION,
    },
  };
}
