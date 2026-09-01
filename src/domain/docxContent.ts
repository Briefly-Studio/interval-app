// Minimal, purpose-built WordprocessingML (word/document.xml) reader — deliberately NOT a
// general-purpose XML parser. DOCX's document.xml uses a small, well-known, highly regular tag
// vocabulary (w:p, w:r, w:t, w:pStyle, w:numPr, w:b, w:i, w:tbl/w:tr/w:tc, w:drawing/a:blip); this
// module walks that vocabulary directly with a single linear tag-tokenizer rather than pulling in
// a full XML/DOM dependency. Two deliberate security properties fall out of that choice:
//   - No DOCTYPE/ENTITY support of any kind — this scanner only ever recognizes `<w:...>`/`<a:...>`
//     start/end/self-closing tags and the five predefined XML entities (plus numeric character
//     references). It never looks for `<!DOCTYPE` or `<!ENTITY`, so there is no XXE / entity-
//     expansion surface to exploit in the first place, not because of an allowlist that could be
//     bypassed, but because the parser has no code path that does anything with such a declaration.
//   - Bounded, linear-time scanning — every regex used here is anchored to the next `<` or `>`
//     with no nested quantifiers, so there is no catastrophic-backtracking risk from a
//     maliciously-crafted document.xml.
//
// Fidelity contract (see mission report for the full record): paragraphs, line breaks, heading
// levels 1-3, list items (bullet-styled — DOCX numbering.xml, which distinguishes ordered from
// unordered lists and defines exact numbering formats, is deliberately NOT parsed in this batch;
// every `w:numPr` paragraph renders as a generic bulleted item, a documented simplification, not
// a bug), basic bold/italic emphasis, table cell text (as a readable row-of-cells, not a
// pixel-accurate grid), and embedded images (resolved via relationships, subject to the caller's
// own size/count budget). Explicitly NOT attempted: exact fonts, pagination, macros, tracked
// changes, comments, embedded OLE objects, or any editing capability.

export type DocxRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
};

export type DocxBlock =
  | { kind: "heading"; level: 1 | 2 | 3; runs: DocxRun[] }
  | { kind: "paragraph"; runs: DocxRun[] }
  | { kind: "listItem"; runs: DocxRun[] }
  | { kind: "tableRow"; cells: DocxRun[][] }
  | { kind: "image"; relationshipId: string };

export type DocxParseResult = {
  blocks: DocxBlock[];
  /** True if parsing stopped early because `maxBlocks` was reached — a large-document safety
   * ceiling, not a corruption signal. The caller decides how to surface this (this batch treats
   * it as a hard "too large to process safely" failure rather than silently serving a partial
   * document — see sourceReaderDocx.ts). */
  truncated: boolean;
};

const ENTITY_MAP: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescapeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const codePoint = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return "";
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return "";
      }
    }
    return ENTITY_MAP[body] ?? match;
  });
}

type TagToken = { kind: "open" | "close" | "self"; name: string; attrs: string };
type ScanToken = { tag: TagToken } | { text: string };

// Single linear pass alternating between "<tag>" matches and the plain-text runs between them.
// `[^>]*?` and `[^<]+` are both bounded by the very next `<`/`>`, so this has no backtracking
// blowup risk regardless of input size or shape.
const TOKEN_RE = /<(\/?)([a-zA-Z0-9:_-]+)([^>]*?)(\/?)>|([^<]+)/g;

function* scan(xml: string): Generator<ScanToken> {
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(xml))) {
    const [, closing, name, attrs, selfClosing, text] = match;
    if (text !== undefined) {
      yield { text };
    } else {
      yield { tag: { kind: selfClosing ? "self" : closing ? "close" : "open", name, attrs } };
    }
  }
}

