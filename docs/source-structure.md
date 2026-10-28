# Source Structure foundation

Source structure is optional, reconstructable metadata over normalized chunks. It represents
only evidence actually provided by the file/parser. It never detects chapters from capital
letters, font sizes, blank lines, a “Chapter” regex, or AI. An empty node list is an honest result.
Source-provided titles are source text, not translated UI labels.

## Preflight and per-format capabilities

| Format | Existing evidence | Foundation behavior |
| --- | --- | --- |
| DOCX | Reader parser recognizes paragraph `w:pStyle` IDs `Heading1`–`Heading3` (case insensitive), exposing level 1–3. Normalization retained heading text/block type but dropped level. | Preserve that level and derive heading intervals/hierarchy. |
| PDF | `expo-pdf-text-extract` 1.1.0 exposes text, per-page text, page counts and password APIs. Neither its JS bridge nor its installed iOS/Android bridge exposes bookmarks/outlines. | No semantic nodes. Existing real page ranges remain separate. |
| XLSX | SpreadsheetML reader already parsed stored names and workbook relationships in tab order, but discarded identity after rendering flat text. | Keep real worksheet identity/visibility, empty sheets and rendered-text intervals. |
| TXT | Real text, character/line positions and generic normalized chunk order. | No semantic nodes, even for chapter-like text. |
| Other formats | No supported structural extraction. | No semantic nodes. |

PDFKit/PDFBox capabilities underneath a native module are not automatically accessible from JS.
Adding PDF outline support requires a deliberately reviewed bridge/extractor capability, including
real destinations and nesting; no new native dependency or fake outline was added. No PDF outline
fixture can exercise an unavailable API. Page-aware adapter tests prove pages are not chapters.

DOCX `styles.xml`, custom/inherited/localized style definitions, explicit outline levels, headings
4–9 and headings embedded inside tables are not resolved by the current reader parser. Bold or
large text is not heading evidence. This foundation preserves the parser's supported semantics;
it does not change the reader or claim comprehensive Word outline fidelity.

## Domain API and model

`src/domain/sourceStructure.ts` exports:

```ts
extractSourceStructure(content: NormalizedSourceContent): SourceStructure
resolveStructureNodeChunks(content, structure, nodeId): StructureSelection
buildStructureBreadcrumbNodes(structure, nodeId): SourceStructureNode[] // root-first ancestor
                                                                        // chain, including nodeId

SourceStructure {
  sourceId: string
  normalizationVersion: number
  nodes: SourceStructureNode[]
  warnings: SourceStructureWarning[]
}
SourceStructureNode {
  id: string
  type: "heading" | "worksheet"
  title: string
  level?: number
  parentId?: string
  order: number               // zero-based source order
  chunkIds: string[]          // existing normalized IDs, in source order
  worksheet?: { sheetName, sheetIndex, visibility }
}
```

The API consumes an already-normalized result: no second ZIP/file parse, download, normalization,
provider call or render-time side effect. It does not replace chunks or duplicate their text.
Nodes carry IDs, bounded titles and provenance metadata. No speculative `chapter` node type or
PDF outline shape is exposed before an adapter can actually produce it.

```ts
const result = await normalizeSource(source); // existing file resolution and extraction
const structure = extractSourceStructure(result.content);
const node = structure.nodes[0];
if (node) {
  const selection = resolveStructureNodeChunks(result.content, structure, node.id);
  // Handle stale/empty results and worksheet overlap before presenting a scope promise.
}
```

There is no structure persistence, sync entity, independent structure version, or new cache.
Consumers should retain/reuse their existing normalized result while needed. Source Detail was
not changed: adding a read-only outline would require loading and maintaining another view of
normalization there. This batch supplies APIs/tests without UI churn or new localization keys.

## DOCX heading intervals

A heading node includes its own nonempty heading chunk and all following chunks up to the next
heading of the same or shallower level. H1 includes its H2/H3 descendants. A leaf selection is the
same deterministic interval. Repeated titles retain their actual names, with distinct IDs from
order/content. A heading followed immediately by a peer contains its own heading chunk only.
Preamble text gets no invented section. An empty-text heading produces no normalized chunk and
therefore no node; this preserves existing text/chunk identity.

`ChunkProvenance.headingLevel` is additive and is supplied on real heading chunks. Existing
`heading` remains the nearest preceding heading label, not a unique section identifier. Extraction
uses `blockType === "heading"` and chunk text, never groups equal heading strings together. If a
structured adapter has heading text/type without complete valid levels, all its heading nodes
remain flat. Invalid levels yield a nonfatal warning; hierarchy is never guessed.

## XLSX worksheet identity and boundaries

