// Pure logic split out of pdfTextExtraction.ts specifically so it can be unit-tested under the
// plain `node --test` runner this repository's AI/normalization suite uses — pdfTextExtraction.ts
// itself imports expo-pdf-text-extract, a native-module-backed package that (like expo-constants,
// expo-modules-core, and AuthService's expo-secure-store import before it) cannot load outside
// the real Expo/React Native runtime. Confirmed directly, not assumed. Nothing in this file
// imports expo-pdf-text-extract or any other native/RN module.

export type PdfPageExtractionOutcome =
  | { status: "ready"; pages: string[] } // pages[i] is page (i + 1)'s raw extracted text, in page
  // order. A page reaching "ready" either had real text or was genuinely, successfully checked and
  // found to have none (legitimately blank/scanned/image-only) — never a page whose own extraction
  // call threw. Any genuine per-page extraction error instead fails the WHOLE outcome closed (see
  // extractPdfPageTexts) rather than being silently degraded to an empty string within a "ready"
  // result, so Generate Study Deck can never unknowingly operate on an incomplete document.
  | { status: "empty" } // zero pages, or every page's extracted text is empty/whitespace-only
  | { status: "password-protected" }
  | { status: "unavailable" } // native module not loaded (e.g. Expo Go) — never thrown, always returned
  | { status: "too-many-pages" }
  | { status: "failed"; reason: string }; // diagnostic category only — never the raw native error message

/**
 * Maps a thrown native-module error to a safe, generic outcome — never re-throws the raw error,
 * never reads/returns its message. `expo-pdf-text-extract`'s own documented, stable error-code
 * union (its own dist/index.d.ts `PdfErrorCode`) is `'PASSWORD_REQUIRED' | 'INCORRECT_PASSWORD' |
 * 'FILE_NOT_FOUND' | 'CORRUPT_PDF' | 'UNKNOWN'` — restated here as plain string literals rather
 * than importing the package's type, so this file has zero dependency on it. Direct inspection of
 * both native implementations (ios/PdfExtractorModule.swift, android/.../PdfExtractorModule.kt)
 * found that neither platform actually throws `CORRUPT_PDF` in practice — iOS rejects a
 * load/parse failure as `PDF_LOAD_ERROR` or an out-of-range page as `PDF_PAGE_ERROR`; Android
 * rejects as `PDF_EXTRACTION_ERROR` (extractText/extractTextFromPage) or `PDF_ERROR`
 * (getPageCount) for the equivalent failures. All of these — the documented code and the ones
 * genuinely observed — map to the same safe "failed" outcome; `CORRUPT_PDF` is kept in case a
 * future package version actually uses it. Any other/unrecognized error (including a thrown
 * non-Error value with no `.code` at all) falls through to a generic "failed" category rather
 * than assuming a specific shape.
 */
export function mapPdfExtractionError(error: unknown): PdfPageExtractionOutcome {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === "PASSWORD_REQUIRED" || code === "INCORRECT_PASSWORD") return { status: "password-protected" };
  if (code === "FILE_NOT_FOUND") return { status: "failed", reason: "pdf-file-not-found" };
  if (code === "CORRUPT_PDF" || code === "PDF_LOAD_ERROR" || code === "PDF_EXTRACTION_ERROR" || code === "PDF_ERROR") {
    return { status: "failed", reason: "corrupt-or-unreadable-pdf" };
  }
  if (code === "PDF_PAGE_ERROR") return { status: "failed", reason: "pdf-page-out-of-range" };
  return { status: "failed", reason: "unknown-pdf-extraction-error" };
}

/** True once at least one page's extracted text has real, non-whitespace content. */
export function hasUsablePdfText(pages: string[]): boolean {
  return pages.some((pageText) => pageText.trim().length > 0);
}
