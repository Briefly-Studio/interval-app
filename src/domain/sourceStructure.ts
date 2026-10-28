import { computeChunkId, MAX_CHUNKS } from "./normalization/chunking";
import type { NormalizedSourceContent } from "./normalization/types";

export const SOURCE_STRUCTURE_LIMITS = { maxNodes: 1000, maxTitleLength: 256, maxDepth: 9 } as const;
export type SourceStructureWarning = "structure-truncated" | "malformed-structure" | "workbook-sheet-metadata-unavailable" | "shared-worksheet-chunks";
export type WorksheetIdentity = { sheetName: string; sheetIndex: number; visibility: "visible" | "hidden" | "veryHidden" };
/** Coordinates in the adapter's existing rendered workbook text, never Excel row/page numbers.
 * Empty sheets have no text range, but retain their real identity. */
export type WorksheetStructureMetadata = WorksheetIdentity & { charRange?: { start: number; end: number } };
export type SourceStructureNode = {
  id: string;
  type: "heading" | "worksheet";
  title: string;
  level?: number;
  parentId?: string;
  order: number;
  chunkIds: string[];
  worksheet?: WorksheetIdentity;
};
export type SourceStructure = { sourceId: string; normalizationVersion: number; nodes: SourceStructureNode[]; warnings: SourceStructureWarning[] };

/** Bounded UTF-16 display text; never cuts a surrogate pair or invents a replacement title. */
export function boundStructureTitle(title: string): string {
  const limit = SOURCE_STRUCTURE_LIMITS.maxTitleLength;
  const cut = title.charCodeAt(limit - 1);
  return title.slice(0, cut >= 0xd800 && cut <= 0xdbff ? limit - 1 : limit);
}

/** Pure view over one already-normalized result. No I/O, parsing, persistence or AI calls. */
export function extractSourceStructure(content: NormalizedSourceContent): SourceStructure {
  const warnings = new Set<SourceStructureWarning>(content.metadata.structureWarnings ?? []);
  const chunks = content.chunks.slice(0, MAX_CHUNKS);
  if (content.chunks.length > MAX_CHUNKS) warnings.add("structure-truncated");
  const nodes: SourceStructureNode[] = [];
  function addNode(node: Omit<SourceStructureNode, "id" | "order">): SourceStructureNode | undefined {
    if (nodes.length >= SOURCE_STRUCTURE_LIMITS.maxNodes) { warnings.add("structure-truncated"); return; }
    if (typeof node.title !== "string" || !node.title.trim()) { warnings.add("malformed-structure"); return; }
    const title = boundStructureTitle(node.title);
    if (title !== node.title) warnings.add("structure-truncated");
    const order = nodes.length;
    const id = computeChunkId(content.sourceId, order, JSON.stringify(node), content.normalizationVersion).replace("chunk_", "structure_");
    const result = { ...node, title, id, order };
    nodes.push(result);
    return result;
  }

  if (content.sourceType === "docx") {
    const headings = chunks.flatMap((chunk, index) => chunk.blockType === "heading" ? [{ index, title: chunk.text, level: chunk.provenance.headingLevel }] : []);
    // Unknown/invalid levels retain flat headings. Never infer a hierarchy from typography/text.
    const hierarchical = headings.every(h => Number.isInteger(h.level) && h.level! >= 1 && h.level! <= SOURCE_STRUCTURE_LIMITS.maxDepth);
    if (headings.some(h => h.level !== undefined && (!Number.isInteger(h.level) || h.level < 1 || h.level > SOURCE_STRUCTURE_LIMITS.maxDepth))) warnings.add("malformed-structure");
    const ends = headings.map(() => chunks.length);
    const open: number[] = [];
    for (let i = 0; i < headings.length; i++) {
      while (open.length && (!hierarchical || headings[open[open.length - 1]].level! >= headings[i].level!)) ends[open.pop()!] = headings[i].index;
      open.push(i);
    }
    const parents: { level: number; id: string }[] = [];
    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      if (hierarchical) while (parents.length && parents[parents.length - 1].level >= heading.level!) parents.pop();
      const node = addNode({ type: "heading", title: heading.title,
        ...(hierarchical ? { level: heading.level, ...(parents.length ? { parentId: parents[parents.length - 1].id } : {}) } : {}),
        chunkIds: chunks.slice(heading.index, ends[i]).map(c => c.id) });
      if (node && hierarchical) parents.push({ level: heading.level!, id: node.id });
    }
  } else if (content.sourceType === "xlsx") {
    const sheets = content.metadata.worksheets ?? [];
    const usedIndexes = new Set<number>();
    const membership = new Map<string, number>();
    for (const sheet of sheets.slice(0, SOURCE_STRUCTURE_LIMITS.maxNodes)) {
      if (!sheet || typeof sheet.sheetName !== "string" || !sheet.sheetName.trim() || !Number.isInteger(sheet.sheetIndex) || sheet.sheetIndex < 1 || usedIndexes.has(sheet.sheetIndex)
        || !["visible", "hidden", "veryHidden"].includes(sheet.visibility)
        || (sheet.charRange && (!Number.isInteger(sheet.charRange.start) || !Number.isInteger(sheet.charRange.end) || sheet.charRange.start < 0 || sheet.charRange.end <= sheet.charRange.start))) {
        warnings.add("malformed-structure"); continue;
      }
      usedIndexes.add(sheet.sheetIndex);
      const chunkIds = chunks.filter(c => {
        const range = c.provenance.charRange;
        return sheet.charRange && range && range.start < sheet.charRange.end && range.end > sheet.charRange.start;
      }).map(c => c.id);
      const node = addNode({ type: "worksheet", title: sheet.sheetName, worksheet: { sheetName: boundStructureTitle(sheet.sheetName), sheetIndex: sheet.sheetIndex, visibility: sheet.visibility }, chunkIds });
      if (node) for (const id of chunkIds) membership.set(id, (membership.get(id) ?? 0) + 1);
    }
    if (sheets.length > SOURCE_STRUCTURE_LIMITS.maxNodes) warnings.add("structure-truncated");
    if ([...membership.values()].some(count => count > 1)) warnings.add("shared-worksheet-chunks");
  }
  // TXT has no semantic evidence; the current PDF extractor exposes no outlines. Pages stay a
  // separate scope construct. Other unsupported formats also return an honest empty node list.
  return { sourceId: content.sourceId, normalizationVersion: content.normalizationVersion, nodes, warnings: [...warnings] };
}

