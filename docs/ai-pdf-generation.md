# AI PDF Generation

**Status: implemented on `feat/ai-pdf-generation`, not yet merged, not yet committed.** Extends
the existing, already-live Generate Study Deck pipeline (TXT, Development, real Bedrock/Nova 2
Lite backend — see `docs/ai-generation-foundation.md`) to PDF sources with extractable text. This
document covers only what's new: PDF text extraction and its normalization-layer integration. The
generation contract, provider, backend, and validation layers are **completely unchanged** — that
is the entire point of this design, and is covered in detail below.

## Product principle

The model does not care whether a source was TXT or PDF. By the time generation reaches the AI
provider, source material is already represented by the existing, provider-neutral
`GenerationContext`/chunk contract. All PDF-specific logic lives at the source-extraction/
normalization boundary — nowhere else.

## Data flow

```
PDF source (LibrarySourceRecord)
  → resolveSourceOriginal + prepareViewerInput        (same helpers app/library/[id]/reader.tsx
                                                         already uses to open the PDF for reading)
  → extractPdfPageTexts()                              (pdfTextExtraction.ts — the ONLY file that
                                                         imports the native extraction module)
  → normalizePdfTextSource()                           (pdfAdapter.ts — pure, chunks each page via
                                                         the EXISTING chunking.ts, reindexes
                                                         globally, tags each chunk with its real
                                                         page number)
  → NormalizedSourceContent (contentKind: "text", extraction.status: "ready")
  → EVERYTHING BELOW THIS LINE IS 100% UNCHANGED, confirmed by direct code read before writing
    a single line of PDF-specific code:
      generationAvailability.ts → generateDeckFlow.ts → providerSelection.ts →
      backendProvider.ts → the Lambda → Bedrock Converse → Nova 2 Lite →
      responseValidation.ts → review/edit/save UI
```

This is the single most important architectural fact of this batch, verified by direct
inspection, not assumed: `generationAvailability.ts`'s eligibility gate
(`deriveGenerationAvailability`) is a pure mapping from `NormalizedSourceContent.extraction.status`
to a UI state — it has never once inspected `sourceType`. The moment PDF normalization produces
`extraction.status: "ready"` with real chunks, PDF becomes generation-eligible with **zero** code
change anywhere downstream. No second AI pipeline was created; none was needed.

## PDF text extraction

**No text-extraction capability existed anywhere in this project before this batch.**
`react-native-pdf` (the only pre-existing PDF dependency, used for on-screen rendering) exposes no
text-extraction API of any kind — confirmed by direct inspection of its own type definitions, not
assumed from an earlier investigation. This batch adds **`expo-pdf-text-extract`**, a small,
purpose-built native module (Apple PDFKit on iOS, Apache PDFBox on Android) — a new native
dependency requiring a Development Build rebuild before it can be exercised on-device, the same
category of change as when `expo-audio` was added for the Audio source player.

- **`pdfTextExtraction.ts`** — the only file that imports `expo-pdf-text-extract`. Calls
  `isAvailable()` first (never assumes the native module loaded — returns a clean `"unavailable"`
  outcome otherwise, see below); then `getPageCount(filePath)`; then loops
  `extractTextFromPage(filePath, pageNumber)` for every page, 1-indexed. A single page's own
  extraction failure degrades to an empty string for that one page rather than aborting the whole
  document; a password failure on any page is treated as whole-document (every other page would
  fail the same way, so the loop stops immediately rather than repeating the same failure).
- **`pdfExtractionOutcome.ts`** — pure (zero native/RN import): the error-code mapping
  (`mapPdfExtractionError`) and the "does this set of pages have any real content at all"
  check (`hasUsablePdfText`). Split out specifically so this logic is unit-testable under the
  plain `node --test` runner — `expo-pdf-text-extract` (like `expo-constants`/`react-native`/
  `expo-secure-store` before it) cannot load outside the real Expo/React Native runtime,
  confirmed directly.
- **No OCR anywhere.** A scanned/image-only PDF (or a page with no embedded text layer)
  legitimately extracts to an empty string. This is never treated as an error to work around —
  it's the correct, honest outcome for a capability this batch does not implement.

### Size/performance ceilings

