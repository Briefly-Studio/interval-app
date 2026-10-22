import { test } from "node:test";
import assert from "node:assert/strict";
import { hasUsablePdfText, mapPdfExtractionError } from "./pdfExtractionOutcome";

test("mapPdfExtractionError: PASSWORD_REQUIRED and INCORRECT_PASSWORD both map to password-protected", () => {
  assert.deepEqual(mapPdfExtractionError({ code: "PASSWORD_REQUIRED" }), { status: "password-protected" });
  assert.deepEqual(mapPdfExtractionError({ code: "INCORRECT_PASSWORD" }), { status: "password-protected" });
});

test("mapPdfExtractionError: FILE_NOT_FOUND and CORRUPT_PDF map to their own failed reasons", () => {
  assert.deepEqual(mapPdfExtractionError({ code: "FILE_NOT_FOUND" }), { status: "failed", reason: "pdf-file-not-found" });
  assert.deepEqual(mapPdfExtractionError({ code: "CORRUPT_PDF" }), { status: "failed", reason: "corrupt-or-unreadable-pdf" });
});

test("mapPdfExtractionError: the codes actually thrown by the native iOS/Android implementations (not the package's own documented PdfErrorCode union) map to the same safe failed outcomes", () => {
  // iOS (PdfExtractorModule.swift): load/parse failure and out-of-range page.
  assert.deepEqual(mapPdfExtractionError({ code: "PDF_LOAD_ERROR" }), { status: "failed", reason: "corrupt-or-unreadable-pdf" });
  assert.deepEqual(mapPdfExtractionError({ code: "PDF_PAGE_ERROR" }), { status: "failed", reason: "pdf-page-out-of-range" });
  // Android (PdfExtractorModule.kt): extractText/extractTextFromPage vs. getPageCount use two
  // different generic codes for the equivalent failure.
  assert.deepEqual(mapPdfExtractionError({ code: "PDF_EXTRACTION_ERROR" }), { status: "failed", reason: "corrupt-or-unreadable-pdf" });
  assert.deepEqual(mapPdfExtractionError({ code: "PDF_ERROR" }), { status: "failed", reason: "corrupt-or-unreadable-pdf" });
});

test("mapPdfExtractionError: an unrecognized code, a missing code, and a non-object thrown value all map safely to failed — never throwing, never leaking the raw error", () => {
  const sensitive = { code: "UNKNOWN", message: "some native stack trace detail that must never surface" };
  const mapped = mapPdfExtractionError(sensitive);
  assert.equal(mapped.status, "failed");
  if (mapped.status === "failed") {
    assert.equal(mapped.reason, "unknown-pdf-extraction-error");
    assert.doesNotMatch(mapped.reason, /stack trace/);
  }
  assert.deepEqual(mapPdfExtractionError(new Error("plain error, no code")), { status: "failed", reason: "unknown-pdf-extraction-error" });
  assert.deepEqual(mapPdfExtractionError("a thrown string, not an object"), { status: "failed", reason: "unknown-pdf-extraction-error" });
  assert.deepEqual(mapPdfExtractionError(null), { status: "failed", reason: "unknown-pdf-extraction-error" });
  assert.deepEqual(mapPdfExtractionError(undefined), { status: "failed", reason: "unknown-pdf-extraction-error" });
});

test("hasUsablePdfText: true as soon as one page has real, non-whitespace content", () => {
  assert.equal(hasUsablePdfText(["", "   \n\t  ", "real text here"]), true);
  assert.equal(hasUsablePdfText(["real text here"]), true);
});

test("hasUsablePdfText: false for an empty array or every page being empty/whitespace-only", () => {
  assert.equal(hasUsablePdfText([]), false);
  assert.equal(hasUsablePdfText(["", "   ", "\n\n\t"]), false);
});
