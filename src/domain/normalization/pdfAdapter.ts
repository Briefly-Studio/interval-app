// PDF text extraction. See docs/source-normalization-foundation.md's "PDF extraction
// investigation" section for the full historical record of why this was previously a
// `pending-extraction` stub, and docs/ai-generation-foundation.md for how this now feeds the
// existing, unchanged Generate Study Deck pipeline.
//
// This file is pure — no native module import, no React Native dependency — exactly like
// textAdapter.ts. normalizeSource.ts owns PDF file resolution and the actual native-module
// extraction call (via pdfTextExtraction.ts); this file only turns already-extracted per-page
// text into the same NormalizedChunk/NormalizedSourceContent shape every other adapter produces.
// Deterministic: identical `pages` input always produces identical chunks/ids.

import { computeChunkId, MAX_CHUNKS, segmentText } from "./chunking";
import { normalizeLineEndings } from "./textAdapter";
import { NORMALIZATION_VERSION, type ChunkProvenance, type NormalizedChunk, type NormalizedSourceContent } from "./types";
import type { SourceType } from "../../models/librarySource";

export type PdfAdapterInput = {
  sourceId: string;
  sourceType: SourceType;
  title: string;
  originalName?: string;
  language?: string;
  byteSize?: number;
  /** Already-extracted text, one entry per PDF page, in page order (`pages[0]` is page 1) — see
   * pdfTextExtraction.ts's `extractPdfPageTexts`. This adapter never reads a file itself. */
  pages: string[];
};

export type PdfAdapterOutcome =
  | { status: "ready"; content: NormalizedSourceContent }
  | { status: "too-large" }
  | { status: "failed" };

/**
 * Segments each page's text independently (reusing chunking.ts's existing, already-proven
 * `segmentText` — no PDF-specific chunking algorithm exists or is needed), then flattens the
 * per-page results into one document-ordered chunk list: `NormalizedChunk.index` is reassigned to
 * a single, strictly-increasing GLOBAL position across the whole document (required for
 * src/domain/ai/contextPreparation.ts's `preserveOriginalOrder` sort — a per-page-local index
 * would scramble cross-page ordering), and `id` is recomputed with `computeChunkId` using that
 * same global index, keeping chunk ids content-addressed by the same formula every other adapter
 * uses (sourceId, normalizationVersion, GLOBAL index, text) — never a PDF-specific id scheme.
 *
 * Document text coordinate system (see docs/ai-pdf-generation.md): the canonical "adapter's own
 * normalized text" that `ChunkProvenance.charRange` (types.ts) indexes into is the FULL document —
 * every page's own normalized text, concatenated in page order with a single "\n" separator
 * between consecutive pages (present even across a blank page, so a later page's offsets never
 * shift depending on whether an earlier page happened to contribute any chunks). Each page is
 * still chunked independently via `segmentText` — a chunk never spans a page boundary — and its
 * page-local `{start, end}` is then shifted by that page's own start offset in the whole-document
 * coordinate space, so the final `charRange` values are unique and monotonically increasing across
 * the entire PDF, exactly like a plain-text source's. `lineRange` is deliberately NOT forwarded
 * for PDF chunks: `segmentText` computes it relative to each page's own local line numbering,
 * which would collide across pages (two different pages can both legitimately report "lines
 * 1-12") and — per src/domain/ai/draftCardEditing.ts's `resolveProvenanceLabel`, which checks
 * `lineRange` before `page` — would silently hide the real, unambiguous page citation behind a
 * misleading line citation. `page` is set on every chunk's provenance — a real value from actual
 * per-page extraction, never invented (see pdfTextExtraction.ts) — and is the one honest,
 * user-verifiable location signal for a PDF, enough for "Generated from page 14".
 */
export function normalizePdfTextSource(input: PdfAdapterInput): PdfAdapterOutcome {
  const normalizedPages: string[] = [];
  for (const raw of input.pages) {
    try {
      normalizedPages.push(normalizeLineEndings(raw));
    } catch {
      return { status: "failed" };
    }
  }

  // pageStartOffset[i] is where page (i + 1)'s normalized text begins in the whole-document
  // coordinate system described above — computed up front over every page (blank or not) so a
  // skipped blank page still correctly shifts every later page's offsets.
  const pageStartOffset: number[] = [];
  let cursor = 0;
  for (const pageText of normalizedPages) {
    pageStartOffset.push(cursor);
    cursor += pageText.length + 1; // +1 for the inter-page separator
  }

  const allChunks: NormalizedChunk[] = [];
  let globalIndex = 0;

  for (let pageIdx = 0; pageIdx < normalizedPages.length; pageIdx++) {
    const pageNumber = pageIdx + 1;
    const normalized = normalizedPages[pageIdx];
    // A whitespace-only page (no real word content) is treated the same as a genuinely empty
    // one — skipped entirely, never chunked as literal whitespace — matching
    // pdfExtractionOutcome.ts's own hasUsablePdfText() definition of "usable" at the document
    // level, applied here per page. Physical page numbering (`pageNumber` above) is unaffected —
    // it's derived from `pageIdx` before this check, never renumbered by skipping.
    if (normalized.trim().length === 0) continue;

    const { chunks: pageChunks, truncated } = segmentText(input.sourceId, normalized);
    // segmentText's own MAX_CHUNKS check is scoped to this one page's call — a single page could
    // never realistically produce 5000 chunks, so this branch is defense-in-depth, not a
    // normally-reachable path; the global check below (across all pages) is the one that matters
    // in practice for a many-page document.
    if (truncated) return { status: "too-large" };

    const offset = pageStartOffset[pageIdx];
    for (const chunk of pageChunks) {
      const localRange = chunk.provenance.charRange;
      const provenance: ChunkProvenance = {
        page: pageNumber,
        ...(localRange ? { charRange: { start: localRange.start + offset, end: localRange.end + offset } } : {}),
      };
      allChunks.push({
        ...chunk,
        index: globalIndex,
        id: computeChunkId(input.sourceId, globalIndex, chunk.text),
        provenance,
      });
      globalIndex++;
    }

    if (allChunks.length > MAX_CHUNKS) return { status: "too-large" };
  }

  return {
    status: "ready",
    content: {
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      title: input.title,
      originalName: input.originalName,
      language: input.language,
      contentKind: "text",
      chunks: allChunks,
      metadata: { byteSize: input.byteSize, pageCount: input.pages.length },
      extraction: { status: "ready", adapter: "pdf-text-v1" },
      normalizationVersion: NORMALIZATION_VERSION,
    },
  };
}
