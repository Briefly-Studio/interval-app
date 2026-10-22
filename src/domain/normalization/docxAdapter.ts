// DOCX adapter — see docs/source-normalization-foundation.md's "DOCX adapter boundary" section
// for the full history. The real WordprocessingML block parser (`src/domain/docxContent.ts`,
// `src/domain/sourceReaderDocx.ts`) was originally built on a separate branch for the DOCX
// *reader*; that branch merged into this codebase's history long ago (`docs/docx-reader.md`:
// "implemented and integrated into v3.2-dev"), so the parser is reused here as-is — no new DOCX
// parsing code exists in this file.
//
// This file does two things:
//   1. Defines the GENERIC shape a structured-block source (DOCX today; conceivably a future
//      structured PDF or any other format that can produce an ordered block list) needs to
//      satisfy to plug into normalization, plus `normalizeStructuredBlocks` — the actual,
//      reusable segmentation logic that turns such blocks into NormalizedChunks with real
//      block-level provenance. Format-agnostic; knows nothing about DOCX specifically.
//   2. `mapDocxBlocksToGenericBlocks` + `normalizeDocxSource` — the actual DOCX integration: reads
//      an already-in-memory DOCX archive via the existing `readDocxArchive` (reader-side code,
//      untouched), flattens each block's runs into plain text (formatting fidelity is a Reader
//      concern, not a normalization concern), and tracks the nearest enclosing heading for
//      provenance. Table rows become one chunk per row (cells joined with " | ") — an honest,
//      readable approximation, not a fabricated grid. Image blocks carry no text (no OCR; same
//      rule as imageAdapter.ts) but still occupy their place in document order.

import { computeChunkId } from "./chunking";
import { NORMALIZATION_VERSION, type ChunkProvenance, type NormalizedChunk, type NormalizedSourceContent } from "./types";
import type { DocxBlock, DocxRun } from "../docxContent";
import { readDocxArchive } from "../sourceReaderDocx";
import type { SourceType } from "../../models/librarySource";

export type GenericStructuralBlockType = "heading" | "paragraph" | "listItem" | "tableRow" | "image";

/** The minimal shape any future structured-document adapter (DOCX, or otherwise) needs to
 * produce per block — deliberately NOT `DocxBlock` itself, so this file has no dependency on,
 * and no risk of drifting from, the unmerged DOCX branch's own richer run-level (bold/italic)
 * model. A future integration flattens each block's runs into plain `text` here; formatting
 * fidelity is a Reader concern, not a normalization concern — future AI consumers need the
 * words, not the typography. */
export type GenericStructuralBlock = {
  type: GenericStructuralBlockType;
  /** Plain text content of this block. An "image" block typically has empty text — image blocks
   * carry no text in this batch (no OCR; see imageAdapter.ts's same rule). */
  text: string;
  /** Nearest enclosing heading text at the time this block was encountered, when the source
   * adapter tracks that (a future DOCX integration can derive this trivially by remembering the
   * last "heading" block seen during its own top-to-bottom parse). */
  heading?: string;
};

export type StructuredAdapterInput = {
  sourceId: string;
  sourceType: SourceType;
  title: string;
  originalName?: string;
  language?: string;
  byteSize?: number;
  blocks: GenericStructuralBlock[];
};

export type StructuredAdapterOutcome =
  | { status: "ready"; content: NormalizedSourceContent }
  | { status: "empty"; content: NormalizedSourceContent };

/**
 * Each non-empty block becomes exactly one chunk — block-level granularity (not the
 * paragraph-merging/character-window strategy `segmentText` uses for flat TXT) because a
 * structured source's own blocks are already real semantic units; further merging or splitting
 * them would discard structure a future AI feature could otherwise use (block type, heading
 * context). An oversized single block (e.g. one enormous paragraph) still gets its provenance and
 * id computed the same deterministic way as any other chunk — this function does not itself
 * impose a separate large-block safety ceiling; the caller (a future DOCX integration) is
 * expected to reuse its own already-established block-count ceiling before ever reaching here
 * (see feat/document-reader-docx's MAX_BLOCKS for that branch's own precedent).
 */
export function normalizeStructuredBlocks(input: StructuredAdapterInput): StructuredAdapterOutcome {
  const chunks: NormalizedChunk[] = [];
  let index = 0;
  for (const block of input.blocks) {
    const text = block.text;
    if (!text) continue;
    const provenance: ChunkProvenance = { blockIndex: index, heading: block.heading };
    chunks.push({
      id: computeChunkId(input.sourceId, index, text),
      index,
      text,
      approxSize: text.length,
      provenance,
      blockType: block.type,
    });
    index += 1;
  }

  const base = {
    sourceId: input.sourceId,
    sourceType: input.sourceType,
    title: input.title,
    originalName: input.originalName,
    language: input.language,
    contentKind: "structured-text" as const,
    metadata: { byteSize: input.byteSize },
    normalizationVersion: NORMALIZATION_VERSION,
  };

  if (chunks.length === 0) {
    return { status: "empty", content: { ...base, chunks: [], extraction: { status: "empty", adapter: "structured-blocks-v1" } } };
  }
  return { status: "ready", content: { ...base, chunks, extraction: { status: "ready", adapter: "structured-blocks-v1" } } };
}