`NormalizedSourceMetadata.worksheets` retains stored sheet names, 1-based workbook tab index,
visibility (`visible`, `hidden`, `veryHidden`) and half-open `charRange` in the existing rendered
workbook text. Empty sheets have no text range and an empty `chunkIds` node, even when the entire
workbook has no cell text. No default name is invented. Unicode and spaces are preserved; titles
are bounded only for optional structure/provenance metadata.

Hidden and veryHidden sheets remain included, matching the preexisting extraction policy.
Their visibility is now explicit. No source pages or real Excel row coordinates are invented.
The rendered “Row N” labels still refer to nonempty extracted rows, not physical worksheet rows.

The adapter validates workbook metadata, follows actual package-local worksheet relationships
and maintains workbook order independently of ZIP order, sheetId or filename numbering. It accepts
relative `worksheets/name.xml`, `./worksheets/name.xml`, and package-absolute
`/xl/worksheets/name.xml` destinations to allow-listed worksheet XML parts. It does not follow
external relationships, directory traversal, encoded paths, cycles, or guessed basenames.
Relationship IDs with multiple definitions are rejected. Aliased parts and malformed duplicate
sheet names cannot produce trustworthy identity nodes. The supported relationship attribute is
`r:id`; arbitrary namespace-prefix aliases are not resolved in this small parser.

Text rendering and `segmentText()` are unchanged for previously supported valid files. A chunk
can therefore cross a worksheet boundary. `ChunkProvenance.worksheets[]` contains every known
sheet whose real text interval intersects that chunk; each worksheet node references those same
chunk IDs. **A shared chunk may include text from another worksheet.** The extraction warning
`shared-worksheet-chunks` and resolver's `sharedWithOtherNodes` disclose this. This foundation
must not be presented as exclusive worksheet generation. A future picker must inspect warnings,
reject/clearly explain coarse boundaries, or separately approve a normalization migration before
promising exclusive sheet text. Missing metadata warnings can also mean a chunk includes material
whose worksheet identity could not be recovered; absence of the shared flag alone is not proof
of exclusivity. No chunk splitting or text duplication was introduced to hide this limitation.

## Identity, compatibility and source changes

`NORMALIZATION_VERSION` stays **1**. `computeChunkId` hashes source ID, normalization version,
chunk index and text; it does not hash provenance/metadata. DOCX adds level provenance without
changing chunk text/order. XLSX preserves the rendered text, chunk boundaries and IDs for existing
supported valid files. Therefore current saved-card provenance and Source Coverage references
remain valid; no migration or fuzzy remapping is necessary. Strict relationship validation can
intentionally reject malformed/unsafe inputs the old parser guessed from a basename. Newly
supported custom worksheet filenames/attribute spacing can expose content previously unavailable.

Node IDs use the existing deterministic non-security fingerprint primitive with a `structure_`
prefix and include source ID, normalization version, order, type, original heading title,
level/parent identity, worksheet identity and resolved chunk IDs. They are stable for unchanged
normalized content/structure; duplicate titles are distinct by order. Metadata titles that exceed
the limit are bounded and flagged, including worksheet identity labels. IDs are not cryptographic
integrity tokens. A normalization-version change changes IDs even if text stays the same.

A source replacement/content edit follows the existing file resolution/re-normalization path.
Node IDs may change as intervals, titles, parent relationships or chunk content change. The node
resolver checks source/version and derives the current node to reject stale snapshots; it returns
`stale-structure`, `node-not-found` or `empty-node` as appropriate. It does not map old sections to
new ones. An app-held normalized result is a snapshot: callers must re-normalize after source
replacement and bind it to the current workspace themselves, as existing generation already does.

## Limits, malformed input and warnings

`SOURCE_STRUCTURE_LIMITS` centralizes **1,000 nodes**, **256 UTF-16 units per title** (never split
a surrogate pair), and **9 heading levels**. DOCX currently supplies at most three real levels.
Derivation bounds chunk input at the existing 5,000-chunk ceiling. Even when later nodes are
omitted, their boundaries still close retained heading ranges correctly. Blank titles are omitted.

`WORKBOOK_METADATA_LIMITS` bounds metadata XML to 1 MiB, 10,000 elements and depth 16. The metadata
scanner checks balanced XML, duplicate attributes, entities and direct structural paths; comments
cannot fabricate sheets. It does not support DTDs/entities or external I/O. ZIP allow-lists and
pre-inflation limits remain in the adapter; worksheet inflation additionally has a cumulative
30 MiB / 50-part ceiling, avoiding an unbounded number of individually acceptable parts. Existing
per-sheet cell/row and total-row limits still govern text extraction.

