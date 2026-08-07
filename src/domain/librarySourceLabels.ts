import type { TranslationKey } from "../i18n";
import type { SourceProcessingStatus, SourceType } from "../models/librarySource";

// Shared label-key maps so source type / status text stays identical (and identically localized)
// across the source card, add/edit form, and organization filters — one place to update rather
// than four ad hoc copies.

export const SOURCE_TYPE_LABEL_KEYS: Record<SourceType, TranslationKey> = {
  pdf: "librarySource.types.pdf",
  docx: "librarySource.types.docx",
  text: "librarySource.types.text",
  image: "librarySource.types.image",
  audio: "librarySource.types.audio",
  pptx: "librarySource.types.pptx",
  xlsx: "librarySource.types.xlsx",
};

// PDF, Word, Text/Notes, Images, and Audio are the approved first-release intake priorities
// (docs/library-and-source-architecture.md §16) — PPTX/XLSX remain recognized future types, not
// presented as fully supported upload functionality (there is no upload at all in this batch).
export const PRIORITIZED_SOURCE_TYPES: SourceType[] = ["pdf", "docx", "text", "image", "audio"];
export const FUTURE_SOURCE_TYPES: SourceType[] = ["pptx", "xlsx"];
export const ALL_SOURCE_TYPES: SourceType[] = [...PRIORITIZED_SOURCE_TYPES, ...FUTURE_SOURCE_TYPES];

export const STATUS_LABEL_KEYS: Record<SourceProcessingStatus, TranslationKey> = {
  ready: "librarySource.statuses.ready",
  needsReview: "librarySource.statuses.needsReview",
  archived: "librarySource.statuses.archived",
};
