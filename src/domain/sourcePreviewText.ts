export const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
export const TEXT_PREVIEW_CHUNK_CHARS = 4096;

export type TextPreviewFileInspection =
  | { status: "readable" }
  | { status: "missing" }
  | { status: "too-large" };

export function inspectTextPreviewFile(file: { exists: boolean; size?: number }): TextPreviewFileInspection {
  if (!file.exists || file.size === undefined) return { status: "missing" };
  if (file.size > MAX_TEXT_PREVIEW_BYTES) return { status: "too-large" };
  return { status: "readable" };
}

export function chunkTextPreviewContent(content: string): string[] {
  if (!content) return [];

  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += TEXT_PREVIEW_CHUNK_CHARS) {
    chunks.push(content.slice(index, index + TEXT_PREVIEW_CHUNK_CHARS));
  }
  return chunks;
}
