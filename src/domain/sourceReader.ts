import { resolveSourceHandoffHint } from "./librarySourceFormat";
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
// DOC vs DOCX: `sourceType: "docx"` covers BOTH the legacy binary `.doc` format and modern
// `.docx` (see src/domain/librarySourceFormat.ts's SOURCE_FORMATS table — one sourceType, two
// possible extensions). Reader support is DOCX-only; legacy `.doc` is a completely different
// binary format (OLE2/CFB, not a ZIP/XML package) that this batch's client-side parser cannot
// read, and there is no reliable client-only way to support it without either a real binary-.doc
// parser (a much larger, separate undertaking) or server-side conversion (explicitly out of
// scope this mission). `resolveSourceHandoffHint` — the same trusted extension resolver every
// other open/export path in this app already uses — is reused here rather than duplicating
// mimeType-matching rules, so this stays the single source of truth for "is this really a .docx".
//
// Extension points for future formats (documented here, not implemented): PPT/PPTX would resolve
// to a `{ kind: "future-presentation" }` case, and XLS/XLSX to `{ kind: "future-spreadsheet" }` —
// each its own reader.tsx renderer branch once implemented, same shape as pdf/image/text/docx/audio
// below. None of that is implemented in this batch; `resolveSourceReaderStrategy` currently maps
// all of them to "unsupported" on purpose.
export type SourceReaderStrategy =
  | { kind: "pdf-reader" }
  | { kind: "image-reader" }
  | { kind: "text-reader" }
  | { kind: "docx-reader" }
  | { kind: "audio-player" }
  | { kind: "unsupported" };

export function resolveSourceReaderStrategy(source: { sourceType: SourceType; mimeType?: string }): SourceReaderStrategy {
  if (source.sourceType === "pdf") return { kind: "pdf-reader" };
  if (source.sourceType === "image") return { kind: "image-reader" };
  if (source.sourceType === "text") return { kind: "text-reader" };
  if (source.sourceType === "docx" && resolveSourceHandoffHint(source).extension === "docx") return { kind: "docx-reader" };
  if (source.sourceType === "audio") return { kind: "audio-player" };
  return { kind: "unsupported" };
}

/** Whether Source Detail should offer the "Open in Interval" full-reader action for this source. */
export function hasFullSourceReader(source: { sourceType: SourceType; mimeType?: string }): boolean {
  return resolveSourceReaderStrategy(source).kind !== "unsupported";
}
