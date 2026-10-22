import * as PdfTextExtract from "expo-pdf-text-extract";

import { hasUsablePdfText, mapPdfExtractionError, type PdfPageExtractionOutcome } from "./pdfExtractionOutcome";

// The ONLY file in src/domain/normalization/ that imports expo-pdf-text-extract — isolated here
// so pdfAdapter.ts's own chunking/provenance logic AND pdfExtractionOutcome.ts's own error-
// mapping logic stay pure and unit-testable (no native module, no React Native runtime needed)
// while this thin wrapper owns every native-module call. Mirrors the same isolation principle
// already used elsewhere in this codebase (e.g.
// backend/lambdas/ai-generate-study-deck/bedrockClient.mjs keeping the AWS SDK import out of its
// own pure logic).
//
// Uses Apple PDFKit (iOS) / Apache PDFBox (Android) under the hood, via the native module —
// react-native-pdf (this project's only other PDF dependency, used for on-screen rendering) has
// no text-extraction API of any kind, confirmed by direct inspection of its own type
// definitions; this is a genuinely separate, additive capability, not a duplicate of anything
// already present. No OCR anywhere in this file — a PDF with no embedded text layer (a scanned/
// image-only page) legitimately extracts to an empty string; this file never invents content.

export type { PdfPageExtractionOutcome };

// Defense-in-depth ceiling, not a normally-reachable product limit: protects the per-page
// extraction loop below from a pathological page count (a corrupted PDF claiming millions of
// pages, or a genuinely enormous scanned book) from running an unbounded number of native-module
// round trips synchronously within one generation attempt. Generous for any realistic document —
// a 500-page source is already far beyond what Generate Study Deck's own context budget
// (src/domain/ai/contextPreparation.ts) could usefully select from in one request.
export const MAX_PDF_PAGES_FOR_EXTRACTION = 500;

/**
 * Extracts per-page text from a local PDF file (a real filesystem path, already resolved/staged
 * by the same local-first/cloud-fallback mechanism every other reader uses — see
 * normalizeSource.ts). Never attempts OCR, never invents text for a page that has none.
 *
 * Two genuinely different things can happen to a page, and they are handled differently on
 * purpose:
 *   - The extraction call SUCCEEDS and returns no/empty text (a legitimately blank or
 *     image-only/scanned page) — this is NOT a failure. That page simply contributes no chunks;
 *     extraction continues, and the document can still end in "ready" if another page has real
 *     text.
 *   - The extraction call itself THROWS (a damaged page, a corrupt file, a password failure) —
 *     this fails the WHOLE normalization attempt closed. It never degrades to treating that page
 *     as empty and continuing: doing so would let Generate Study Deck silently operate on an
 *     unknowingly incomplete document, indistinguishable from one that was genuinely all read.
 */
export async function extractPdfPageTexts(filePath: string): Promise<PdfPageExtractionOutcome> {
  if (!PdfTextExtract.isAvailable()) return { status: "unavailable" };

  let pageCount: number;
  try {
    pageCount = await PdfTextExtract.getPageCount(filePath);
  } catch (error) {
    return mapPdfExtractionError(error);
  }

  if (!Number.isFinite(pageCount) || pageCount <= 0) return { status: "empty" };
  if (pageCount > MAX_PDF_PAGES_FOR_EXTRACTION) return { status: "too-many-pages" };

  const pages: string[] = [];
  for (let page = 1; page <= pageCount; page++) {
    try {
      const text = await PdfTextExtract.extractTextFromPage(filePath, page);
      pages.push(typeof text === "string" ? text : "");
    } catch (error) {
      // A genuine per-page extraction error (password-protected, corrupt/unreadable page, or any
      // other native failure) fails the whole document closed — never pushed as "" and continued.
      return mapPdfExtractionError(error);
    }
  }

  if (!hasUsablePdfText(pages)) return { status: "empty" };

  return { status: "ready", pages };
}
