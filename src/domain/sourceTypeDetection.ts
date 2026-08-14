import type { SourceType } from "../models/librarySource";

// Inbound file-evidence -> SourceType detection, used only to keep a source's declared
// `sourceType` from contradicting the actual file attached to it (see the "Library source
// correctness" batch — founder QA found a user could pick a .docx file while leaving/selecting
// "PDF" as the source type, and the app saved that contradiction verbatim). This is deliberately
// the mirror image of src/domain/sourceViewer.ts's VIEWER_HINTS table, which answers a different
// question (what extension/MIME to hand the OS share sheet for an already-typed source) and is
// guarded against structural changes by its own rules — this module never imports it, never
// derives a filesystem path, and only ever returns one of Interval's known SourceType values or
// undefined. `undefined` means "no confident, trusted evidence" — callers must fall back to the
// user's own manual selection in that case, never guess.
//
// Precedence: MIME type first (reliable when the OS/picker supplies one Interval recognizes),
// file extension second (used only when MIME is missing, generic, or not recognized). A
// recognized MIME type always wins over a conflicting extension — MIME is the more trustworthy,
// OS-supplied signal of the two.

const MIME_TYPE_SOURCE_TYPES: Record<string, SourceType> = {
  "application/pdf": "pdf",
  "application/msword": "docx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "text",
  "image/jpeg": "image",
  "image/png": "image",
  "image/heic": "image",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/x-m4a": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

const EXTENSION_SOURCE_TYPES: Record<string, SourceType> = {
  pdf: "pdf",
  doc: "docx",
  docx: "docx",
  txt: "text",
  jpg: "image",
  jpeg: "image",
  png: "image",
  heic: "image",
  mp3: "audio",
  m4a: "audio",
  wav: "audio",
  aac: "audio",
  pptx: "pptx",
  xlsx: "xlsx",
};

function normalizeMimeType(mimeType: string | undefined): string | undefined {
  if (!mimeType) return undefined;
  const trimmed = mimeType.split(";")[0]?.trim().toLowerCase();
  return trimmed || undefined;
}

function normalizeExtension(extension: string | undefined): string | undefined {
  if (!extension) return undefined;
  const trimmed = extension.trim().toLowerCase().replace(/^\./, "");
  return trimmed || undefined;
}

// Extracts a lowercase extension from an OS/picker-supplied file name for detection purposes only
// — this never builds or returns a filesystem path (see src/domain/sourceViewer.ts's own guardrail
// comment for why that distinction matters elsewhere in this codebase). A name with no dot, a
// leading-dot-only name (".gitignore"-style), or a trailing dot yields undefined rather than a
// guess.
export function extensionFromFileName(fileName: string | undefined): string | undefined {
  if (!fileName) return undefined;
  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === trimmed.length - 1) return undefined;
  return normalizeExtension(trimmed.slice(lastDot + 1));
}

/**
 * Confident, trusted-evidence-only detection of the SourceType a physical file actually is.
 * Returns undefined — never a guess — when neither the MIME type nor the extension maps to a
 * SourceType Interval currently understands, so callers fall back to the user's own manual
 * selection rather than silently mislabeling a source.
 */
export function detectSourceTypeFromFile(input: { mimeType?: string; extension?: string }): SourceType | undefined {
  const mimeType = normalizeMimeType(input.mimeType);
  if (mimeType && MIME_TYPE_SOURCE_TYPES[mimeType]) {
    return MIME_TYPE_SOURCE_TYPES[mimeType];
  }
  const extension = normalizeExtension(input.extension);
  if (extension && EXTENSION_SOURCE_TYPES[extension]) {
    return EXTENSION_SOURCE_TYPES[extension];
  }
  return undefined;
}
