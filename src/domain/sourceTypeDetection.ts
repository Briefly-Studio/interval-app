import type { SourceType } from "../models/librarySource";
import {
  detectSourceTypeFromFileEvidence,
  extensionFromFileName as extensionFromTrustedFileName,
} from "./librarySourceFormat";

// Inbound file-evidence -> SourceType detection, used only to keep a source's declared
// `sourceType` from contradicting the actual file attached to it (see the "Library source
// correctness" batch — founder QA found a user could pick a .docx file while leaving/selecting
// "PDF" as the source type, and the app saved that contradiction verbatim). The trusted mappings
// live in src/domain/librarySourceFormat.ts so inbound detection, viewer/export staging, and cloud
// upload eligibility stay coherent without this module constructing any filesystem path.
// `undefined` means "no confident, trusted evidence" — callers must fall back to the user's own
// manual selection in that case, never guess.
//
// Precedence: MIME type first (reliable when the OS/picker supplies one Interval recognizes),
// file extension second (used only when MIME is missing, generic, or not recognized). A
// recognized MIME type always wins over a conflicting extension — MIME is the more trustworthy,
// OS-supplied signal of the two.

// Extracts a lowercase extension from an OS/picker-supplied file name for detection purposes only
// — this never builds or returns a filesystem path (see src/domain/sourceViewer.ts's own guardrail
// comment for why that distinction matters elsewhere in this codebase). A name with no dot, a
// leading-dot-only name (".gitignore"-style), or a trailing dot yields undefined rather than a
// guess.
export function extensionFromFileName(fileName: string | undefined): string | undefined {
  return extensionFromTrustedFileName(fileName);
}

/**
 * Confident, trusted-evidence-only detection of the SourceType a physical file actually is.
 * Returns undefined — never a guess — when neither the MIME type nor the extension maps to a
 * SourceType Interval currently understands, so callers fall back to the user's own manual
 * selection rather than silently mislabeling a source.
 */
export function detectSourceTypeFromFile(input: { mimeType?: string; extension?: string }): SourceType | undefined {
  return detectSourceTypeFromFileEvidence(input);
}