// ---- DOCX integration ----

function flattenRuns(runs: DocxRun[]): string {
  return runs.map((run) => run.text).join("");
}

/**
 * Walks `DocxBlock[]` top-to-bottom (the parser's own document order — never reordered) and
 * tracks the nearest heading seen so far, exactly the way docxContent.ts's own header comment
 * anticipates a future integration doing ("remembering the last 'heading' block seen"). A table
 * row's cells are joined with " | " — readable, honest about being a row of cells, never
 * presented as a precise grid. An "image" block contributes an empty-text placeholder (skipped by
 * `normalizeStructuredBlocks`, which drops any block whose text is falsy) — document position is
 * otherwise irrelevant once there is no text to chunk.
 */
export function mapDocxBlocksToGenericBlocks(blocks: DocxBlock[]): GenericStructuralBlock[] {
  const generic: GenericStructuralBlock[] = [];
  let currentHeading: string | undefined;

  for (const block of blocks) {
    if (block.kind === "heading") {
      const text = flattenRuns(block.runs);
      if (text) currentHeading = text;
      generic.push({ type: "heading", text, heading: currentHeading });
      continue;
    }
    if (block.kind === "paragraph") {
      generic.push({ type: "paragraph", text: flattenRuns(block.runs), heading: currentHeading });
      continue;
    }
    if (block.kind === "listItem") {
      generic.push({ type: "listItem", text: flattenRuns(block.runs), heading: currentHeading });
      continue;
    }
    if (block.kind === "tableRow") {
      generic.push({ type: "tableRow", text: block.cells.map((cell) => flattenRuns(cell)).join(" | "), heading: currentHeading });
      continue;
    }
    // "image" — never carries text in this batch (no OCR; see imageAdapter.ts's same rule).
    generic.push({ type: "image", text: "", heading: currentHeading });
  }

  return generic;
}

export type DocxAdapterInput = {
  sourceId: string;
  sourceType: SourceType;
  title: string;
  originalName?: string;
  language?: string;
  byteSize?: number;
  /** The already-read, in-memory DOCX archive — the caller (normalizeSource.ts) is responsible
   * for local-first/cloud-fallback resolution and the actual byte read, exactly like every other
   * adapter that touches the filesystem (see pdfAdapter.ts/textAdapter.ts for the same split). */
  archiveBytes: Uint8Array;
};

export type DocxAdapterOutcome =
  | { status: "ready"; content: NormalizedSourceContent }
  | { status: "empty"; content: NormalizedSourceContent }
  | { status: "too-large" }
  // A valid ZIP that isn't a WordprocessingML package — most commonly an encrypted/password-
  // protected DOCX (OOXML encryption wraps the package in a non-ZIP CFB/OLE2 container entirely,
  // so it never even reaches word/document.xml), or a file renamed to .docx that isn't one.
  // Deliberately distinct from "failed" at this layer, mirroring readDocxArchive's own framing —
  // normalizeSource.ts decides how to map this onto the smaller Generate Study Deck vocabulary.
  | { status: "unsupported" }
  | { status: "failed" };

/**
 * Pure (aside from zero network/filesystem access — `archiveBytes` is already in memory):
 * `readDocxArchive` → `mapDocxBlocksToGenericBlocks` → `normalizeStructuredBlocks`. Deterministic:
 * identical bytes always produce identical chunks/ids, same guarantee every other adapter makes.
 */
export function normalizeDocxSource(input: DocxAdapterInput): DocxAdapterOutcome {
  const read = readDocxArchive(input.archiveBytes);

  if (read.status === "too-large" || read.status === "unsupported" || read.status === "failed") {
    return { status: read.status };
  }

  if (read.status === "empty") {
    return {
      status: "empty",
      content: {
        sourceId: input.sourceId,
        sourceType: input.sourceType,
        title: input.title,
        originalName: input.originalName,
        language: input.language,
        contentKind: "structured-text",
        chunks: [],
        metadata: { byteSize: input.byteSize },
        extraction: { status: "empty", adapter: "docx-structured-v1" },
        normalizationVersion: NORMALIZATION_VERSION,
      },
    };
  }

  // read.status === "ready"
  const structured = normalizeStructuredBlocks({
    sourceId: input.sourceId,
    sourceType: input.sourceType,
    title: input.title,
    originalName: input.originalName,
    language: input.language,
    byteSize: input.byteSize,
    blocks: mapDocxBlocksToGenericBlocks(read.blocks),
  });

  // Every block had empty text (e.g. an image-only DOCX) — real content, but nothing to chunk.
  // `structured.content.extraction.adapter` reads "structured-blocks-v1" (the generic chunker
  // that actually produced it) rather than a DOCX-specific name — truthful about which code ran.
  return structured;
}