Warnings are bounded category values, never raw parser errors or source text:

- `structure-truncated`: title/node/optional-metadata output exceeded its bound.
- `malformed-structure`: invalid level, title or worksheet interval/identity was omitted/degraded.
- `workbook-sheet-metadata-unavailable`: optional identities, relationships or parts unavailable.
- `shared-worksheet-chunks`: at least one retained chunk belongs to multiple worksheet nodes.

Optional malformed workbook identity metadata does not fail otherwise safely extracted text:
it returns text plus warnings/no invented identities. Unsafe/unresolvable relationships are not
followed, so those parts cannot safely contribute text. A genuine text/archive extraction ceiling
can still return the existing `too-large` result. Warnings are domain diagnostics; no developer
jargon or raw errors are newly rendered to users.

## Generation scope integration

**Implemented (Structured Generation Scope batch)** — see `docs/source-generation-scope.md`'s
"Structure-aware scope" section for the full design. `SourceGenerationScope` gained a
`{ type: "structureNode", nodeId, structureSnapshot }` variant; `resolveSourceGenerationScope`'s
new case delegates entirely to `resolveStructureNodeChunks` (mapping its three error codes 1:1)
and feeds the resolved chunk IDs into the EXISTING `selectedChunkIds`/batch-planner seam with zero
changes to batching, the prompt, the provider, or quotas. `buildStructureBreadcrumbNodes` (added
alongside) gives the picker/accessibility layer a node's real root-first ancestor chain for
disambiguation and announcement — it never alters a node's own `title`.

Coverage remains live saved-card provenance over normalized chunk IDs. Processing a heading or
worksheet does not mark it covered. Future coverage-by-node can intersect its chunk IDs with the
existing covered set without adding counters now. Shared XLSX chunks make that a coarse view.
Future stale-area tools may use the same mapping; no stale-card detection, fuzzy reconciliation,
structure sync or new persistence was built here.

## Tests and Founder QA

`npm run test:structure` runs generated, minimal DOCX/XLSX ZIP/XML fixtures and domain tests. The
same tests are included by `test:ai`. Fixtures contain only original synthetic strings, not
copyrighted documents. They cover actual style hierarchy/closure, repeated/Unicode headings,
no-heading text, node identity/version/limits, worksheets/order/relationships/visibility/empty
sheets, overlap disclosure, malformed input, and no fake TXT/PDF chapters. The normal adapters'
existing parser suites also run. No extra dependency or runtime debug override was added.

Device/API checklist — a structure picker now exists in Generate Study Deck's options screen
(`docs/source-generation-scope.md`'s "Structure-aware scope" section); this checklist still
covers the domain layer first, then the picker itself:

1. DOCX with Heading1/Heading2/Heading3: inspect extracted nodes/order/parent IDs and selection
   intervals. Repeat an “Introduction” title, use Arabic/Unicode, and put a heading immediately
   before another heading. Plain/bold/capitalized text with no styles should yield no nodes.
2. XLSX with “Q4 Revenue”, a Unicode name, hidden/veryHidden sheets and an empty sheet: inspect
   stored names, workbook order, visibility and empty-node behavior. Verify small sheets sharing
   one chunk expose the overlap warning; do not claim exclusive worksheet selection.
3. PDF with bookmarks and PDF without: current extraction yields no semantic nodes in both;
   real page-range generation remains available. No fake chapter UI appears.
4. TXT containing “CHAPTER 1”/uppercase/blank lines: no semantic nodes, generic ranges unchanged.
5. Generate normally from supported nonempty sources using Automatic/Entire/Uncovered/page and
   generic section ranges; save cards and verify unchanged Source Coverage. Empty-only workbooks
   still have no generatable text. No AI prompt/model quality change is expected.
6. Delete/archive/restore sources and replace/re-normalize content: no structure persistence to
   clean up, and old node snapshots must be rejected against changed current content.
7. Arabic source titles remain source text, pinned LTR within an RTL layout exactly like every
   other source-provided string; the surrounding chrome (labels, hints, breadcrumbs, counts)
   follows the active locale and mirrors for RTL. On the real device: open a DOCX with nested
   headings and an XLSX with multiple worksheets in Generate Study Deck, confirm the "Document
   section"/"Worksheet" choice appears, the picker shows real indentation/breadcrumb
   disambiguation for a repeated title, an empty node renders disabled (never hidden) with
   VoiceOver/TalkBack announcing "no content" rather than just silence, re-attaching a changed
   file after picking a node surfaces the "document changed" recovery copy (never a silent
   fallback to Automatic), and the pre-generation summary/plan dialog name the picked
   section/worksheet. Native runtime QA is still pending.
