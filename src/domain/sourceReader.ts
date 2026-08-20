import type { SourceType } from "../models/librarySource";

// Full Source Reader capability model — deliberately separate from ./sourcePreview.ts's
// SourcePreviewStrategy, not a shared union. Preview and Reader are different product concepts
// (see docs comment in app/library/[id]/reader.tsx): Preview is a fast, bounded glance; Reader is
// the complete-document consumption path. Keeping their strategy resolvers as two small, parallel
// files (rather than one merged capability object) means a future reader for a format Preview
// already embeds — or a future Preview for a format Reader doesn't support yet — never needs to
// touch the other file's cases.
//
// Centralization rule this file exists to enforce: format-capability decisions (which sourceType
// gets which reader) live HERE, in exactly one place, not as scattered `if (sourceType === ...)`
// conditionals inside navigation/UI screens. app/library/[id]/index.tsx and reader.tsx both call
// into this module rather than re-deriving the answer themselves.
//
// Extension points for future formats (documented here, not implemented): DOC/DOCX would resolve
// to a `{ kind: "future-office-document" }` case, PPT/PPTX to `{ kind: "future-presentation" }`,
// and XLS/XLSX to `{ kind: "future-spreadsheet" }` — each its own reader.tsx renderer branch once
// implemented, same shape as pdf/image/text/audio below.
export type SourceReaderStrategy =
  | { kind: "pdf-reader" }
  | { kind: "image-reader" }
  | { kind: "text-reader" }
  | { kind: "audio-player" }
  | { kind: "unsupported" };

export function resolveSourceReaderStrategy(source: { sourceType: SourceType }): SourceReaderStrategy {
  if (source.sourceType === "pdf") return { kind: "pdf-reader" };
  if (source.sourceType === "image") return { kind: "image-reader" };
  if (source.sourceType === "text") return { kind: "text-reader" };
  if (source.sourceType === "audio") return { kind: "audio-player" };
  return { kind: "unsupported" };
}

/** Whether Source Detail should offer the "Open in Interval" full-reader action for this source. */
export function hasFullSourceReader(source: { sourceType: SourceType }): boolean {
  return resolveSourceReaderStrategy(source).kind !== "unsupported";
}
