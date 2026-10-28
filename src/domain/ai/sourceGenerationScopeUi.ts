import { buildStructureBreadcrumbNodes, type SourceStructure, type SourceStructureNode } from "../sourceStructure";
import type { SourceGenerationScopeKind } from "./sourceGenerationScope";

// UI-facing presentation metadata for source scope selection — same pattern as
// generationOptionsUi.ts's CARD_COUNT_CHOICES, except the choice LIST is dynamic (which scopes
// are even offered depends on this source's own coverage/size/format), so this is a function
// rather than a static constant. The screen contains no hard-coded scope copy strings.

export type SourceScopeChoice = { value: SourceGenerationScopeKind; labelKey: string; descriptionKey: string };

/**
 * Decides which "Generate from" choices to offer for one source, in display order. Pure —
 * callers pass in already-computed availability facts rather than this function reaching for
 * chunks/coverage itself:
 *   - "Uncovered material" only when there is at least one actual uncovered chunk (never shown
 *     and immediately erroring — see resolveSourceGenerationScope's "uncovered-unavailable").
 *   - "Entire source" whenever the full source can be processed at all — either in one bounded
 *     request (today's original behavior) or, now, across several sequential batches (see
 *     batchPlanning.ts) up to `MAX_BATCHES_PER_GENERATION`. Never shown for a source so large even
 *     batching can't cover it (never shown and then silently truncated).
 *   - "Page range" only for a source with a known, trustworthy, multi-page count (PDF).
 *   - "Section range" (the generic ordinal fallback) only for a non-PDF source with more than one
 *     normalized section — a single-section source has nothing to range over.
 * A source offering none of the last three still always offers "Automatic" — this list is never
 * empty for any source Generate Study Deck considers available at all.
 */
export function buildSourceScopeChoices(params: {
  totalSectionCount: number;
  /** Only ever defined for PDF sources — see NormalizedSourceContent.metadata.pageCount. */
  pageCount?: number;
  hasUncoveredMaterial: boolean;
  /** Whether "Entire source" can be offered at all — true whenever the full chunk set fits one
   * request OR can be planned into <= MAX_BATCHES_PER_GENERATION batches (see
   * batchPlanning.ts's `canPlanBatchesFor`). No longer means "fits one generation" alone. */
  entireSourceAvailable: boolean;
  /** This source's own real structure (DOCX headings / XLSX worksheets), or null/empty when none
   * exists — never offered for PDF/TXT, which carry zero structural evidence by design (see
   * sourceStructure.ts's "no heuristic inference" principle). Only `structure.nodes.length > 0`
   * ever adds the "structureNode" choice below — an empty structure never shows an empty picker. */
  structure?: SourceStructure | null;
}): SourceScopeChoice[] {
  const choices: SourceScopeChoice[] = [
    { value: "automatic", labelKey: "generateDeck.scope.automaticLabel", descriptionKey: "generateDeck.scope.automaticDescription" },
  ];

  if (params.hasUncoveredMaterial) {
    choices.push({ value: "uncovered", labelKey: "generateDeck.scope.uncoveredLabel", descriptionKey: "generateDeck.scope.uncoveredDescription" });
  }

  if (params.entireSourceAvailable) {
    choices.push({ value: "entireSource", labelKey: "generateDeck.scope.entireSourceLabel", descriptionKey: "generateDeck.scope.entireSourceDescription" });
  }

  if (typeof params.pageCount === "number" && params.pageCount > 1) {
    choices.push({ value: "pageRange", labelKey: "generateDeck.scope.pageRangeLabel", descriptionKey: "generateDeck.scope.pageRangeDescription" });
  } else if (params.totalSectionCount > 1) {
    choices.push({ value: "sectionRange", labelKey: "generateDeck.scope.sectionRangeLabel", descriptionKey: "generateDeck.scope.sectionRangeDescription" });
  }

  if (params.structure && params.structure.nodes.length > 0) {
    // DOCX headings vs. XLSX worksheets are mutually exclusive per source (extractSourceStructure
    // only ever populates one node `type` per source) — copy is chosen from the FIRST node, same
    // as checking `structure.nodes[0].type` anywhere else.
    const isWorksheet = params.structure.nodes[0].type === "worksheet";
    choices.push(isWorksheet
      ? { value: "structureNode", labelKey: "generateDeck.scope.worksheetLabel", descriptionKey: "generateDeck.scope.worksheetDescription" }
      : { value: "structureNode", labelKey: "generateDeck.scope.documentSectionLabel", descriptionKey: "generateDeck.scope.documentSectionDescription" });
  }

  return choices;
}