- **`MAX_PDF_PAGES_FOR_EXTRACTION = 500`** (`pdfTextExtraction.ts`) — a defense-in-depth ceiling on
  page count, protecting the per-page extraction loop from a pathological document (or a
  corrupted PDF claiming millions of pages) from running an unbounded number of native-module
  round trips within one generation attempt. Checked via a single `getPageCount` call before any
  per-page extraction begins — fails fast, never partially extracts an oversized document.
- **`MAX_NORMALIZATION_TEXT_BYTES` (10 MB of extracted text)** — the exact same ceiling
  `textAdapter.ts` already applies to a plain-text file's raw bytes, reused here against the SUM
  of all pages' extracted text (checked in `normalizeSource.ts`, before chunking). A PDF's own
  file size doesn't predict extracted-text size the way a plain-text file's byte size does (a
  large PDF can be mostly images with little text; a small one can be dense), so this is checked
  against extracted content, never the PDF file's raw byte size.
- **`MAX_CHUNKS` (5000)** — the same global chunk-count ceiling `chunking.ts` already enforces for
  TXT, checked here across the WHOLE document (all pages combined), not per page.
- **No RAG, no embeddings, no vector search** — out of scope for this batch, same as the rest of
  the Generate Study Deck foundation. For a PDF larger than `contextPreparation.ts`'s existing
  character budget, the exact same deterministic, sequential, in-document-order chunk selection
  TXT already uses applies unchanged — some trailing chunks are excluded,
  `fullSourceIncluded: false` is reported honestly, and no embedding-based "most relevant chunk"
  selection exists for either format.

## Chunking and provenance strategy

`pdfAdapter.ts`'s `normalizePdfTextSource()` is pure — no native module, no I/O — and reuses
`chunking.ts`'s existing, already-proven `segmentText()` function **per page**, then flattens the
per-page results:

- **`NormalizedChunk.index` is reassigned to a single, strictly-increasing GLOBAL position across
  the whole document.** `segmentText()` computes a per-page-local index when called once per page;
  left as-is, two different pages' chunks could collide on the same index, which would scramble
  `contextPreparation.ts`'s `preserveOriginalOrder` sort (it sorts selected chunks by `index` to
  reconstruct natural reading order). This is re-derived explicitly, not left to chance.
- **`id` is recomputed with the existing `computeChunkId(sourceId, GLOBAL index, text)`** — the
  same content-addressing formula every other adapter uses, just fed the corrected global index.
  No PDF-specific id scheme exists.
