import { NORMALIZATION_VERSION, type ChunkProvenance, type NormalizedChunk } from "./types";

// Provider-neutral text segmentation — deliberately names no LLM/tokenizer/provider anywhere in
// this file (see docs/source-normalization-foundation.md's "Provider neutrality" section). Chunk
// size is measured in JS string character count only, never a provider-specific token count.
//
// Strategy: paragraph-first, so a chunk boundary lands on a real semantic break whenever
// possible, with two safeguards against the two failure modes explicitly called out in the
// mission — "do not create giant arbitrary chunks" and "do not create a million tiny chunks":
//   1. Consecutive short paragraphs are greedily merged into one chunk up to `targetChars`, so a
//      document made of many short paragraphs doesn't produce one chunk per paragraph.
//   2. A single paragraph longer than `maxChars` is split into bounded, overlapping windows
//      (never producing an unbounded single chunk), snapped to the nearest whitespace boundary
//      within a small lookback window when one exists, and never splitting a UTF-16 surrogate
//      pair (see `safeBoundary` below) — this matters for any character outside the Unicode BMP,
//      including a meaningful share of emoji.
//
// Overlap is applied ONLY at that bounded-window fallback (not between merged-paragraph chunks,
// whose boundaries are already real semantic breaks and don't need it) — see `DEFAULT_CHUNK_OVERLAP_CHARS`.

export const DEFAULT_CHUNK_TARGET_CHARS = 2000;
export const DEFAULT_CHUNK_MAX_CHARS = 3000;
export const DEFAULT_CHUNK_OVERLAP_CHARS = 200;

// Defense-in-depth ceiling — not a normally-reachable product limit (the byte-size ceiling in
// textAdapter.ts already bounds chunk count to roughly sourceBytes / targetChars in normal
// operation). This exists to fail loudly on a genuine algorithmic anomaly (e.g. a future edit
// that accidentally collapses effective chunk size toward zero) rather than let normalization
// silently run away. See callers for how this maps to a `too-large` NormalizationResult.
export const MAX_CHUNKS = 5000;

export type ChunkingOptions = {
  targetChars?: number;
  maxChars?: number;
  overlapChars?: number;
};

/**
 * Content-addressed, deterministic chunk id — a fingerprint of (sourceId, normalizationVersion,
 * index, the chunk's own text), never a random UUID. Identical source content always produces
 * identical ids across separate normalization runs; if the underlying text at a given index ever
 * changes, its id changes too, which is intentional (a stable id must mean stable CONTENT).
 * FNV-1a 32-bit — fast, deterministic, pure JS, no crypto dependency needed for a non-security
 * fingerprint like this.
 */
export function computeChunkId(sourceId: string, index: number, text: string, normalizationVersion = NORMALIZATION_VERSION): string {
  const input = `${sourceId}|v${normalizationVersion}|${index}|${text}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `chunk_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

// Never split a UTF-16 surrogate pair: if `index` lands between a high surrogate (0xD800-0xDBFF)
// at index-1 and its low surrogate (0xDC00-0xDFFF) at index, nudge the boundary forward by one
// code unit so the pair stays together. This is the one adjustment ever made to a computed
// boundary purely for Unicode correctness — it never drops or duplicates a code unit.
function safeBoundary(text: string, index: number): number {
  if (index <= 0 || index >= text.length) return index;
  const before = text.charCodeAt(index - 1);
  const at = text.charCodeAt(index);
  if (before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff) return index + 1;
  return index;
}

// Prefers cutting at whitespace within a small lookback window so a bounded-window split doesn't
// land mid-word when it doesn't have to — a readability nicety, not a correctness requirement.
function preferWhitespaceBoundary(text: string, target: number, minBoundary: number): number {
  const lookback = Math.min(80, target - minBoundary);
  for (let i = 0; i < lookback; i++) {
    const candidate = target - i;
    if (candidate <= minBoundary) break;
    if (/\s/.test(text[candidate - 1] ?? "")) return safeBoundary(text, candidate);
  }
  return safeBoundary(text, target);
}

type RawSegment = { text: string; start: number; end: number; fromWindowSplit?: boolean };

/**
 * Splits `text` into paragraph-anchored segments on one-or-more blank lines. Segments are
 * CONTIGUOUS and gapless by construction — each segment's `end` extends through the blank-line
 * separator up to the start of the next paragraph's actual content (or `text.length` for the
 * last one), so `segments[i].end === segments[i + 1].start` always holds and the full union of
 * segment ranges covers `[0, text.length)` exactly. This is what makes the "no content silently
 * dropped" guarantee true at the chunk level, not just at the paragraph level — a chunk's trailing
 * blank-line whitespace being included in its own text is a harmless cosmetic detail, never lost
 * content.
 */
function splitParagraphs(text: string): RawSegment[] {
  if (text.length === 0) return [];
  const contentStarts: number[] = [0];
  const boundaryRe = /\n[ \t]*\n+/g;
  let match: RegExpExecArray | null;
  while ((match = boundaryRe.exec(text))) {
    const nextContentStart = match.index + match[0].length;
    if (nextContentStart < text.length) contentStarts.push(nextContentStart);
  }
  const segments: RawSegment[] = [];
  for (let i = 0; i < contentStarts.length; i++) {
    const start = contentStarts[i];
    const end = i + 1 < contentStarts.length ? contentStarts[i + 1] : text.length;
    segments.push({ text: text.slice(start, end), start, end });
  }
  return segments;
}

/** Splits one oversized paragraph into bounded, overlapping windows. Every window's bounds are
 * surrogate-pair-safe; consecutive windows overlap by `overlapChars` so a future LLM reading two
 * adjacent chunks retains local context across the cut. */
function windowSplit(segment: RawSegment, targetChars: number, overlapChars: number): RawSegment[] {
  const out: RawSegment[] = [];
  let start = segment.start;
  while (start < segment.end) {
    const rawEnd = Math.min(start + targetChars, segment.end);
    const end = rawEnd >= segment.end ? segment.end : preferWhitespaceBoundary(segment.text, rawEnd - segment.start, start - segment.start) + segment.start;
    const clampedEnd = Math.max(end, safeBoundary(segment.text, start - segment.start + 1) + segment.start);
    out.push({ text: segment.text.slice(start - segment.start, clampedEnd - segment.start), start, end: clampedEnd, fromWindowSplit: true });
    if (clampedEnd >= segment.end) break;
    start = safeBoundary(segment.text, clampedEnd - overlapChars - segment.start) + segment.start;
    if (start <= out[out.length - 1].start) start = clampedEnd; // guard against zero/negative progress
  }
  return out;
}

/** Builds line-start offsets once for the whole text so per-chunk line-range lookup is a binary
 * search, not a rescan. `text` must already have normalized (LF-only) line endings. */
function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineRangeFor(lineStarts: number[], start: number, end: number): { start: number; end: number } {
  // Binary search for the last line-start <= offset.
  const findLine = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1; // 1-based line number
  };
  const endLineOffset = end > start ? end - 1 : end;
  return { start: findLine(start), end: findLine(endLineOffset) };
}

