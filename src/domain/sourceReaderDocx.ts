import { unzipSync, type UnzipFileInfo } from "fflate";

import { parseDocxDocumentXml, parseDocxImageRelationships, type DocxBlock } from "./docxContent";

// DOCX (Office Open XML) is a ZIP container holding a small set of XML parts. This module treats
// the whole archive as untrusted user input end to end:
//   - `unzipSync`'s `filter` callback receives each entry's name/compressed-size/uncompressed-size
//     straight from the ZIP central directory, BEFORE any bytes are actually inflated — every
//     safety limit below (allow-listed entry names, per-entry size caps, a cumulative media-bytes
//     budget) is enforced at that point, so a hostile entry is rejected without ever being
//     decompressed. This is the actual zip-bomb defense: the output size of anything we DO
//     inflate is capped by these absolute ceilings regardless of its compression ratio.
//   - Only three kinds of entry are ever accepted at all: the exact path `word/document.xml`, the
//     exact path `word/_rels/document.xml.rels`, and image files directly under `word/media/`.
//     Everything else in the archive (styles, numbering, headers/footers, custom XML, macros,
//     any other package part) is rejected by the filter and never touched.
//   - Any entry name containing a `..` segment or starting with `/` is rejected outright — a
//     defense-in-depth path-traversal guard on top of the allow-list above. Nothing extracted
//     here is ever written to a caller-controlled or entry-controlled path in the first place
//     (see the return shape below): the caller decides where, if anywhere, to persist media
//     bytes, keyed by this module's own relationship id, never by the raw archive entry name.
//
// fflate@0.8.3 (see package.json) was added specifically for this: pure JS, zero dependencies,
// MIT-licensed, and its `filter` hook is exactly the pre-inflation safety control this module
// needs — evaluated against the alternative of a general-purpose ZIP library (heavier, broader
// attack surface) or hand-writing DEFLATE decompression (infeasible to get right and audit).

const MAX_ARCHIVE_BYTES = 30 * 1024 * 1024;
const MAX_DOCUMENT_XML_BYTES = 10 * 1024 * 1024;
const MAX_RELS_XML_BYTES = 2 * 1024 * 1024;
const MAX_MEDIA_FILE_BYTES = 8 * 1024 * 1024;
const MAX_MEDIA_TOTAL_BYTES = 15 * 1024 * 1024;
const MAX_MEDIA_COUNT = 30;
const MAX_BLOCKS = 5000;

const DOCUMENT_XML_PATH = "word/document.xml";
const RELS_PATH = "word/_rels/document.xml.rels";
const MEDIA_RE = /^word\/media\/[^/]+\.(png|jpe?g|gif|bmp)$/i;

function isSafeEntryName(name: string): boolean {
  if (name.startsWith("/")) return false;
  if (name.split("/").includes("..")) return false;
  return true;
}

export type DocxMedia = { bytes: Uint8Array; extension: string };

export type DocxReadOutcome =
  | { status: "ready"; blocks: DocxBlock[]; mediaByRelationshipId: Map<string, DocxMedia> }
  | { status: "empty" }
  | { status: "too-large" }
  // Covers: encrypted/password-protected DOCX (a different binary container entirely — not a
  // ZIP this parser can open, or a ZIP without a word/document.xml part), and any other
  // fundamentally non-WordprocessingML archive. Deliberately not "failed" — see this module's
  // header comment and the mission report's "Legacy DOC result" section for why encryption in
  // particular is framed as unsupported rather than a transient failure.
  | { status: "unsupported" }
  // A malformed/non-ZIP file, or an internal parsing error.
  | { status: "failed" };

/**
 * Reads a DOCX archive already fully in memory (the caller is responsible for local-first/cloud
 * resolution and reading the prepared viewer copy's bytes — see reader.tsx). Never touches the
 * filesystem itself; returns raw media bytes keyed by relationship id so the caller decides
 * whether/where to persist them (this batch writes them to a disposable cache directory — see
 * reader.tsx — never the canonical durable source file).
 */
export function readDocxArchive(archiveBytes: Uint8Array): DocxReadOutcome {
  if (archiveBytes.byteLength === 0) return { status: "unsupported" };
  if (archiveBytes.byteLength > MAX_ARCHIVE_BYTES) return { status: "too-large" };

  let mediaTotalBytes = 0;
  let mediaCount = 0;

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(archiveBytes, {
      filter(file: UnzipFileInfo) {
        if (!isSafeEntryName(file.name)) return false;
        if (file.name === DOCUMENT_XML_PATH) return file.originalSize <= MAX_DOCUMENT_XML_BYTES;
        if (file.name === RELS_PATH) return file.originalSize <= MAX_RELS_XML_BYTES;
        if (MEDIA_RE.test(file.name)) {
          if (mediaCount >= MAX_MEDIA_COUNT) return false;
          if (file.originalSize > MAX_MEDIA_FILE_BYTES) return false;
          if (mediaTotalBytes + file.originalSize > MAX_MEDIA_TOTAL_BYTES) return false;
          mediaTotalBytes += file.originalSize;
          mediaCount += 1;
          return true;
        }
        return false;
      },
    });
  } catch {
    // Not a valid ZIP at all (or a ZIP `unzipSync` couldn't parse) — this is also what a
    // password-protected/encrypted DOCX looks like, since OOXML encryption wraps the package in
    // a completely different (CFB/OLE2) container that isn't a ZIP in the first place.
    return { status: "unsupported" };
  }

  const documentXmlBytes = entries[DOCUMENT_XML_PATH];
  if (!documentXmlBytes) {
    // A valid ZIP that simply isn't a WordprocessingML package — including the encrypted-DOCX
    // case where the outer container happens to still parse as *a* ZIP but never contains this
    // part, and any other fundamentally non-Word archive someone renamed to .docx.
    return { status: "unsupported" };
  }

  let documentXml: string;
  let relsXml = "";
  try {
    documentXml = new TextDecoder("utf-8").decode(documentXmlBytes);
    const relsBytes = entries[RELS_PATH];
    if (relsBytes) relsXml = new TextDecoder("utf-8").decode(relsBytes);
  } catch {
    return { status: "failed" };
  }

  let parsed: ReturnType<typeof parseDocxDocumentXml>;
  try {
    parsed = parseDocxDocumentXml(documentXml, MAX_BLOCKS);
  } catch {
    return { status: "failed" };
  }
  if (parsed.truncated) return { status: "too-large" };
  if (parsed.blocks.length === 0) return { status: "empty" };

  const relationships = parseDocxImageRelationships(relsXml);
  const mediaByRelationshipId = new Map<string, DocxMedia>();
  for (const rel of relationships) {
    if (rel.target.split("/").includes("..")) continue;
    const normalizedTarget = rel.target.replace(/^\.?\//, "");
    const entryPath = normalizedTarget.startsWith("media/") ? `word/${normalizedTarget}` : `word/media/${normalizedTarget}`;
    const bytes = entries[entryPath];
    if (!bytes) continue;
    const extensionMatch = /\.([a-zA-Z0-9]+)$/.exec(entryPath);
    const extension = extensionMatch ? extensionMatch[1].toLowerCase() : "png";
    mediaByRelationshipId.set(rel.id, { bytes, extension });
  }

  return { status: "ready", blocks: parsed.blocks, mediaByRelationshipId };
}