- **`provenance.page` is set to the real, 1-based page number** for every chunk — the first
  provenance field in this contract to graduate from "reserved for a future adapter" (see
  `docs/source-normalization-foundation.md`'s original design) to actually populated by a real
  one. Never invented: a chunk's `page` is always the page `extractPdfPageTexts()` actually pulled
  that text from. Physical page numbering is preserved even through a skipped blank page — the
  page number is derived from the page's own position in `extractPdfPageTexts()`'s result before
  the blank-page skip check runs, never renumbered.
- A whitespace-only page (no real word content) is skipped entirely, never chunked as literal
  whitespace — matching `pdfExtractionOutcome.ts`'s own `hasUsablePdfText` definition of "usable,"
  applied per page as well as at the whole-document level.

### Document text coordinate system (charRange)

`types.ts`'s `ChunkProvenance.charRange` contract reads "offset range into the adapter's own
normalized text" — written when TXT was the only adapter producing `contentKind: "text"` chunks,
where "the adapter's own normalized text" is unambiguously the whole document (one file, one
normalized string). An earlier version of this PDF integration read that contract as implicitly
per-page (each page has its own "normalized text"), and shipped page-relative `charRange`/
`lineRange`. An independent architecture audit correctly flagged that reading as inconsistent with
the contract as written and with `contentKind: "text"` meaning the same thing for every adapter
that uses it — corrected before founder QA:

- **The canonical PDF document text is the concatenation of every page's own normalized text, in
  page order, joined by a single `"\n"` separator between consecutive pages** — present even
  across a skipped blank page, so a later page's offsets are never affected by whether an earlier
  page happened to contribute any chunks. `charRange` is now a true offset into this whole-document
  text, unique and monotonically increasing across the entire PDF, exactly like a plain-text
  source's.
- **Page boundaries are still preserved**: each page is still chunked independently via
  `segmentText()` — a chunk never spans two pages — and that page's already-computed, page-local
  `{start, end}` is shifted by a precomputed cumulative page-start offset. This is a small, additive
  change (`pdfAdapter.ts`), not a redesign of the chunking algorithm itself.
- **`lineRange` is deliberately never populated for a PDF chunk.** `segmentText()` computes it
  relative to each page's own local line numbering, so two different pages could legitimately both
  report "lines 1–12" — a real collision, not a hypothetical one. Worse: `src/domain/ai/
  draftCardEditing.ts`'s `resolveProvenanceLabel` checks `lineRange` *before* `page` when building a
  card's citation label, so a populated-but-page-relative `lineRange` would have silently won over
  the real, unambiguous `page` citation for every PDF-sourced card — a second, related bug the audit
  caught. Omitting `lineRange` for PDF fixes this with no change to `resolveProvenanceLabel` itself:
  with no `lineRange` present, that function already falls through to its `page` branch. `page`
  alone is the one honest, user-verifiable PDF location signal.

`contentKind` is `"text"` (not the reserved `"structured-text"`) — extraction gives flat per-page
text, no real heading/structural-block metadata, so `"text"` is the honest fit; `blockType` is
never populated for a PDF chunk.

## Generation eligibility

**No change was made to `generationAvailability.ts`, `generateDeckFlow.ts`'s availability check,
or any UI gating code.** Confirmed by direct code read before implementation: eligibility is
already a pure function of `extraction.status`, never `sourceType`. The extraction-status mapping
for PDF:

| Extraction status | When | Generate Study Deck result |
|---|---|---|
| `ready` | Real, non-empty, extracted text | Generation allowed |
| `empty` | Zero pages, or every page's text is empty/whitespace-only (most commonly a scanned/image-only PDF) | "No usable text" — honest, no generation, no OCR |
| `pending-extraction` | The native extraction module isn't loaded in this runtime (Expo Go, or a build that hasn't picked up the native dependency yet) | "Not ready for generation yet" |
| `too-large` | Page count over 500, or extracted text over 10 MB, or global chunk count over 5000 | "Source is too large" |
| `failed` | File unavailable locally/in the cloud, staging failed, password-protected, or corrupt/unparseable PDF | Friendly failure state with Retry |

TXT behavior is byte-for-byte unchanged — confirmed by running the full existing test suite
unmodified (see Validation below) and by not touching `textAdapter.ts` at all.

## Card count behavior

Unchanged. `responseValidation.ts`'s existing rule — the model may return fewer cards than
requested when the source doesn't support more, never filler cards to hit a count — applies
identically regardless of whether the context came from a TXT or PDF source, since by the time a
request reaches the provider it's already the same `GenerationContext` shape either way.

**UX disclosure of this (a separate, later batch, generic — not PDF-specific).** Founder QA on a
193-page PDF requesting a 25-card deck got only 9 cards — a correct result (the model only saw the
bounded context subset and refused to invent cards from material it never received), but the UI
never made that boundedness clear before the card-count choice. `src/domain/ai/
generationCoverage.ts` plus the options/review screen changes described in
`docs/generate-study-deck-ux.md`'s "Source coverage disclosure" section now disclose, BEFORE
generation, when a source won't fit one generation's context budget, present card-count presets
as "up to N" rather than an implied guarantee, and explain a resulting fewer-than-requested card
count honestly on the review screen. That work is generic over source format (TXT and PDF share
the same logic, keyed only off `GenerationContext.fullSourceIncluded`/chunk counts) — nothing
PDF-specific was added for it, and nothing in this document's own PDF-specific behavior changed.

## Error handling

| Scenario | Handling |
|---|---|
| PDF file unavailable locally/in the cloud | Same `resolveSourceOriginal` failure path TXT already uses → `failed` |
| Local staging failed | Same `prepareViewerInput` failure path TXT already uses → `failed` |
| Native extraction module unavailable | `pending-extraction` (capability-not-ready, not a file problem) |
| `getPageCount` itself fails (corrupt file) | `failed`, generic diagnostic reason only |
| Password-protected | `failed`, reason `"password-protected"` |
| An individual page's extraction call genuinely throws (corrupt/unreadable page in an otherwise-readable document) | `failed` for the WHOLE document — never degraded to treating that one page as empty and continuing (see below) |
| Page count / extracted size / chunk count over ceiling | `too-large` — always a clean failure, never a silent partial truncation of the extracted content |
| Zero usable text (incl. scanned/image-only) | `empty` |
| Existing generation timeout/network/backend errors | Entirely unchanged — these occur downstream of normalization and never see PDF-specific code |

