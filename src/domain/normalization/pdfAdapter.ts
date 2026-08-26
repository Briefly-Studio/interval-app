// PDF text extraction investigation (see docs/source-normalization-foundation.md's "PDF
// extraction investigation" section for the full record):
//   - `react-native-pdf@7.0.1` (the only PDF library currently in this project — see
//     src/domain/sourceReader.ts's pdf-reader strategy) exposes NO text-extraction API at all in
//     its public surface (`index.d.ts`/README audited directly) — it is purely a native page
//     RENDERER (PDFKit on iOS, PdfRenderer on Android), with no method to read a page's text
//     content back into JS.
//   - No JS-only PDF-parsing library (e.g. pdf.js/pdfjs-dist) is installed in this project.
//     Adding one to get real text extraction would be a substantial new dependency whose typical
//     browser-oriented text-extraction path depends on Web Worker/Canvas/DOM APIs that don't
//     exist natively in React Native/Hermes — making it work would require unverified polyfilling
//     this mission explicitly warns against ("do NOT add a questionable PDF parser just to check
//     a box").
// Conclusion: client-side PDF text extraction is NOT realistically available with the currently
// integrated stack. This adapter is therefore an honest `pending-extraction` stub — the contract
// a future adapter (either a vetted JS PDF-text library, or a server-side extraction step) will
// fill in without changing anything about how `normalizeSource` dispatches to it or what shape
// its result takes.

import { NORMALIZATION_VERSION, type NormalizedSourceContent } from "./types";
import type { SourceType } from "../../models/librarySource";

export type PdfAdapterInput = {
  sourceId: string;
  sourceType: SourceType;
  title: string;
  originalName?: string;
  language?: string;
  byteSize?: number;
  pageCount?: number;
};

export function normalizePdfSource(input: PdfAdapterInput): { status: "pending-extraction"; content: NormalizedSourceContent } {
  return {
    status: "pending-extraction",
    content: {
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      title: input.title,
      originalName: input.originalName,
      language: input.language,
      contentKind: "unsupported",
      chunks: [],
      metadata: { byteSize: input.byteSize, pageCount: input.pageCount },
      extraction: {
        status: "pending-extraction",
        adapter: "pdf-pending-v1",
        reason: "no-client-side-pdf-text-extraction-available",
      },
      normalizationVersion: NORMALIZATION_VERSION,
    },
  };
}
