// Conservative metadata-only XML reader. No DTDs/external entities, external I/O or path guessing.
// The caller already bounds workbook/rels XML to 1 MiB each before inflation.
import type { WorksheetIdentity } from "../sourceStructure";

export const WORKBOOK_METADATA_LIMITS = { maxXmlChars: 1024 * 1024, maxElements: 10000, maxDepth: 16 } as const;
type Element = { name: string; path: string; attrs: Map<string, string> };
function decode(value: string): string {
  if (value.includes("<") || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
    || value.replace(/&[^;]*;/g, "").includes("&")) throw new Error("Invalid XML text");
  return value.replace(/&([^;]*);/g, (_, entity: string) => {
    const known: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '\"', apos: "'" };
    if (known[entity] !== undefined) return known[entity];
    if (!/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(entity)) throw new Error("Invalid entity");
    const point = entity[1] === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isInteger(point) || point < 32 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw new Error("Invalid character");
    return String.fromCodePoint(point);
  });
}
const local = (name: string) => name.split(":").pop()!;
function elements(xml: string): Element[] {
  if (xml.length > WORKBOOK_METADATA_LIMITS.maxXmlChars) throw new Error("Metadata limit");
  const result: Element[] = [], stack: string[] = [];
  // Every character must be accounted for; malformed input is optional-enrichment failure.
  const token = /<!--[^]*?-->|<\?[^]*?\?>|<\/?[a-zA-Z_][\w:.-]*(?:\s+[a-zA-Z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*\s*\/?>|[^<]+/gy;
  let end = 0, roots = 0;
  for (let match = token.exec(xml); match; match = token.exec(xml)) {
    const raw = match[0]; end = token.lastIndex;
    if (raw.startsWith("<!--")) {
      const comment = raw.slice(4, -3);
      if (comment.includes("--") || comment.endsWith("-")) throw new Error("Invalid comment");
      continue;
    }
    if (raw.startsWith("<?")) continue;
    if (!raw.startsWith("<")) {
      decode(raw);
      if (!stack.length && raw.trim()) throw new Error("Unexpected text");
      continue;
    }
    const name = /^<\/?([^\s/>]+)/.exec(raw)![1];
    if (raw.startsWith("</")) {
      if (!/^<\/[a-zA-Z_][\w:.-]*\s*>$/.test(raw) || stack.pop() !== name) throw new Error("Unbalanced XML");
      continue;
    }
    if (!stack.length && ++roots > 1) throw new Error("Multiple roots");
    const attrs = new Map<string, string>();
    const attr = /([a-zA-Z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    for (let a = attr.exec(raw); a; a = attr.exec(raw)) {
      if (attrs.has(a[1])) throw new Error("Duplicate attribute");
      attrs.set(a[1], decode(a[2] ?? a[3]));
    }
    result.push({ name: local(name), path: [...stack.map(local), local(name)].join("/"), attrs });
    if (result.length > WORKBOOK_METADATA_LIMITS.maxElements || stack.length >= WORKBOOK_METADATA_LIMITS.maxDepth) throw new Error("Metadata limit");
    if (!raw.endsWith("/>")) stack.push(name);
  }
  if (end !== xml.length || stack.length || roots !== 1) throw new Error("Malformed XML");
  return result;
}

export type WorkbookSheetIdentity = WorksheetIdentity & { relId: string };
export function readWorkbookSheetIdentities(xml: string): WorkbookSheetIdentity[] | null {
  try {
    const tags = elements(xml);
    if (tags[0]?.name !== "workbook" || tags.filter(t => t.path === "workbook/sheets").length > 1) return null;
    const names = new Set<string>(), ids = new Set<string>();
    const sheets: WorkbookSheetIdentity[] = [];
    for (const tag of tags.filter(t => t.path === "workbook/sheets/sheet")) {
      const sheetName = tag.attrs.get("name"), relId = tag.attrs.get("r:id");
      const visibility = tag.attrs.get("state") ?? "visible";
      const folded = sheetName?.toLowerCase();
      if (!sheetName?.trim() || !relId || names.has(folded!) || ids.has(relId)
        || !["visible", "hidden", "veryHidden"].includes(visibility)) return null;
      names.add(folded!); ids.add(relId);
      sheets.push({ sheetName, sheetIndex: sheets.length + 1, visibility: visibility as WorksheetIdentity["visibility"], relId });
    }
    return sheets;
  } catch { return null; }
}

export function readWorksheetRelationships(xml: string): { paths: Map<string, string>; malformed: boolean } {
  const paths = new Map<string, string>();
  let malformed = false;
  try {
    const tags = elements(xml);
    if (tags[0]?.name !== "Relationships") return { paths, malformed: true };
    const seen = new Set<string>(), duplicates = new Set<string>();
    for (const tag of tags.filter(t => t.path === "Relationships/Relationship")) {
      const id = tag.attrs.get("Id"), target = tag.attrs.get("Target");
      if (!id) { malformed = true; continue; }
      if (seen.has(id)) { paths.delete(id); duplicates.add(id); malformed = true; continue; }
      seen.add(id);
      const type = tag.attrs.get("Type");
      if (!type || !/^https?:\/\/(?:schemas.openxmlformats.org\/officeDocument\/2006|purl.oclc.org\/ooxml)\/relationships\/worksheet$/.test(type)) continue;
      if (tag.attrs.get("TargetMode") && tag.attrs.get("TargetMode") !== "Internal") { malformed = true; continue; }
      // Resolve ONLY package-local worksheet paths. Never strip arbitrary prefixes/basenames.
      let path: string | undefined;
      if (target && /^(?:\.\/)?worksheets\/[^/\\%?#:]+\.xml$/i.test(target)) path = `xl/${target.replace(/^\.\//, "")}`;
      else if (target && /^\/xl\/worksheets\/[^/\\%?#:]+\.xml$/i.test(target)) path = target.slice(1);
      if (!path || path.split("/").some(p => p === ".." || p === ".") || /[\u0000-\u001f]/.test(path)) { malformed = true; continue; }
      if (!duplicates.has(id)) paths.set(id, path);
    }
  } catch { return { paths: new Map(), malformed: true }; }
  return { paths, malformed };
}