No raw native/library/provider error message, code, or stack is ever surfaced to the user or
logged — every mapped outcome carries only a short diagnostic category (see
`pdfExtractionOutcome.ts`'s `mapPdfExtractionError`).

**A genuine per-page extraction failure fails the whole document closed.** `extractPdfPageTexts()`
distinguishes two different things that can happen to a page: the extraction call *succeeding*
with no/empty text (a legitimately blank or image-only/scanned page — not a failure, extraction
continues) versus the extraction call itself *throwing* (a damaged page, corrupt file, or password
failure). An earlier version of this fix pushed an empty string for both cases and only recorded
the genuine failure as a non-blocking diagnostic reason on an otherwise-`ready` result. An
independent audit correctly flagged that as still risking Generate Study Deck unknowingly
operating on an incomplete document, and required a stricter fix: any genuine per-page throw now
returns `{status: "failed", ...}` (or `{status: "password-protected"}`) immediately from
`extractPdfPageTexts()`, which `normalizeSource.ts` maps to `NormalizationResult.status: "failed"`
— the same path already used for a corrupt/unparseable file. A legitimately blank/scanned page
never triggers this; only a real thrown error does.

**Mixed text/image PDFs are never implied to have full visual coverage.** A PDF with some
text-bearing pages and some image-only/scanned pages extracts real text only from the pages that
have it — the image-only pages contribute zero chunks, exactly as if they didn't exist for
generation purposes. Nothing in this batch's UI copy, logs, or documentation claims or implies
that a generated deck reflects the PDF's full visual content (figures, charts, scanned pages) —
only the pages with a real embedded text layer. This is the same honest, no-OCR posture as a
fully-scanned PDF, just applied per-page instead of per-document.

## Performance

- `extractPdfPageTexts()` reads/parses a given PDF exactly once per `normalizeSource()` call — no
  redundant re-opens within one extraction pass.
- The pre-existing, documented duplication where the options screen's availability check and the
  actual Generate tap each independently call `normalizeSource()` once (an intentional Phase-A-era
  design choice — "cheap" for TXT) is **unchanged by this batch**, but is now meaningfully more
  costly for PDF specifically, since each call now performs N native-module round trips instead of
  one file read. Not solved here — flagged explicitly in "What this batch does not do" below, not
  hidden.
- No background job infrastructure was introduced. No caching layer was introduced.

## Security / privacy

Identical posture to every other normalization adapter: PDF text is untrusted source content,
never instructions — the existing prompt-injection framing in `docs/ai-generation-foundation.md`
already treats ALL chunk text this way regardless of source format, so no new guardrail work was
needed. Nothing in this batch logs full extracted text, card contents, auth tokens, or a private
source filename — `normalizeSource.ts`'s existing `logNormalization` helper (development builds
only) logs only source type, extraction status, chunk/page counts, and a diagnostic reason
category, exactly as it already did for every other format.

## Tests

16 deterministic tests, zero network/native-module dependency:

- `pdfAdapter.test.ts` (10) — single page; multi-page chunk ordering + page provenance; blank pages
  skipped; determinism; global (not per-page-local) chunk id computation; the global chunk-count
  ceiling; zero-page degradation; source-wide `charRange` is strictly increasing/non-overlapping
  across pages; a blank middle page still shifts a later page's `charRange` forward; `lineRange` is
  never populated for a PDF chunk.
- `pdfExtractionOutcome.test.ts` (6) — every `mapPdfExtractionError` code mapping — the package's
  own documented codes AND the ones actually observed in the native iOS/Android source during the
  dependency audit (see "Dependency" below) — including the unrecognized/non-object/missing-code
  fallback; `hasUsablePdfText`'s true/false cases.

The "genuine per-page throw fails the whole document closed" control flow in
`pdfTextExtraction.ts` (see "Error handling" above) is not independently unit-tested — it's a
`return mapPdfExtractionError(error)` inside the native-module-importing file itself, the same
file already established as untestable under plain `node --test` (see below); the classification
it relies on is already fully covered by `pdfExtractionOutcome.test.ts`.

