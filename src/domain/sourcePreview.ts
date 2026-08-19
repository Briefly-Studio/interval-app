import type { SourceType } from "../models/librarySource";

export type SourcePreviewStrategy =
  | { kind: "embedded-pdf" }
  | { kind: "native-handoff" }
  | { kind: "unsupported" };

export function resolveSourcePreviewStrategy(source: { sourceType: SourceType }): SourcePreviewStrategy {
  if (source.sourceType === "pdf") return { kind: "embedded-pdf" };
  return { kind: "native-handoff" };
}

export function hasEmbeddedSourcePreview(source: { sourceType: SourceType }): boolean {
  return resolveSourcePreviewStrategy(source).kind === "embedded-pdf";
}
