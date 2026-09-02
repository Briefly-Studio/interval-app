# DOCX Reader

**Status: implemented and integrated into `v3.2-dev`; founder runtime QA verified (native
Development Build, iOS).** Reconciled onto the current canonical tree and merged via
`merge: reconcile DOCX reader with v3.2 foundation` → `merge: integrate DOCX reader`.

The DOCX reader is one of Interval's embedded Library source readers (alongside PDF, image, and
text — see `docs/library-and-source-architecture.md`'s "Source open/preview" section for how the
reader screen and "Open original" relate). It renders a `.docx` file as native React Native
content inside the app; it is **not** an editor and **not** a pixel-accurate Word renderer.

## Architecture — native / client-only

- **No WebView.** No `react-native-webview`, no headless browser, no HTML rendering.
- **No cloud conversion.** The file is never uploaded anywhere for rendering. Parsing happens
  entirely on-device from the local (or on-demand cloud-downloaded) original.
- **No new native module for rendering.** Rendering is ordinary `<Text>` / `<View>` /
  `<Image>` / `<ScrollView>` inside the existing reader screen (`app/library/[id]/reader.tsx`).

## Parser

`src/domain/docxContent.ts` + `src/domain/sourceReaderDocx.ts`.

- **`fflate` 0.8.3** (pure-JS, zero-dependency, MIT) unzips the OOXML container. Its pre-inflation
  `filter` hook is the zip-bomb / path-traversal defense: only `word/document.xml`,
  `word/_rels/document.xml.rels`, and `word/media/*` images are ever decompressed, each under
  hard absolute size caps (`MAX_DOCUMENT_XML_BYTES`, `MAX_MEDIA_FILE_BYTES`,
  `MAX_MEDIA_TOTAL_BYTES`, `MAX_MEDIA_COUNT`), with a `MAX_ARCHIVE_BYTES` outer ceiling.
- **`document.xml` is walked with a single linear tag-tokenizer**, not a general XML/DOM parser.
  There is no `<!DOCTYPE>` / `<!ENTITY>` code path at all, so there is no XXE / entity-expansion
  surface. Every regex is anchored to the next `<`/`>` — no catastrophic-backtracking risk.
- **Fidelity contract**: paragraphs, line breaks, heading levels 1–3, bullet-styled list items
  (numbering.xml is deliberately not parsed — every `w:numPr` paragraph renders as a generic
  bullet), basic bold/italic, table cell text as a readable ruled grid, and embedded images
  (resolved via relationships, `r:embed` only — never `r:link`). Explicitly not attempted: exact
  fonts, pagination, macros, tracked changes, comments, OLE objects, or any editing.
- **`MAX_BLOCKS = 5000`**: a document that would exceed this is surfaced as `too-large` rather
  than partially rendered.
- **Legacy `.doc`**: `sourceType: "docx"` covers both `.doc` and `.docx`, but reader support is
  DOCX-only (`resolveSourceReaderStrategy` requires the resolved extension to be `docx`). Legacy
  binary `.doc` (OLE2/CFB) is not a ZIP and cannot be opened by this parser — it falls back to
  "Open original".

## Rendering — block model and table layout

`app/library/[id]/reader.tsx`.

- Each parsed block (heading / paragraph / list item / table row / image) is exactly one
  `FlatList` item, so a long document's native view count stays bounded by what is visible, not
  by total word count. Bold/italic runs are nested `<Text>` spans.
- **Consecutive table rows are coalesced** into a single logical table for rendering
  (`coalesceDocxTableRows`), so a whole table shares one set of column widths and one horizontal
  scroll offset. Coalescing is bounded by `MAX_BLOCKS` upstream.
- **Column sizing is deterministic** (`src/domain/docxTableLayout.ts`,
  `computeDocxTableLayout(columnCount, viewportWidth, minColumnWidth = 120)`):
  - `DOCX_TABLE_MIN_COLUMN_WIDTH = 120` dp — a column is never rendered narrower than this.
  - **Narrow table** (`columnCount * 120 <= viewport`): columns widen evenly to fill the
    viewport; no horizontal scroll, no wasted horizontal space.
  - **Wide table** (natural width exceeds the viewport): every column holds the 120 dp minimum,
    the table becomes wider than the screen, and it is wrapped in a single horizontal
    `<ScrollView>` — the whole table scrolls as one unit. Word's own `w:tblGrid`/`w:tcW` twips
    are deliberately not parsed; mobile readability wins over matching Word's exact layout.
  - Cell text wraps vertically inside its fixed column width (no `numberOfLines`, never clipped).
- **The horizontal table `ScrollView` is nested inside the vertical reader `FlatList`** —
  orthogonal axes, which RN directional-locks natively; vertical document reading is unaffected.

## RTL / content direction

Table columns render in **document (parse) order regardless of the UI locale's direction** —
the parser carries no Word table-direction metadata, and forcing document content to follow the
chrome (e.g. reversing an English table under Arabic chrome) is the same thing the text reader
and run renderer deliberately avoid. The app chrome around the reader still follows the active
locale (RTL for Arabic).

## Storage / cleanup

Extracted images are written to `Paths.cache/librarySourceReaderDocxMedia/<sourceId>` — a
disposable cache directory the OS may purge, never a synced or durable location.
`clearDocxMediaDir(id)` runs on every reader load, so retries and re-opens never accumulate
stale copies. The DOCX reader creates no storage record and no sync entity.

## Error states

`ReaderStatus` covers `empty` (no readable content), `too-large` (`MAX_ARCHIVE_BYTES` /
`MAX_BLOCKS` / decoder failure), `unsupported` (encrypted/password-protected DOCX, or a
non-WordprocessingML archive renamed to `.docx`), and `failed` (malformed / non-ZIP), each with
its own copy. "Open original" remains available as the escape hatch.

## Tests

`npm run test:docx` — 11 `node --test` cases for the pure `computeDocxTableLayout` helper
(1 / 2 / 4 / 8+ columns, viewport narrower/wider than the natural table, exact-fit boundary,
zero/negative/non-finite inputs, custom minimum, fractional column counts). Zero added
dependencies. There is no automated coverage of the parser itself or of the RN rendering.

## Known limitations / future work

- Ordered-list numbering (numbering.xml) is not parsed — ordered lists render as bullets.
- No pagination, no exact fonts, no tracked-changes/comments rendering.
- No column-width fidelity to Word (deterministic mobile layout by design).
- No parser or rendering automated tests (only the table-layout helper).
- Legacy `.doc` (OLE2/CFB) is unsupported — "Open original" only.