`npm run test:ai`'s glob now also covers `src/domain/normalization/*.test.ts` — the first test
files this directory has ever had. `pdfTextExtraction.ts` and `normalizeSource.ts` themselves
cannot be unit-tested under `node --test` (both import native-module-backed code, confirmed
directly) — exactly why their logic was split into the pure, tested files above; this mirrors the
same isolation principle already used for `backend/lambdas/ai-generate-study-deck/
bedrockClient.mjs` vs `index.mjs`.

## Dependency: expo-pdf-text-extract

Audited directly against the installed package's own source (not just its README) as part of the
same independent review that caught the `charRange`/`lineRange` issues above:

- **Version 1.1.0** (`node_modules/expo-pdf-text-extract/package.json`), installed via
  `"^1.1.0"` in `package.json`. Single maintainer (npm registry: one listed maintainer,
  `gr8pathik`). Release history: `1.0.0` (2026-01-14, initial release), `1.0.1` (2026-02-22, iOS
  build fix), `1.1.0` (2026-05-20, added password-protected PDF support — the version this batch
  depends on). No release since 2026-05-20. ~13.4k npm downloads/month. GitHub: 13 stars, 9 forks,
  not archived.
- **iOS**: Apple PDFKit (`PDFDocument`/`PDFPage.string`) — a first-party system framework, not a
  versioned CocoaPod, so there is no possible version conflict with `react-native-pdf` (which also
  links `PDFKit` directly, for rendering, on iOS).
- **Android**: Apache PDFBox port `com.tom-roush:pdfbox-android:2.0.27.0` — a real, independent
  Maven dependency. `react-native-pdf` uses Android's native `PdfRenderer` API on Android, not
  PDFBox, and no other package in this project's dependency tree pulls in `com.tom-roush:*` —
  confirmed by grepping every installed `.gradle` file. No transitive native-version conflict with
  `react-native-pdf` on either platform.
- **Page-aware extraction is genuine, not emulated**: `getPageCount(filePath)` and
  `extractTextFromPage(filePath, pageNumber)` are real, independent native calls on both platforms
  (iOS: `document.page(at:)`; Android: `PDFTextStripper` with `startPage`/`endPage` set to the
  single requested page) — not a single whole-document extraction split by this project's own code.
- **Lazy-loading confirmed safe for TXT**: `expo-pdf-text-extract`'s own top-level module load
  (`dist/index.js`) wraps `requireNativeModule('PdfExtractor')` in a try/catch and falls back to a
  `null` module reference with only a `console.log`, never a thrown error — confirmed by reading
  the compiled JS directly. Every actual extraction function (`extractText`/`getPageCount`/
  `extractTextFromPage`) only throws when *called* with the module unavailable, and this batch's
  own `extractPdfPageTexts()` always checks `isAvailable()` first and never calls them otherwise.
  Merely importing the package anywhere in the module graph (as `normalizeSource.ts` now
  transitively does, for every source type including `text`) cannot fail or crash — TXT generation
  cannot be broken by PDF extraction being unavailable.
- **Encrypted/password-protected PDFs have genuine, first-class, cross-platform support** —
  `PASSWORD_REQUIRED`/`INCORRECT_PASSWORD` are real, consistently-thrown codes on both platforms,
  matching the package's own documented contract exactly.
- **Corrupt/missing-file/no-text PDFs do NOT have the clean, documented behavior the package's own
  public `PdfErrorCode` type claims.** `CORRUPT_PDF` — part of the package's own published
  `dist/index.d.ts` type — is not actually thrown by either native implementation inspected here;
  iOS throws `PDF_LOAD_ERROR` (load/parse failure) or `PDF_PAGE_ERROR` (out-of-range page), while
  Android throws `PDF_EXTRACTION_ERROR` (extractText/extractTextFromPage) or `PDF_ERROR`
  (getPageCount) for the equivalent failures — four distinct, undocumented codes the package's own
  type signature doesn't mention. This was already handled safely by this batch's original
  catch-all fallback (never crashes, never leaks the raw error) but collapsed all of them to one
  generic "unknown" reason; `mapPdfExtractionError` now explicitly recognizes all four real codes
  alongside the documented one, for more precise (but still non-content, safe-to-log) diagnostics.