// i18n key for the plain-language pre-generation summary of each NON-range scope (section 13 —
// "before Generate, show a concise truthful scope summary"). Page/section range AND structureNode
// summaries need their own params (start/end, or the picked node's own title) and are built
// inline on the screen instead.
export const SCOPE_SUMMARY_KEY: Record<"automatic" | "entireSource" | "uncovered", string> = {
  automatic: "generateDeck.scope.summaryAutomatic",
  entireSource: "generateDeck.scope.summaryEntireSource",
  uncovered: "generateDeck.scope.summaryUncovered",
};

// --- Structure node picker -------------------------------------------------------------------
// Presentation-only derived facts for ONE structure node choice in the picker list — deliberately
// NOT final display strings (same split as the rest of this file: this stays i18n-free/pure: raw
// node titles are real source text, never translated, and any surrounding UI chrome — counts,
// "no content", "shared with" wording — is composed by the screen from i18n keys + these fields).

export type StructureNodeChoice = {
  nodeId: string;
  /** Real source text, untouched. */
  title: string;
  /** Root-first real ancestor titles, excluding this node itself — [] for a root-level node.
   * Always populated (regardless of `titleIsAmbiguous`) so an accessibility label can state full
   * hierarchical context even when the on-screen label doesn't need to — indentation alone must
   * never be the only way a nested node's position is conveyed. */
  ancestorTitles: string[];
  /** 1-based real heading depth, or 0 for a worksheet (always flat) or a flat/non-hierarchical
   * heading. Used by the screen purely for VISUAL indentation. */
  level: number;
  chunkCount: number;
  /** True when zero chunks — in practice only ever reachable for an empty worksheet (a DOCX
   * heading's own interval always includes at least its own heading-text chunk) — the screen
   * must still SHOW this row (never silently omit it), just disabled. */
  disabled: boolean;
  /** True when this node's chunks are also claimed by at least one other node — the known XLSX
   * "a chunk can span worksheet boundaries" limitation (sourceStructure.ts). */
  sharedWithOtherNodes: boolean;
  /** True when another node with a DIFFERENT parent anywhere in this structure shares this exact
   * same `title` — lets the screen decide whether the ON-SCREEN label needs breadcrumb-qualifying
   * too. Deliberately false for true same-parent siblings (see `duplicatePosition` below):
   * breadcrumb-qualifying two nodes that already share a parent can never tell them apart, since
   * their ancestor paths are identical. The accessibility label is always fully qualified
   * regardless of this flag. */
  titleIsAmbiguous: boolean;
  /** Set only when at least one OTHER node shares both this exact `title` AND this exact parent —
   * the one case breadcrumb-qualifying can never disambiguate. `position` is this node's 1-based
   * rank, in real document order, within that same-title-same-parent group; `total` is the
   * group's size. Presentation-only: never mutates the source `title`, never changes `nodeId`
   * selection identity, and stays undefined whenever a node's title is unique among its own
   * siblings (so a normal heading/worksheet never gets noisy positional text it doesn't need). */
  duplicatePosition?: { position: number; total: number };
};

/** One choice per node, in the structure's own document order (never re-sorted). Pure — derives
 * everything from `structure` alone, same contract as resolveStructureNodeChunks's own
 * "shared-worksheet-chunks" computation (sourceStructure.ts), just scoped per node here so the
 * picker can disclose it BEFORE the user picks, not only after. */