/**
 * The ordered ancestor chain for `nodeId`, root-first, INCLUDING the node itself — e.g. for a
 * "EC2" node nested under "AWS", returns `[AWS, EC2]`. Pure, deterministic, bounded by
 * `SOURCE_STRUCTURE_LIMITS.maxDepth`. Used to disambiguate same-titled nodes in the picker/
 * preflight/accessibility labels (see docs/source-generation-scope.md's "Structure breadcrumbs"
 * section) — never used to alter the actual node's own `title`, which stays source text,
 * untouched, always. Returns `[]` for an unknown `nodeId` (never throws) and is defensively
 * cycle-safe (a cycle cannot occur given how `extractSourceStructure` assigns `parentId` — each
 * parent is always a node already pushed earlier in the same top-to-bottom pass — but a guard
 * costs nothing and this function makes no assumption about a caller-supplied `structure`
 * actually being one `extractSourceStructure` itself produced).
 */
export function buildStructureBreadcrumbNodes(structure: SourceStructure, nodeId: string): SourceStructureNode[] {
  const byId = new Map(structure.nodes.map((n) => [n.id, n]));
  const start = byId.get(nodeId);
  if (!start) return [];
  const chain: SourceStructureNode[] = [];
  const seen = new Set<string>();
  let current: SourceStructureNode | undefined = start;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

export type StructureSelection = { status: "ok"; chunkIds: string[]; sharedWithOtherNodes: boolean }
  | { status: "error"; code: "stale-structure" | "node-not-found" | "empty-node" };
/** Seam for future scope UI. Reject stale snapshots and disclose overlapping leaf membership.
 * Parent/child overlap is intentional. Worksheet overlap can include adjacent-sheet text. */
export function resolveStructureNodeChunks(content: NormalizedSourceContent, structure: SourceStructure, nodeId: string): StructureSelection {
  if (content.sourceId !== structure.sourceId || content.normalizationVersion !== structure.normalizationVersion) return { status: "error", code: "stale-structure" };
  const current = extractSourceStructure(content);
  const node = current.nodes.find(n => n.id === nodeId);
  const snapshot = structure.nodes.find(n => n.id === nodeId);
  if (!snapshot) return { status: "error", code: "node-not-found" };
  if (!node || JSON.stringify(node) !== JSON.stringify(snapshot)) return { status: "error", code: "stale-structure" };
  if (!node.chunkIds.length) return { status: "error", code: "empty-node" };
  const ids = new Set(node.chunkIds);
  return { status: "ok", chunkIds: [...node.chunkIds], sharedWithOtherNodes: node.type === "worksheet" && current.nodes.some(n => n.id !== node.id && n.chunkIds.some(id => ids.has(id))) };
}