- **A real, disclosed accuracy limitation, not a crash risk**: an open, unmerged pull request
  against the package (`gr8pathik/expo-pdf-text-extract#3`, opened 2026-09-06) documents that
  neither platform's extraction preserves column/table layout — a multi-column or tabular PDF
  (invoices, statements, reports) can extract with a continuation line indistinguishable from a
  new row, changing apparent meaning without any error being raised. No code in this batch
  attempts to detect or correct this; it is a known, disclosed limitation of the underlying
  extraction technique, not something to fix here.
- **A real, currently-inapplicable build-compatibility gap**: a second open, unmerged pull request
  (`gr8pathik/expo-pdf-text-extract#2`, opened 2026-09-04) documents that the Android module's
  Gradle config fails to build under Android Gradle Plugin 9 (AGP registers its own `kotlin`
  extension, colliding with the module's explicit `kotlin-android` plugin application). This
  project currently pins **AGP 8.11.0** (via `@react-native/gradle-plugin` for React Native
  0.81.5 — confirmed in `node_modules/@react-native/gradle-plugin/gradle/libs.versions.toml`), so
  this does not block this project's Android build today, but it is a concrete signal that an AGP
  9 upgrade would need this dependency to have moved first.
- **Recommendation: see "Dependency recommendation" in the final report delivered alongside this
  audit** — not duplicated here to avoid two sources of truth; this document records the factual
  findings, the report records the decision.

## What this batch does not do

- No OCR, no image-only/scanned PDF support — an empty-text result for those is the correct,
  final answer in this batch, not a bug to fix later with a different technique.
- No table/column-layout-aware extraction — see "Dependency" above; a tabular PDF may extract with
  rows/continuation lines that are visually indistinguishable once flattened to plain text.
- No change to the AI domain contract, the backend Lambda, Bedrock, CDK, IAM, API Gateway, or EAS.
- No Staging deployment, no Production change, no model-router work, no RAG/vector database work,
  no audio/transcription work, no DOCX-generation expansion, no spreadsheet-generation work.
- No new "Generated from page 14" UI was built — the provenance data (`chunk.provenance.page`)
  this would need is now real and available, but rendering it is a separate, future UX change.
- No caching/memoization of the normalize-twice-per-user-journey pattern described under
  "Performance" above — flagged, not solved.
- No retries of a failed page's extraction, and no OCR fallback for one — a genuine per-page
  throw fails the document closed (see "Error handling" above), it is not retried or worked
  around.
- No native rebuild was performed and no device testing occurred as part of writing this code —
  `expo-pdf-text-extract` requires a Development Build rebuild (`npx expo run:ios`/`eas build`)
  before it can be exercised at all; see the Founder QA section.

## Founder QA

**A native rebuild is required before any of this is testable on-device** — `npm install` alone
does not make a new native module's code available to an already-built app; see
`docs/development-build-workflow.md` for the existing rebuild procedure (same one used when
`expo-audio` was added).

1. Import/open a normal text-based PDF — confirm it still opens normally in the Reader (untouched
   by this batch).
2. From that PDF's Library Source Detail, start Generate Study Deck.
3. Confirm the options screen shows the PDF as generation-eligible (no "not ready" message).
4. Request a basic/medium/long card count.
5. Confirm generation actually reaches the real backend/Nova 2 Lite path (not `[MOCK]`) — same
   confirmation method as the existing TXT real-AI QA steps.
6. Confirm generated cards are grounded in the PDF's real content.
7. Confirm `sourceChunkIds`/provenance are present and sensible for each card.
8. Edit a generated card; save the deck; reopen and study it normally.
9. Try a very small/short PDF — confirm the model may return fewer cards than requested rather
   than filler.
10. Try a PDF with no extractable text (a scanned/image-only PDF) — confirm a clear, graceful "no
    usable text" failure, never a crash, never a pretend success.
11. Try a password-protected PDF, if one is available — confirm a graceful failure, never a raw
    native error.
12. Try a multi-page PDF with a mix of text pages and image-only/scanned pages — confirm
    generation only draws from the text-bearing pages (via `sourceChunkIds`/page citations) and
    nothing in the UI implies the image-only pages were read.
13. If a tabular/invoice-style PDF is available, generate from it and spot-check a card's cited
    page — confirm no card fabricates a relationship between a row and a continuation line that
    extraction may have flattened together (see "Dependency" above; a known extraction-accuracy
    limitation, not expected to be fixed by this batch).
14. Confirm TXT generation still works exactly as before.