export function buildStructureNodeChoices(structure: SourceStructure): StructureNodeChoice[] {
  const titleCounts = new Map<string, number>();
  for (const node of structure.nodes) titleCounts.set(node.title, (titleCounts.get(node.title) ?? 0) + 1);

  const chunkMembership = new Map<string, number>();
  for (const node of structure.nodes) for (const id of node.chunkIds) chunkMembership.set(id, (chunkMembership.get(id) ?? 0) + 1);

  // Same-parent-same-title groups, in real document order — the one case breadcrumb-qualifying
  // can never disambiguate (identical ancestor paths), so these get positional context instead.
  const siblingGroups = new Map<string, SourceStructureNode[]>();
  for (const node of structure.nodes) {
    const key = `${node.parentId ?? ""}\u0000${node.title}`;
    const group = siblingGroups.get(key);
    if (group) group.push(node);
    else siblingGroups.set(key, [node]);
  }

  return structure.nodes.map((node: SourceStructureNode) => {
    const key = `${node.parentId ?? ""}\u0000${node.title}`;
    const siblingGroup = siblingGroups.get(key) ?? [node];
    const totalWithTitle = titleCounts.get(node.title) ?? 0;
    return {
      nodeId: node.id,
      title: node.title,
      ancestorTitles: buildStructureBreadcrumbNodes(structure, node.id).slice(0, -1).map((ancestor) => ancestor.title),
      level: node.level ?? 0,
      chunkCount: node.chunkIds.length,
      disabled: node.chunkIds.length === 0,
      sharedWithOtherNodes: node.chunkIds.some((id) => (chunkMembership.get(id) ?? 0) > 1),
      // Only ambiguous when a duplicate exists OUTSIDE this node's own same-parent group — a
      // duplicate confined entirely within the group is handled by duplicatePosition instead.
      titleIsAmbiguous: totalWithTitle > siblingGroup.length,
      duplicatePosition: siblingGroup.length > 1
        ? { position: siblingGroup.indexOf(node) + 1, total: siblingGroup.length }
        : undefined,
    };
  });
}

// --- Structure node picker label composition -------------------------------------------------
// Pure composition of the on-screen label / accessibility label / secondary description text for
// one StructureNodeChoice — split out of the screen component so the disambiguation logic (which
// of breadcrumb-qualifying vs. positional "2 of 3" context applies, and in what order the parts
// are joined) is independently testable without a React Native render. `copy` carries only
// ALREADY-localized strings/closures (built by the screen via `t`/`plural`) — this function
// itself stays i18n-free, same split as the rest of this file. Deliberately takes no RTL/
// direction flag: visual mirroring is handled by text styling/bidi elsewhere (see
// StructureNodePicker.tsx's own `isRtl`-driven indentation) — this function's job is only to join
// strings in a stable LOGICAL (root-ancestor-first) order, never to reorder them for direction.
export type StructureNodePickerLabelCopy = {
  ancestorContext: (path: string) => string;
  levelContext: (level: number) => string;
  duplicatePosition: (position: number, total: number) => string;
  emptyHint: string;
  sharedHint: string;
  sectionCount: (chunkCount: number) => string;
};

export function buildStructureNodePickerLabel(
  choice: StructureNodeChoice,
  isWorksheetStructure: boolean,
  copy: StructureNodePickerLabelCopy
): { label: string; accessibilityLabel: string; description: string } {
  const description = choice.disabled
    ? copy.emptyHint
    : choice.duplicatePosition
      ? copy.duplicatePosition(choice.duplicatePosition.position, choice.duplicatePosition.total)
      : choice.sharedWithOtherNodes
        ? copy.sharedHint
        : copy.sectionCount(choice.chunkCount);

  const label = choice.titleIsAmbiguous && choice.ancestorTitles.length
    ? `${choice.ancestorTitles.join(" › ")} › ${choice.title}`
    : choice.title;

  // Indentation is never the only hierarchy cue — ancestor context and level are always stated in
  // words here, regardless of whether the on-screen label itself needed breadcrumb-qualifying.
  const accessibilityParts = [
    ...(choice.ancestorTitles.length ? [copy.ancestorContext(choice.ancestorTitles.join(" › "))] : []),
    choice.title,
    ...(!isWorksheetStructure && choice.level > 0 ? [copy.levelContext(choice.level)] : []),
    description,
  ];

  return { label, accessibilityLabel: accessibilityParts.join(". "), description };
}
