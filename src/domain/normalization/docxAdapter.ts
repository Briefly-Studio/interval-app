// DOCX adapter BOUNDARY only — see docs/source-normalization-foundation.md's "DOCX adapter
// boundary" section. `feat/document-reader-docx` (a separate, unmerged feature branch) already
// implements a real WordprocessingML block parser (`src/domain/docxContent.ts` on that branch),
// but per this mission's explicit governance that branch/worktree must not be touched, cherry-
// picked, or duplicated here. This file defines the GENERIC shape a structured-block source
// (DOCX today; conceivably a future structured PDF or any other format that can produce an
// ordered block list) would need to satisfy to plug into normalization — plus the actual,
// reusable segmentation logic that turns such blocks into NormalizedChunks with real block-level
// provenance. Nothing in this file parses any document format; `normalizeStructuredBlocks` below
// is called with ALREADY-EXTRACTED blocks.
//
// Once the DOCX branch integrates, its own `DocxBlock[]` (headings/paragraphs/list items/table
// rows/images) can be mapped to `GenericStructuredBlock[]` in a few lines and passed straight
// into `normalizeStructuredBlocks` — no speculative DOCX-specific parsing exists here to
// duplicate or drift from that branch's real implementation.

import { computeChunkId } from "./chunking";
import { NORMALIZATION_VERSION, type ChunkProvenance, type NormalizedChunk, type NormalizedSourceContent } from "./types";
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
