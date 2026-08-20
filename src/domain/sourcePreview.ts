import type { SourceType } from "../models/librarySource";

export type SourcePreviewStrategy =
  | { kind: "embedded-pdf" }
  | { kind: "embedded-image" }
  | { kind: "embedded-text" }
  | { kind: "native-handoff" }
  | { kind: "unsupported" };

export function resolveSourcePreviewStrategy(source: { sourceType: SourceType }): SourcePreviewStrategy {
  if (source.sourceType === "pdf") return { kind: "embedded-pdf" };
  if (source.sourceType === "image") return { kind: "embedded-image" };
  if (source.sourceType === "text") return { kind: "embedded-text" };
  return { kind: "native-handoff" };
}

export function hasEmbeddedSourcePreview(source: { sourceType: SourceType }): boolean {
  return resolveSourcePreviewStrategy(source).kind.startsWith("embedded-");
}