function attrValue(attrs: string, attrName: string): string | undefined {
  // Matches both `w:val="X"` and `w:val='X'` forms; DOCX always uses double quotes in practice,
  // single-quote support costs nothing and is defensive.
  const re = new RegExp(`${attrName}=(?:"([^"]*)"|'([^']*)')`);
  const m = re.exec(attrs);
  if (!m) return undefined;
  return unescapeXmlEntities(m[1] ?? m[2] ?? "");
}

function headingLevelFromStyle(styleVal: string | undefined): 1 | 2 | 3 | undefined {
  if (!styleVal) return undefined;
  const m = /^Heading([1-3])$/i.exec(styleVal.trim());
  if (!m) return undefined;
  return Number(m[1]) as 1 | 2 | 3;
}

/**
 * Parses `word/document.xml`'s content into an ordered list of blocks. `maxBlocks` is a
 * large-document safety ceiling (see sourceReaderDocx.ts for the actual value used) — parsing
 * stops as soon as it would be exceeded, never partway through allocating something unbounded.
 */
export function parseDocxDocumentXml(xml: string, maxBlocks: number): DocxParseResult {
  const blocks: DocxBlock[] = [];
  let truncated = false;

  // Table state: DOCX allows paragraphs to nest inside table cells (w:tbl > w:tr > w:tc > w:p),
  // the one real nesting case this batch needs to track explicitly. `tableDepth` counts nested
  // tables (tables can nest inside a cell) so only the innermost table's cell accumulates text.
  let tableDepth = 0;
  let inCell = false;
  let currentRowCells: DocxRun[][] = [];
  let currentCellRuns: DocxRun[] = [];

  // Paragraph state.
  let inParagraph = false;
  let paragraphRuns: DocxRun[] = [];
  let paragraphHeadingLevel: 1 | 2 | 3 | undefined;
  let paragraphIsListItem = false;

  // Run state.
  let inRun = false;
  let runBold = false;
  let runItalic = false;
  let runText = "";

  // `w:t` text-collection state — text between <w:t> and </w:t> may arrive as multiple scan
  // tokens if it contains no nested tags (it never does in valid WordML, but guard anyway).
  let inText = false;
  let textBuffer = "";

  function pushBlock(block: DocxBlock): boolean {
    if (blocks.length >= maxBlocks) {
      truncated = true;
      return false;
    }
    blocks.push(block);
    return true;
  }

  function flushRun() {
    if (inRun && runText) {
      paragraphRuns.push({ text: runText, bold: runBold || undefined, italic: runItalic || undefined });
    }
    inRun = false;
    runBold = false;
    runItalic = false;
    runText = "";
  }

  function flushParagraph(): boolean {
    flushRun();
    if (inCell) {
      currentCellRuns.push(...paragraphRuns);
    } else if (paragraphRuns.length > 0) {
      const kind = paragraphIsListItem ? "listItem" : paragraphHeadingLevel ? "heading" : "paragraph";
      const ok =
        kind === "heading"
          ? pushBlock({ kind: "heading", level: paragraphHeadingLevel as 1 | 2 | 3, runs: paragraphRuns })
          : kind === "listItem"
            ? pushBlock({ kind: "listItem", runs: paragraphRuns })
            : pushBlock({ kind: "paragraph", runs: paragraphRuns });
      if (!ok) return false;
    }
    inParagraph = false;
    paragraphRuns = [];
    paragraphHeadingLevel = undefined;
    paragraphIsListItem = false;
    return true;
  }

  for (const token of scan(xml)) {
    if ("text" in token) {
      if (inText) textBuffer += token.text;
      continue;
    }
    const { kind, name, attrs } = token.tag;
    const local = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;

    if (local === "t") {
      if (kind === "open") {
        inText = true;
        textBuffer = "";
      } else if (kind === "close") {
        inText = false;
        runText += unescapeXmlEntities(textBuffer);
        textBuffer = "";
      } else {
        // Self-closing <w:t/> — empty text run, nothing to accumulate.
      }
      continue;
    }
    if (local === "br" || local === "cr") {
      // Explicit line break within a run — preserved as a literal newline in the run text.
      runText += "\n";
      continue;
    }
    if (local === "tab") {
      runText += "\t";
      continue;
    }

    if (local === "r" && kind !== "self") {
      if (kind === "open") {
        flushRun();
        inRun = true;
      } else {
        flushRun();
      }
      continue;
    }
    if (local === "b" && inRun) {
      // <w:b w:val="0"/> explicitly turns bold off; bare <w:b/> (or w:val="1"/"true") turns it on.
      const val = attrValue(attrs, "w:val");
      runBold = val === undefined || val === "1" || val.toLowerCase() === "true";
      continue;
    }
    if (local === "i" && inRun) {
      const val = attrValue(attrs, "w:val");
      runItalic = val === undefined || val === "1" || val.toLowerCase() === "true";
      continue;
    }

    if (local === "p") {
      if (kind === "open") {
        if (inParagraph) flushParagraph();
        inParagraph = true;
      } else if (kind === "close") {
        if (!flushParagraph()) return { blocks, truncated: true };
      } else {
        // Self-closing <w:p/> — an empty paragraph; nothing to render.
      }
      continue;
    }
    if (local === "pStyle" && inParagraph) {
      paragraphHeadingLevel = headingLevelFromStyle(attrValue(attrs, "w:val"));
      continue;
    }
    if (local === "numPr" && inParagraph) {
      paragraphIsListItem = true;
      continue;
    }

    if (local === "tbl") {
      if (kind === "open") tableDepth += 1;
      else if (kind === "close") tableDepth = Math.max(0, tableDepth - 1);
      continue;
    }
    if (local === "tr" && tableDepth > 0) {
      if (kind === "open") {
        currentRowCells = [];
      } else if (kind === "close") {
        if (currentRowCells.length > 0) {
          if (!pushBlock({ kind: "tableRow", cells: currentRowCells })) return { blocks, truncated: true };
        }
        currentRowCells = [];
      }
      continue;
    }
    if (local === "tc" && tableDepth > 0) {
      if (kind === "open") {
        inCell = true;
        currentCellRuns = [];
      } else if (kind === "close") {
        currentRowCells.push(currentCellRuns);
        currentCellRuns = [];
        inCell = false;
      }
      continue;
    }

    if (local === "blip") {
      // <a:blip r:embed="rIdN"/> — the image reference inside <w:drawing>. Only the relationship
      // id is captured here; resolving it to an actual media file/bytes happens in
      // sourceReaderDocx.ts, which also enforces the image count/size budget. An external
      // reference (`r:link` instead of `r:embed`) is never followed — only `r:embed` (an
      // internal package relationship) is recognized at all.
      const rId = attrValue(attrs, "r:embed");
      if (rId) {
        flushRun();
        if (!pushBlock({ kind: "image", relationshipId: rId })) return { blocks, truncated: true };
      }
      continue;
    }
  }
  if (inParagraph) flushParagraph();

  return { blocks, truncated };
}

export type DocxRelationship = { id: string; target: string };

/**
 * Parses `word/_rels/document.xml.rels`, returning ONLY internal image relationships — anything
 * with `TargetMode="External"` (a hyperlink or any other externally-hosted reference) is
 * discarded here, unconditionally, so nothing downstream ever has the chance to "follow" one.
 */
export function parseDocxImageRelationships(relsXml: string): DocxRelationship[] {
  const result: DocxRelationship[] = [];
  for (const token of scan(relsXml)) {
    if ("text" in token) continue;
    const { name, attrs } = token.tag;
    const local = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
    if (local !== "Relationship") continue;
    const type = attrValue(attrs, "Type") ?? "";
    const targetMode = attrValue(attrs, "TargetMode");
    if (targetMode === "External") continue;
    if (!/\/image$/.test(type)) continue;
    const id = attrValue(attrs, "Id");
    const target = attrValue(attrs, "Target");
    if (id && target) result.push({ id, target });
  }
  return result;
}