/**
 * Segments already-normalized text (LF-only line endings) into deterministic, provenance-carrying
 * chunks. Guarantees every character offset in `[0, text.length)` is covered by at least one
 * chunk's `charRange` (no silently dropped content) — verified by this module's own test suite.
 * Returns `{ truncated: true }` if the segmentation would exceed `MAX_CHUNKS` — the caller (see
 * textAdapter.ts) turns that into an explicit `too-large` NormalizationResult, never a silently
 * partial chunk list.
 */
export function segmentText(
  sourceId: string,
  text: string,
  options: ChunkingOptions = {}
): { chunks: NormalizedChunk[]; truncated: boolean } {
  const targetChars = options.targetChars ?? DEFAULT_CHUNK_TARGET_CHARS;
  const maxChars = options.maxChars ?? DEFAULT_CHUNK_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_CHUNK_OVERLAP_CHARS;

  if (text.length === 0) return { chunks: [], truncated: false };

  const paragraphs = splitParagraphs(text);
  const lineStarts = buildLineStarts(text);

  // Pass 1: expand any paragraph longer than maxChars into bounded windows; keep short
  // paragraphs as their own segment for the merge pass below.
  const segments: RawSegment[] = [];
  for (const para of paragraphs) {
    if (para.text.length > maxChars) segments.push(...windowSplit(para, targetChars, overlapChars));
    else segments.push(para);
  }

  // Pass 2: greedily merge consecutive short-paragraph segments up to targetChars, so many short
  // paragraphs become one reasonably-sized chunk instead of many tiny ones. A segment produced by
  // windowSplit above is passed through untouched — it's already a deliberately-sized,
  // overlap-bearing window from an oversized paragraph, and merging it with a neighbor would
  // either erase its intentional overlap or exceed maxChars.
  const merged: RawSegment[] = [];
  let bufferStart = -1;
  let bufferEnd = -1;
  const flush = () => {
    if (bufferStart >= 0) merged.push({ text: text.slice(bufferStart, bufferEnd), start: bufferStart, end: bufferEnd });
    bufferStart = -1;
    bufferEnd = -1;
  };
  for (const seg of segments) {
    if (seg.fromWindowSplit) {
      flush();
      merged.push(seg);
      continue;
    }
    if (bufferStart < 0) {
      bufferStart = seg.start;
      bufferEnd = seg.end;
      continue;
    }
    if (seg.end - bufferStart <= targetChars) {
      bufferEnd = seg.end;
    } else {
      flush();
      bufferStart = seg.start;
      bufferEnd = seg.end;
    }
  }
  flush();

  if (merged.length > MAX_CHUNKS) return { chunks: [], truncated: true };

  const chunks: NormalizedChunk[] = merged.map((seg, index) => {
    const chunkText = seg.text;
    const provenance: ChunkProvenance = {
      charRange: { start: seg.start, end: seg.end },
      lineRange: lineRangeFor(lineStarts, seg.start, seg.end),
    };
    return {
      id: computeChunkId(sourceId, index, chunkText),
      index,
      text: chunkText,
      approxSize: chunkText.length,
      provenance,
    };
  });

  return { chunks, truncated: false };
}
