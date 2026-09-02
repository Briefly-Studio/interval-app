# Source Normalization Foundation

**Status: implemented on `feat/source-normalization-foundation`, not yet integrated into
`v3.1-dev`.** This document describes a domain/foundation layer only — no AI provider, model API,
prompt, or generation feature exists anywhere in this batch. See CLAUDE.md's Documentation
Hierarchy for how this fits alongside the rest of the Library/source architecture docs once
integrated.

## Purpose

Interval's source consumption today is format-specific: PDF is rendered by a PDF viewer, plain
text is read as text, a separate (unmerged) branch parses DOCX into structured blocks, images are
displayed visually, and audio playback lives on its own separate (parked) branch. The planned
first AI feature — `Library Source → Generate → Study Deck` — and everything after it (quiz
generation, summaries, "ask this source", multi-source generation) would otherwise need to
reimplement `if (pdf) ... else if (docx) ... else if (txt) ...` branching in every future feature.

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
| PDF                       | none — extraction itself is `pending-extraction`, so no chunk exists to attach a page number to |
| Image / audio              | none — no text chunks exist for these content kinds in this batch |

A page number, timestamp range, or any other provenance field is **never** invented when the
extraction path that would produce it doesn't exist — `ChunkProvenance.page` and `.timeRangeMs`
exist on the type today specifically so a future PDF-with-real-extraction adapter and a future
audio-transcript adapter have a place to put real values, without changing this contract's shape
when they arrive. This is what lets a future UI honestly say "Generated from page 14" or
"Generated from lines 220–260" — the provenance backing that claim is real today, not backfilled
later from a guess.

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
- **`pdf`** (`pdfAdapter.ts`) — `pending-extraction` (see "PDF extraction investigation" below).
  Never resolves/downloads the file at all — the answer doesn't depend on it.
- **`docx`** (`docxAdapter.ts` boundary + dispatcher) — `pending-extraction`; see "DOCX adapter
  boundary" below.
- **`image`** (`imageAdapter.ts`) — `unsupported` (no OCR this batch); metadata only.
- **`audio`** (`audioAdapter.ts`) — `unsupported` (no transcription this batch); metadata only.
- **`pptx`/`xlsx`** — `unsupported`; no adapter exists at all yet (explicitly out of scope, same
  as the DOCX Reader mission's own scoping).

## PDF extraction investigation

Investigated before writing any adapter code:

- `react-native-pdf@7.0.1` (the only PDF library in this project — see `src/domain/sourceReader.ts`)
  exposes **no text-extraction API** anywhere in its public surface (`index.d.ts` and README
  audited directly). It is purely a native page **renderer** (PDFKit on iOS, PdfRenderer on
  Android) with no method to read a page's text back into JS.
- No JS-only PDF-parsing library (e.g. `pdfjs-dist`) is installed. Adding one to get real text
  extraction would be a substantial new dependency whose typical text-extraction code path
  depends on Web Worker/Canvas/DOM APIs that don't exist natively in React Native/Hermes —
  making it work would need unverified polyfilling.

**Conclusion: client-side PDF text extraction is not realistically available with the currently
integrated stack.** `pdfAdapter.ts` is an honest `pending-extraction` stub with real page-count
metadata (`source.pageCount`, when already known) but zero fabricated chunks or page numbers. The
adapter interface is ready for a future implementation — either a vetted JS PDF-text library, or
a server-side extraction step — without changing how `normalizeSource` dispatches to it.

## DOCX adapter boundary

DOCX Reader — a real WordprocessingML block parser — is implemented on the separate, unmerged
`feat/document-reader-docx` branch. This mission's governance explicitly forbids touching,
cherry-picking, or duplicating that branch's code. `docxAdapter.ts` therefore defines only the
**generic shape** a structured-block source needs (`GenericStructuralBlock[]` — `heading` /
`paragraph` / `listItem` / `tableRow` / `image`, each with plain text and an optional enclosing
heading) plus the real, reusable segmentation logic (`normalizeStructuredBlocks`) that turns
already-extracted blocks into provenance-carrying chunks (one chunk per non-empty block,
`blockIndex` + `heading` provenance). Once the DOCX branch integrates, mapping its own richer
`DocxBlock[]` (which additionally tracks bold/italic runs — a Reader/typography concern, not a
normalization concern) down to `GenericStructuralBlock[]` is a few lines; nothing here duplicates
or risks drifting from that branch's actual XML parsing. Until then, `normalizeSource` returns
`pending-extraction` for `sourceType: "docx"` directly, without calling `normalizeStructuredBlocks`
at all (there is no block data to feed it in this branch).

## Image normalization

No OCR, no vision model call. `normalizeImageSource` returns a full `NormalizedSourceContent`
with `contentKind: "image"`, zero chunks, `extraction.status: "unsupported"`, and whatever real
metadata already exists (`byteSize`). The source's own `title`/`displayTitle` is never treated as
extracted image content — it's an identity field populated on every content kind, not a
substitute for text this adapter has no way to read from pixels. `NormalizedSourceMetadata`
reserves a `description` field for a future user-authored alt-text field, should one ever be
added to `LibrarySourceRecord` — no such field exists on the model today, so nothing populates it
yet.

## Audio normalization

No transcription. `normalizeAudioSource` returns `contentKind: "audio"`, zero chunks,
`extraction.status: "unsupported"`, and `durationSeconds` copied only from the already-known
`LibrarySourceRecord.audioDuration` — never derived by decoding or probing audio bytes, which
this batch does not do. `ChunkProvenance.timeRangeMs` already exists on the shared type as the
boundary a future timestamped-transcript adapter would populate; nothing in this batch writes to
it.

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

## Future AI pipeline integration

The shape this batch produces is exactly what a future deck-generation pipeline needs:

```
NormalizedSourceContent
  → select relevant chunks (future: a ranking/selection step, not implemented here)
  → generate cards (future: an AI provider call, not implemented here)
  → attach source provenance (chunk.provenance is already real and available today)
  → future UI: "Generated from page 14" / "Generated from lines 220–260"
```

No AI provider (OpenAI, Anthropic, Bedrock, Gemini, or otherwise) is named, selected, or called
anywhere in this batch or this document. Provider architecture is explicitly deferred to a future,
separate batch.
