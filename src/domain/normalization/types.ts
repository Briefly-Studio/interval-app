import type { SourceType } from "../../models/librarySource";

// Source Normalization Foundation — the canonical, format-agnostic representation future AI
// features (deck generation, summaries, "ask this source", etc. — none implemented in this
// batch) will consume instead of each reimplementing "if pdf do this, if docx do that" logic.
// See docs/source-normalization-foundation.md for the full architecture writeup.
//
// Bumped whenever the normalization or segmentation ALGORITHM changes in a way that would
// produce different chunk boundaries/IDs/text for the same input — never bumped for something
// that doesn't affect output (a comment change, a refactor with identical behavior). Exists so a
// future cache or generation-provenance record can tell "this chunk was produced by an older
// algorithm" apart from "this chunk's source content actually changed" — see the Determinism
// section of the architecture doc.
export const NORMALIZATION_VERSION = 1;

// Deliberately NOT the same enum as SourceType/SourceFormatFamily (src/domain/librarySourceFormat.ts).
// A source's file format and its NORMALIZED content shape are different questions — a .txt and a
// future well-behaved .docx both ultimately produce prose text a future AI pipeline treats
// identically; overloading MIME/sourceType as the content-kind would leak format-specific
// branching right back into every future AI consumer, exactly what this foundation exists to
// prevent.
export type ContentKind =
  | "text" // flat prose/plain text, no reliable structural metadata beyond line breaks
  | "structured-text" // text with real structural context (headings, block types) from a format
  // that can actually provide it — reserved for a future DOCX/PDF-with-structure adapter; no
  // adapter in this batch produces this kind yet (see docx adapter boundary below)
  | "image" // no text content; metadata only
  | "audio" // no text content; metadata only
  | "unsupported"; // the source's format has no normalization path, now or in the deferred/pending sense

// Every state a normalization attempt can end in, returned explicitly rather than thrown — see
// NormalizationResult below. "pending-extraction" is distinct from "unsupported": it means the
// FORMAT could plausibly be normalized in the future (a real extraction capability is just not
// available in the currently integrated client-side stack today — e.g. PDF text extraction; see
// the architecture doc's PDF section for why), whereas "unsupported" means there is no content
// text to extract at all for this content kind (image, audio) by design in this batch.
export type ExtractionStatus = "ready" | "empty" | "unsupported" | "pending-extraction" | "too-large" | "failed";

/**
 * Where a chunk's text came from within the source. Every field is optional because different
 * formats supply different kinds of real location information — a field is populated ONLY when
 * the adapter that produced it can back it with a real value from actual extraction. Never
 * invented (e.g. a PDF page number is never fabricated when no page-aware extraction ran).
 */
export type ChunkProvenance = {
  /** 1-based page number — populated only by an adapter with genuine page-aware extraction. */
  page?: number;
  /** Half-open character offset range [start, end) into the adapter's own NORMALIZED text (after
   * line-ending normalization) — not the raw source bytes. Always populated for text-kind chunks. */
  charRange?: { start: number; end: number };
  /** 1-based, inclusive line range — populated whenever the source is meaningfully line-oriented. */
  lineRange?: { start: number; end: number };
  /** Index of the structural block (paragraph/heading/table row/etc.) a structured adapter
   * produced this chunk from — reserved for a future DOCX/PDF-with-structure adapter. */
  blockIndex?: number;
  /** Nearest enclosing heading text, when a structured adapter can supply one. */
  heading?: string;
  /** Reserved for a future audio-transcript adapter — millisecond timestamp range. Never
   * populated by anything in this batch (no transcription is implemented). */
  timeRangeMs?: { start: number; end: number };
};

export type NormalizedChunk = {
  /** Deterministic — a content-addressed fingerprint of (sourceId, normalizationVersion, index,
   * chunk text), never a random UUID. See chunking.ts's `computeChunkId`. Two normalization runs
   * over byte-identical source content always produce byte-identical chunk IDs; if the
   * underlying source content changes, IDs for the affected chunks change too (an intentional
   * property — a stable ID must mean stable CONTENT, not just stable position). */
  id: string;
  index: number;
  text: string;
  /** Character count of `text` — a provider-neutral size signal for a future LLM's own budget
   * accounting. Deliberately NOT a token count: this foundation names no tokenizer and no
   * provider (see docs). */
  approxSize: number;
  provenance: ChunkProvenance;
  /** Structural type hint from a future structured adapter ("heading" | "paragraph" | "listItem"
   * | "tableRow" | ...) — plain-text adapters never populate this; forcing TXT to invent
   * structure it doesn't have would misrepresent the source. */
  blockType?: string;
};

export type NormalizedSourceMetadata = {
  /** Size of the resolved source file actually read, in bytes. */
  byteSize?: number;
  /** Only populated by a format with real page semantics AND when it's actually known — never
   * inferred from file size or any other proxy. */
  pageCount?: number;
  /** Only from already-known source metadata (LibrarySourceRecord.audioDuration) — never derived
   * by decoding/probing audio content, which this batch does not do. */
  durationSeconds?: number;
  /** Reserved for a user-authored description/alt-text field if one is ever added to
   * LibrarySourceRecord — no such field exists on the model today (see src/models/librarySource.ts),
   * so no adapter in this batch populates this. Kept here, forward-compatible, so a future image
   * adapter can distinguish real user-authored description text from extracted content the moment
   * that field exists, without a type change. Never backfilled from `title`/`displayTitle` — a
   * source's display title is not its content, and treating it as one would misrepresent what was
   * actually extracted. */
  description?: string;
};

export type ExtractionInfo = {
  status: ExtractionStatus;
  /** Which adapter produced this result, and implicitly its behavior version — e.g. "text-v1",
   * "pdf-pending-v1", "image-metadata-v1", "audio-metadata-v1", "docx-pending-v1". Safe to log
   * (see privacy rules) since it names a code path, never source content. */
  adapter: string;
  /** A short, non-content diagnostic category — e.g. "invalid-utf8", "zero-length-source",
   * "exceeds-10mb-limit", "no-local-or-cloud-copy-available". NEVER a fragment of source text. */
  reason?: string;
};

export type NormalizedSourceContent = {
  sourceId: string;
  sourceType: SourceType;
  title: string;
  originalName?: string;
  /** Only ever copied from already-known source metadata (LibrarySourceRecord.sourceLanguage) —
   * this foundation performs no language detection of its own (see architecture doc). */
  language?: string;
  contentKind: ContentKind;
  chunks: NormalizedChunk[];
  metadata: NormalizedSourceMetadata;
  extraction: ExtractionInfo;
  normalizationVersion: number;
};

/**
 * The single return type `normalizeSource` produces. Deliberately a UNIFORM shape — every
 * terminal state (ready, no content, format not supported/pending, safety ceiling hit, or a
 * genuine failure) always carries a full `content: NormalizedSourceContent`, never a bare
 * reason-only object for some variants and a rich object for others. This means a caller can
 * always read `result.content.title`/`.metadata`/`.extraction` regardless of status — useful even
 * when there's no text (e.g. showing "Word documents aren't readable yet" alongside the source's
 * own title), and it means there is exactly one shape to destructure rather than a per-variant
 * narrowing dance. `status` mirrors `content.extraction.status` at the top level purely for
 * ergonomic switch/if dispatch. The "reason" on `content.extraction.reason` is a diagnostic
 * category only (see ExtractionInfo.reason) — never source content, safe to log.
 */
export type NormalizationResult = { status: ExtractionStatus; content: NormalizedSourceContent };
