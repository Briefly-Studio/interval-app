# Source Normalization Foundation

**Status: implemented and integrated, carried forward through `v3.3-dev`'s
`feat/ai-multiformat-generation`.** This document describes a domain/foundation layer
(`src/domain/normalization/`) — it produces a common `NormalizedSourceContent` shape from
format-specific adapters. No AI provider, model API, prompt, or generation feature lives in this
layer. TXT, PDF, DOCX, and XLSX now all produce real `ready` content; image and audio remain
structural stubs — real OCR and transcription are investigated in depth, but not implemented, in
`docs/ai-multiformat-generation.md` (that document's own "Blockers" sections explain why). See
CLAUDE.md's Documentation Hierarchy.

## Purpose

Interval's source consumption today is format-specific: PDF is rendered by a PDF viewer, plain
text is read as text, DOCX is parsed into structured blocks (by the same parser the DOCX Reader
uses), XLSX is parsed into sheet/row text, images are displayed visually, and audio playback lives
on its own screen. The first AI feature — `Library Source → Generate → Study Deck` — and
everything after it (quiz generation, summaries, "ask this source", multi-source generation)
would otherwise need to reimplement `if (pdf) ... else if (docx) ... else if (txt) ...` branching
in every future feature.

This foundation exists so that never has to happen. `normalizeSource(source)` is the single
entry point: give it a `LibrarySourceRecord`, get back a `NormalizationResult` carrying a
provider-neutral, provenance-aware, chunked representation of that source's content — or an
honest, explicit statement of why no content is available yet, without ever inventing content or
pretending unsupported extraction succeeded.

## Canonical contract

```ts
type NormalizationResult = { status: ExtractionStatus; content: NormalizedSourceContent };

type NormalizedSourceContent = {
  sourceId: string;
  sourceType: SourceType;      // "pdf" | "docx" | "text" | "image" | "audio" | "pptx" | "xlsx"
  title: string;                // LibrarySourceRecord.displayTitle
  originalName?: string;
  language?: string;            // ONLY ever copied from LibrarySourceRecord.sourceLanguage — never guessed
  contentKind: ContentKind;     // "text" | "structured-text" | "image" | "audio" | "unsupported"
  chunks: NormalizedChunk[];
  metadata: NormalizedSourceMetadata;  // byteSize / pageCount / durationSeconds / description
  extraction: ExtractionInfo;   // { status, adapter, reason? }
  normalizationVersion: number;
};
```

`NormalizationResult` is deliberately uniform: every status (`ready`, `empty`, `unsupported`,
`pending-extraction`, `too-large`, `failed`) always carries a full `content` object, never a bare
error for some variants and a rich object for others. A caller can always read
`result.content.title`/`.metadata`/`.extraction` regardless of status — useful even when there's
no text (e.g. showing "Word documents aren't readable yet" next to the source's own title).

`contentKind` is a deliberately separate axis from `sourceType`/MIME — a `.txt` file and a future
well-behaved `.docx` both ultimately produce prose text a future AI consumer should treat
identically as `"text"`/`"structured-text"`; overloading file format as content shape would leak
format branching straight back into every future AI feature, which is exactly what this
foundation exists to prevent.

## Chunk contract

```ts
type NormalizedChunk = {
  id: string;              // deterministic, content-addressed — see "Determinism" below
  index: number;
  text: string;
  approxSize: number;      // character count — a size SIGNAL, not a token count (see "Provider neutrality")
  provenance: ChunkProvenance;
  blockType?: string;      // "heading" | "paragraph" | "listItem" | "tableRow" | ... — structured adapters only
};
```

## Provenance model

Every chunk carries a `ChunkProvenance` with only the fields a real extraction path can actually
back:

| Format (this batch)     | Provenance populated                          |
| ------------------------ | ---------------------------------------------- |
| Plain text                | `charRange` (offsets into the adapter's normalized text) + `lineRange` (1-based, inclusive) |
| Structured blocks (future DOCX) | `blockIndex` + `heading` (see docxAdapter.ts) |
| PDF with extractable text | `page` (real, 1-based, from actual per-page extraction) + `charRange` — a true, document-wide offset (see "PDF text extraction" below); `lineRange` is deliberately never populated for PDF |
| PDF with no extractable text, or DOCX | none — extraction itself is `empty`/`pending-extraction`, so no chunk exists to attach anything to |
| Image / audio              | none — no text chunks exist for these content kinds in this batch |

A page number, timestamp range, or any other provenance field is **never** invented when the
extraction path that would produce it doesn't exist. `ChunkProvenance.page` is now populated with
real values by the PDF adapter (see "PDF text extraction" below) — the first provenance field in
this contract to graduate from "reserved for a future adapter" to actually populated by a real
one. `.timeRangeMs` still exists on the type purely so a future audio-transcript adapter has a
place to put real values, without changing this contract's shape when it arrives. This is what
lets a future UI honestly say "Generated from page 14" or "Generated from lines 220–260" — for
PDF chunks, the provenance backing that claim is real today, not backfilled later from a guess.

`charRange`'s contract (above) is "offsets into the adapter's own normalized text" — for any
format sharing `contentKind: "text"` with plain text (PDF included), that means ONE whole-document
coordinate space, not a per-section one; a per-page-relative reading was shipped briefly during
PDF integration and corrected before founder QA — see `docs/ai-pdf-generation.md`'s "Document text
coordinate system" section for the full correction record and why `lineRange` is omitted for PDF
instead of also being made document-wide.

## Normalization version

`NORMALIZATION_VERSION = 1` (types.ts). Bumped only when the normalization/segmentation algorithm
changes in a way that would produce different chunk boundaries/ids/text for byte-identical input
— never bumped for a comment change or a behavior-preserving refactor. This lets a future cache or
generation-provenance record distinguish "this chunk was produced by an older algorithm" from
"the source's actual content changed," without any migration machinery — see "Persistence policy"
below for why there's nothing to migrate yet.

## Adapter dispatch

`normalizeSource(source: LibrarySourceRecord): Promise<NormalizationResult>`
(`normalizeSource.ts`) is the single dispatch point, branching on `source.sourceType` exactly
once. Each adapter is:

- **`text`** (`textAdapter.ts`) — the gold-standard, fully-implemented adapter. Reuses the
  existing local-first/cloud-fallback resolution (`resolveSourceOriginal`) and viewer-input
  staging (`prepareViewerInput`) unchanged — no second download pipeline, no persisted signed URL.
- **`pdf`** (`pdfAdapter.ts` + `pdfTextExtraction.ts`) — real text extraction via a native module
  (see "PDF text extraction" below, which supersedes the original "PDF extraction investigation"
  record kept further down for history). Resolves/stages the file exactly like `text` does, then
  extracts per-page text and chunks it. `ready` for a PDF with real extractable text; `empty` for
  one with none (most commonly scanned/image-only — no OCR); `pending-extraction` only if the
  native extraction module isn't loaded in this runtime; `failed` for password-protected/corrupt
  files; `too-large` over the extraction page-count or extracted-text-size ceiling.
- **`docx`** (`docxAdapter.ts`) — real extraction, reusing the existing DOCX Reader's own parser
  (`docxContent.ts`/`sourceReaderDocx.ts`) — see "DOCX adapter integration" below. `ready` for a
  document with real text; `empty` for one with none (e.g. image-only); `failed` for an
  encrypted/unreadable file; `too-large` over the parser's own block-count ceiling.
- **`xlsx`** (`spreadsheetAdapter.ts`) — real extraction via a purpose-built SpreadsheetML reader
  — see "XLSX normalization" below. Same status set as DOCX.
- **`image`** (`imageAdapter.ts`) — `unsupported` (no OCR this batch); metadata only. A concrete,
  audited on-device OCR candidate exists but was not wired in — see
  `docs/ai-multiformat-generation.md`'s "Image / OCR" section for the full investigation and why.
- **`audio`** (`audioAdapter.ts`) — `unsupported` (no transcription this batch); metadata only.
  See `docs/ai-multiformat-generation.md`'s "Audio / transcription" section for why this remains
  blocked rather than wired to an on-device speech-recognition package.
- **`pptx`** — `unsupported`; no adapter exists (out of scope for this batch — not requested).

## PDF text extraction

**Superseded the investigation below.** `pdfTextExtraction.ts` wraps `expo-pdf-text-extract` (a
small, purpose-built native module — Apple PDFKit on iOS, Apache PDFBox on Android) to get real,
per-page extracted text, isolated from the rest of the normalization layer so `pdfAdapter.ts`'s
own chunking/provenance logic (and `pdfExtractionOutcome.ts`'s error-mapping logic) stay pure and
unit-testable without a native module or React Native runtime. See `docs/ai-pdf-generation.md`
for the full architecture, data flow, provenance strategy, limitations, and founder QA checklist.
No OCR anywhere in this path — a scanned/image-only PDF (or a page with no text layer) correctly
extracts to empty text and reports `empty`, never fabricated content.

## PDF extraction investigation (historical — the original `pending-extraction` decision record)

Investigated before writing any adapter code, back when this adapter was a `pending-extraction`
stub:

- `react-native-pdf@7.0.1` (the only PDF library in this project — see `src/domain/sourceReader.ts`)
  exposes **no text-extraction API** anywhere in its public surface (`index.d.ts` and README
  audited directly). It is purely a native page **renderer** (PDFKit on iOS, PdfRenderer on
  Android) with no method to read a page's text back into JS.
- No JS-only PDF-parsing library (e.g. `pdfjs-dist`) is installed. Adding one to get real text
  extraction would be a substantial new dependency whose typical text-extraction code path
  depends on Web Worker/Canvas/DOM APIs that don't exist natively in React Native/Hermes —
  making it work would need unverified polyfilling.

**Conclusion at the time: client-side PDF text extraction was not realistically available with the
stack integrated then.** `pdfAdapter.ts` was an honest `pending-extraction` stub with real
page-count metadata (`source.pageCount`, when already known) but zero fabricated chunks or page
numbers. That adapter interface turned out to be exactly ready for the real implementation that
followed — `expo-pdf-text-extract`, a vetted native module, slotted in without changing how
`normalizeSource` dispatches to `pdf` at all (see "PDF text extraction" above).

## DOCX adapter integration

**Corrected record:** earlier revisions of this document said the DOCX Reader's real
WordprocessingML parser lived on a separate, unmerged branch that normalization must not touch.
That branch merged into this codebase's history well before this batch (`docs/docx-reader.md`:
"implemented and integrated into `v3.2-dev`"; confirmed directly via
`git merge-base --is-ancestor feat/document-reader-docx HEAD` → yes) — the "do not touch" premise
no longer held, and this batch wires the real integration that was previously only anticipated.

`docxAdapter.ts` still defines the **generic shape** a structured-block source needs
(`GenericStructuralBlock[]` — `heading` / `paragraph` / `listItem` / `tableRow` / `image`, each
with plain text and an optional enclosing heading) plus `normalizeStructuredBlocks` — the real,
reusable segmentation logic that turns already-extracted blocks into provenance-carrying chunks
(one chunk per non-empty block, `blockIndex` + `heading` provenance, `contentKind:
"structured-text"`, no `charRange` — the structured-text contract's existing, deliberate omission
is unchanged). New in this batch: `mapDocxBlocksToGenericBlocks` + `normalizeDocxSource`, which
reuse the existing DOCX Reader's own `readDocxArchive` (`sourceReaderDocx.ts`) and `DocxBlock[]`
(`docxContent.ts`) completely as-is — no new DOCX parsing code exists anywhere in this batch.
Runs are flattened to plain text (formatting fidelity stays a Reader concern); a table row becomes
one chunk with its cells joined by `" | "`; an image block carries no text (no OCR, same rule as
`imageAdapter.ts`). `normalizeSource.ts`'s `docx` branch now resolves/stages the file exactly like
`text`/`pdf` do, reads it as raw bytes (`File.bytes()`), and maps the outcome onto
`ExtractionStatus`: `ready`/`empty` pass through `normalizeDocxSource`'s own content;
`too-large` for the parser's existing block-count ceiling; `failed` for a read/resolution error
**or** an encrypted/unrecognized archive (deliberately not `unsupported` — see the adapter's own
code comment: `unsupported` in Generate Study Deck means "this format can never work," which
would misrepresent an otherwise-ordinary DOCX that merely couldn't be opened this time).

## XLSX normalization

**New in this batch.** `spreadsheetAdapter.ts` is a purpose-built, read-only SpreadsheetML reader
— the same architecture choice already made for DOCX, not a new one. The two mature pure-JS
alternatives were explicitly rejected after a real audit (see
`docs/ai-multiformat-generation.md`'s "Dependencies" section for the full record): the
npm-published `xlsx` (SheetJS) package is permanently stuck at its last-ever-published version
(0.18.5, 2022) and carries an unpatched GitHub Security Advisory
(GHSA-4r6h-8v6p-xvw6/CVE-2023-30533, prototype pollution — SheetJS's own advisory states no fixed
version is available via npm); `exceljs` is Node-oriented (`tmp`, `archiver`, `unzipper`,
`readable-stream` — filesystem/Node-stream APIs with no real fit in a React Native runtime).
Instead, `spreadsheetAdapter.ts` reuses `fflate` (already a dependency, already audited for this
exact purpose — see DOCX) with the same zip-bomb/untrusted-input defense: an allow-list of exactly
four entry kinds (`xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/sharedStrings.xml`,
`xl/worksheets/sheetN.xml`), each with its own pre-inflation size ceiling — no chart, drawing,
embedded object, or macro part is ever accepted.

Each sheet's rows render as one flat, honest text block — `Sheet: <name>` / `Columns: <header
row>` / `Row N: <cells joined with " | ">` — then the WHOLE workbook's text runs through the
existing `segmentText()` chunker (the same one TXT/PDF already use), so line/char provenance is
real (it cites real lines/characters of this generated text) without adding a single new
provenance field or a parallel chunking strategy — exactly the path the mission's own provenance
guidance recommends when "existing provenance types do not support spreadsheet coordinates."
`contentKind: "text"` (not a new kind) follows from reusing the flat-text chunker as-is. A cell
absent from the XML (Excel omits blank cells entirely) becomes an honest empty slot at its real
column position, never silently dropped and never fabricated. A formula cell's cached,
already-computed result is used (the same value Excel itself displays) — the formula source text
itself is never read or evaluated. **Known limitation:** sheet/row identity lives only in the
chunk's own text (e.g. "Row 12: ..."), not in a structured `ChunkProvenance` field — deliberate,
per the mission's explicit instruction not to redesign the provenance system for this.

## Image normalization

No OCR, no vision model call. `normalizeImageSource` returns a full `NormalizedSourceContent`
with `contentKind: "image"`, zero chunks, `extraction.status: "unsupported"`, and whatever real
metadata already exists (`byteSize`). The source's own `title`/`displayTitle` is never treated as
extracted image content — it's an identity field populated on every content kind, not a
substitute for text this adapter has no way to read from pixels. `NormalizedSourceMetadata`
reserves a `description` field for a future user-authored alt-text field, should one ever be
added to `LibrarySourceRecord` — no such field exists on the model today, so nothing populates it
yet. This was investigated in depth for real on-device OCR (`feat/ai-multiformat-generation`) — a
concrete, audited candidate exists but was not wired in; see `docs/ai-multiformat-generation.md`'s
"Image / OCR" section.

## Audio normalization

No transcription. `normalizeAudioSource` returns `contentKind: "audio"`, zero chunks,
`extraction.status: "unsupported"`, and `durationSeconds` copied only from the already-known
`LibrarySourceRecord.audioDuration` — never derived by decoding or probing audio bytes, which
this batch does not do. `ChunkProvenance.timeRangeMs` already exists on the shared type as the
boundary a future timestamped-transcript adapter would populate; nothing in this batch writes to
it. Also investigated in depth (`feat/ai-multiformat-generation`) and found to need real
architecture work beyond a single dependency add; see `docs/ai-multiformat-generation.md`'s
"Audio / transcription" section for the specific technical blockers found.

## Text adapter: requirements and behavior

- UTF-8, full content, no semantic truncation.
- Line endings normalized to LF only (`\r\n` and lone `\r` → `\n`) — no blank lines collapsed, no
  trailing whitespace trimmed. All chunk `charRange`/`lineRange` provenance refers to offsets in
  this **normalized** text, not the raw bytes read from disk.
- Empty file (0 bytes, or normalized text of zero length) → `status: "empty"`, zero chunks,
  `extraction.status: "empty"` — a structurally valid result, not an error.
- Malformed read (decode failure, file I/O error) → `status: "failed"` with a diagnostic category
  in `extraction.reason`, never a thrown exception surfacing as product state.

### Size limit: separately justified, not reused from the Reader

The existing Full Reader has its own 25 MB device-memory safety ceiling
(`src/domain/sourceReaderText.ts`), which exists purely to bound a single JS string allocation for
on-screen display. Normalization is a different workload — it additionally runs paragraph-boundary
scanning, per-chunk line-range binary search, and per-chunk content hashing over that same text,
synchronously, on demand (see "Persistence policy"). A future AI consumer also has no realistic
use for eagerly normalizing a single document anywhere near 25 MB of raw text (order of several
thousand book-equivalent pages) — that scale needs its own future "select relevant chunks from an
oversized source" design, not whole-document normalization today.

**`MAX_NORMALIZATION_TEXT_BYTES = 10 MB`** (`textAdapter.ts`) — deliberately smaller than the
Reader's ceiling, generous for any realistic book/chapter/article-length source (a very long novel
is typically a few MB of plain text). Exceeding it returns `status: "too-large"` with a full
`content` stub (title/metadata still populated) — never a silent truncation.

## Segmentation algorithm

Provider-neutral (`chunking.ts`) — no LLM/tokenizer/provider name appears anywhere in this file
or anything it calls. Chunk size is measured in JS string character count only.

1. **Paragraph-first**: split on one-or-more blank lines. Paragraph boundaries are the preferred
   semantic break.
2. **Merge short paragraphs**: consecutive short paragraphs are greedily merged into one chunk up
   to `DEFAULT_CHUNK_TARGET_CHARS` (2000 chars) — a document made of many short paragraphs
   doesn't produce one chunk per paragraph ("do not create a million tiny chunks").
3. **Split oversized paragraphs**: a single paragraph longer than `DEFAULT_CHUNK_MAX_CHARS` (3000
   chars) is split into bounded windows ("do not create giant arbitrary chunks"), each snapped to
   the nearest whitespace within a small lookback window when one exists, and never splitting a
   UTF-16 surrogate pair (relevant for any character outside the Unicode BMP, including a
   meaningful share of emoji).

### Overlap behavior

`DEFAULT_CHUNK_OVERLAP_CHARS = 200` — applied **only** at the bounded-window fallback (step 3),
never between merged-paragraph chunks. Merged-paragraph chunk boundaries are already real
semantic breaks and don't benefit from overlap; a mid-paragraph forced cut does, so consecutive
windows there share `200` characters of trailing/leading context for a future LLM reading two
adjacent chunks.

### Coverage guarantee (no silent truncation)

Paragraph segments are constructed to be **contiguous and gapless** — each segment's end extends
through its trailing blank-line separator up to the next paragraph's actual content start (or to
the end of the text for the last paragraph), so the union of every chunk's `charRange` covers
`[0, text.length)` exactly, with zero gaps (overlap windows only ever add extra coverage, never
create one). This is verified directly by this batch's own test suite (see "Focused validation").
If segmentation would exceed `MAX_CHUNKS` (5000 — a defense-in-depth ceiling for a genuine
algorithmic anomaly, not a normally-reachable limit given the byte ceiling above already bounds
chunk count in ordinary operation), the adapter returns `too-large` rather than a silently partial
chunk list — "complete or too-large," never a partial result silently labeled as success.

## Determinism

Same source bytes + same `NORMALIZATION_VERSION` + same chunking parameters → identical chunk
ordering, text, and ids, every time. Verified directly: the focused test suite normalizes the
same synthetic text twice and asserts byte-for-byte identical output. This matters for future
caching, generation provenance ("this flashcard was generated from chunk X"), and reproducibility.

### Stable chunk ids

`computeChunkId` (`chunking.ts`) is a **content-addressed fingerprint** —
FNV-1a 32-bit hash over `sourceId | normalizationVersion | index | chunk text` — never a random
UUID. Two normalization runs over byte-identical content always produce byte-identical ids. If the
underlying text at a given index ever changes (a re-attached/replaced source file), that chunk's
id changes too — an intentional property: a stable id must mean stable *content*, not merely
stable *position*.

## Persistence / caching policy

Normalization is **computed on demand**, always. Nothing in this batch writes to any storage
layer — no new AsyncStorage key, no DynamoDB table/attribute, no S3 object. Calling
`normalizeSource` twice for the same source performs the same work twice. The `content` object's
shape (plus `normalizationVersion` and the fully content-addressed chunk ids) is deliberately
already cache-friendly — a future cache layer could key on `(sourceId, contentHash,
normalizationVersion)` — but building that cache is explicitly deferred; this batch does not
introduce one "casually," per the mission's own instruction.

## Unicode and RTL

Segmentation is validated against Latin, Cyrillic, Simplified Chinese, Japanese, Korean, Hindi,
Arabic, and emoji fixtures (see "Focused validation" below) — chunk boundaries never fall inside a
UTF-16 surrogate pair, and non-Latin text survives byte-for-byte through the full
normalize → segment → chunk pipeline. Normalization itself is direction-agnostic: no bidi control
characters are ever inserted, Arabic (or any RTL) text is never reversed or reordered — source
text order is preserved exactly as encoded, at the character level, throughout.

## Privacy

Normalization happens entirely on-device in this batch. No source content leaves the device — no
network request is made anywhere in `src/domain/normalization/`. Logging (`normalizeSource.ts`'s
`logNormalization`, development builds only) is restricted to: source type, extraction status,
byte count, chunk count, adapter name, and diagnostic failure category (e.g.
`"exceeds-10mb-normalization-limit"`) — never a chunk's text, never a fragment of source content,
never a full source string of any length.

## Security

Source files are treated as untrusted input, consistent with the rest of this app's source-
handling code (see `docs/library-and-source-architecture.md`). This batch introduces no new
parser with its own untrusted-input surface — the text adapter reads bytes via the already-
audited `File` API and treats the result as an opaque string; it never evaluates HTML, executes
scripts, follows external references, or opens a path outside the already-resolved, app-controlled
local file the existing Reader/Preview architecture already staged. There is no new dependency in
this batch (see below), so there is no new supply-chain surface to review either.

## AI pipeline integration — now real, for TXT, PDF, DOCX, and XLSX

The shape this batch produces turned out to be exactly what the real deck-generation pipeline
needed, unchanged, through every format added since:

```
NormalizedSourceContent (TXT: text-v1; PDF: pdf-text-v1 — see "PDF text extraction" above;
  DOCX: structured-blocks-v1 — see "DOCX adapter integration" above; XLSX:
  spreadsheet-structured-v1 — see "XLSX normalization" above)
  → select bounded context (src/domain/ai/contextPreparation.ts — sequential selection, no
    ranking/embeddings; see docs/ai-generation-foundation.md)
  → generate cards (real: AWS Bedrock / Amazon Nova 2 Lite, Development only — see
    docs/ai-generation-foundation.md and docs/ai-pdf-generation.md)
  → attach source provenance (chunk.provenance — real for every ready format: TXT/XLSX via
    charRange+lineRange, PDF additionally via a real page number, DOCX via blockIndex+heading)
  → review-screen provenance display, when the UI surfaces it
```

Nothing in `contextPreparation.ts`, `aiService.ts`, `responseValidation.ts`, `generateDeckFlow.ts`,
or `generationCoverage.ts` branches on `sourceType` — confirmed directly (not assumed) for this
batch: every one of those files was read in full and contains zero `sourceType`/format-specific
logic. DOCX and XLSX becoming AI-generation-eligible required zero changes to any of them.

This document itself still names no AI provider as ITS OWN implementation choice — that remains
correctly the responsibility of `docs/ai-generation-foundation.md`'s own contract and the Bedrock
integration's own reports, not this normalization-layer document.
