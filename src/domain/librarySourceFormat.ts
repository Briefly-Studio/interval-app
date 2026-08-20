import type { SourceType } from "../models/librarySource";

// Trusted Library source-format facts. This module is deliberately boring and data-shaped:
// detection, viewer/export staging, and cloud-upload gating should all ask the same small model
// instead of carrying separate MIME/extension tables that can drift.

export type SourceFormatFamily = "pdf" | "document" | "text" | "image" | "audio" | "presentation" | "spreadsheet";

export type SourceFormatDefinition = {
  sourceType: SourceType;
  family: SourceFormatFamily;
  mimeTypes: readonly string[];
  extensions: readonly string[];
  defaultMimeType: string;
  defaultUTI: string;
  uploadSupported: boolean;
  viewerExtensionByMimeType?: Readonly<Record<string, string>>;
  defaultViewerExtension?: string;
};

export const GENERIC_MIME_TYPES = new Set(["application/octet-stream", "binary/octet-stream"]);

export const SOURCE_FORMATS: readonly SourceFormatDefinition[] = [
  {
    sourceType: "pdf",
    family: "pdf",
    mimeTypes: ["application/pdf"],
    extensions: ["pdf"],
    defaultMimeType: "application/pdf",
    defaultUTI: "com.adobe.pdf",
    defaultViewerExtension: "pdf",
    uploadSupported: true,
  },
  {
    sourceType: "docx",
    family: "document",
    mimeTypes: ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    extensions: ["doc", "docx"],
    defaultMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    defaultUTI: "org.openxmlformats.wordprocessingml.document",
    defaultViewerExtension: "docx",
    viewerExtensionByMimeType: {
      "application/msword": "doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    },
    uploadSupported: true,
  },
  {
    sourceType: "text",
    family: "text",
    mimeTypes: ["text/plain"],
    extensions: ["txt"],
    defaultMimeType: "text/plain",
    defaultUTI: "public.plain-text",
    defaultViewerExtension: "txt",
    uploadSupported: true,
  },
  {
    sourceType: "image",
    family: "image",
    mimeTypes: ["image/jpeg", "image/png", "image/heic"],
    extensions: ["jpg", "jpeg", "png", "heic"],
    defaultMimeType: "image/jpeg",
    defaultUTI: "public.image",
    defaultViewerExtension: "jpg",
    viewerExtensionByMimeType: {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/heic": "heic",
    },
    uploadSupported: true,
  },
  {
    sourceType: "audio",
    family: "audio",
    mimeTypes: ["audio/aac", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-m4a", "audio/x-wav"],
    extensions: ["aac", "m4a", "mp3", "wav"],
    defaultMimeType: "audio/mpeg",
    defaultUTI: "public.audio",
    viewerExtensionByMimeType: {
      "audio/aac": "aac",
      "audio/mpeg": "mp3",
      "audio/mp4": "m4a",
      "audio/wav": "wav",
      "audio/x-m4a": "m4a",
      "audio/x-wav": "wav",
    },
    // Development/Staging backend allow-list intentionally does not accept audio yet. Keeping
    // this explicit lets the client preserve local metadata/file support without pretending cloud
    // audio upload parity is live before a separate backend deployment gate.
    uploadSupported: false,
  },
  {
    sourceType: "pptx",
    family: "presentation",
    mimeTypes: ["application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    extensions: ["ppt", "pptx"],
    defaultMimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    defaultUTI: "org.openxmlformats.presentationml.presentation",
    defaultViewerExtension: "pptx",
    viewerExtensionByMimeType: {
      "application/vnd.ms-powerpoint": "ppt",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    },
    uploadSupported: true,
  },
  {
    sourceType: "xlsx",
    family: "spreadsheet",
    mimeTypes: ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    extensions: ["xls", "xlsx"],
    defaultMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    defaultUTI: "org.openxmlformats.spreadsheetml.sheet",
    defaultViewerExtension: "xlsx",
    viewerExtensionByMimeType: {
      "application/vnd.ms-excel": "xls",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    },
    uploadSupported: true,
  },
];

const FORMATS_BY_SOURCE_TYPE = new Map<SourceType, SourceFormatDefinition>(
  SOURCE_FORMATS.map((format) => [format.sourceType, format])
);

const SOURCE_TYPE_BY_MIME = new Map<string, SourceType>();
const SOURCE_TYPE_BY_EXTENSION = new Map<string, SourceType>();

for (const format of SOURCE_FORMATS) {
  for (const mimeType of format.mimeTypes) {
    SOURCE_TYPE_BY_MIME.set(mimeType, format.sourceType);
  }
  for (const extension of format.extensions) {
    SOURCE_TYPE_BY_EXTENSION.set(extension, format.sourceType);
  }
}

export type SourceFileEvidence = { mimeType?: string; extension?: string };

export type SourceHandoffHint = { mimeType: string; UTI: string; extension?: string };

export function normalizeMimeType(mimeType: string | undefined): string | undefined {
  if (!mimeType) return undefined;
  const trimmed = mimeType.split(";")[0]?.trim().toLowerCase();
  return trimmed || undefined;
}

export function normalizeExtension(extension: string | undefined): string | undefined {
  if (!extension) return undefined;
  const trimmed = extension.trim().toLowerCase().replace(/^\./, "");
  return trimmed || undefined;
}

export function isGenericMimeType(mimeType: string | undefined): boolean {
  const normalized = normalizeMimeType(mimeType);
  return !!normalized && GENERIC_MIME_TYPES.has(normalized);
}

export function extensionFromFileName(fileName: string | undefined): string | undefined {
  if (!fileName) return undefined;
  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === trimmed.length - 1) return undefined;
  return normalizeExtension(trimmed.slice(lastDot + 1));
}

export function getSourceFormat(sourceType: SourceType): SourceFormatDefinition {
  const format = FORMATS_BY_SOURCE_TYPE.get(sourceType);
  if (!format) {
    throw new Error(`Unsupported source type: ${sourceType}`);
  }
  return format;
}

export function detectSourceTypeFromFileEvidence(input: SourceFileEvidence): SourceType | undefined {
  const mimeType = normalizeMimeType(input.mimeType);
  const mimeSourceType = mimeType ? SOURCE_TYPE_BY_MIME.get(mimeType) : undefined;
  if (mimeSourceType) return mimeSourceType;

  const extension = normalizeExtension(input.extension);
  return extension ? SOURCE_TYPE_BY_EXTENSION.get(extension) : undefined;
}

export function isCloudUploadMimeTypeSupported(mimeType: string | undefined): boolean {
  const normalized = normalizeMimeType(mimeType);
  if (!normalized) return false;
  const sourceType = SOURCE_TYPE_BY_MIME.get(normalized);
  if (!sourceType) return false;
  return getSourceFormat(sourceType).uploadSupported;
}

export function allowedCloudUploadMimeTypes(): string[] {
  return SOURCE_FORMATS.flatMap((format) => (format.uploadSupported ? [...format.mimeTypes] : []));
}

export function resolveSourceHandoffHint(source: { sourceType: SourceType; mimeType?: string }): SourceHandoffHint {
  const format = getSourceFormat(source.sourceType);
  const mimeType = normalizeMimeType(source.mimeType);
  const recognizedForType = !!mimeType && format.mimeTypes.includes(mimeType);
  const outputMimeType = recognizedForType ? mimeType : format.defaultMimeType;
  const extension = format.viewerExtensionByMimeType?.[outputMimeType] ?? format.defaultViewerExtension;

  return {
    mimeType: outputMimeType,
    UTI: format.defaultUTI,
    extension,
  };
}

const SAFE_FILENAME_FALLBACK = "source";
const MAX_FILENAME_BASE_LENGTH = 80;

function stripPathSegments(value: string): string {
  const normalizedSeparators = value.replace(/\\/g, "/");
  const segments = normalizedSeparators.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? normalizedSeparators;
}

function stripFinalExtension(value: string): string {
  const lastDot = value.lastIndexOf(".");
  if (lastDot <= 0) return value;
  return value.slice(0, lastDot);
}

function stripTrustedExtensionRepeats(value: string, extension: string | undefined): string {
  if (!extension) return value;
  const suffix = `.${extension.toLowerCase()}`;
  let base = value;
  while (base.toLowerCase().endsWith(suffix)) {
    base = base.slice(0, -suffix.length).replace(/[.\s-]+$/g, "");
  }
  return base || value;
}

export function sanitizeExportFilenameBase(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const base = stripFinalExtension(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, MAX_FILENAME_BASE_LENGTH)
    .replace(/[.\s-]+$/g, "");

  return base || undefined;
}

export function sanitizeOriginalFilenameBase(value: string | undefined): string | undefined {
  return sanitizeExportFilenameBase(value ? stripPathSegments(value) : undefined);
}

export function prepareSourceExportFilename(source: {
  id: string;
  sourceType: SourceType;
  mimeType?: string;
  originalName?: string;
  displayTitle?: string;
}): string {
  const { extension } = resolveSourceHandoffHint(source);
  const base =
    sanitizeOriginalFilenameBase(source.originalName) ??
    sanitizeExportFilenameBase(source.displayTitle) ??
    sanitizeExportFilenameBase(source.id) ??
    SAFE_FILENAME_FALLBACK;

  const exportBase = stripTrustedExtensionRepeats(base, extension);
  return extension ? `${exportBase}.${extension}` : exportBase;
}

export function formatFileSize(bytes: number | undefined): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unitIndex]}`;
}

// audioDuration is stored in whole seconds (see src/models/librarySource.ts).
export function formatAudioDuration(totalSeconds: number | undefined): string | null {
  if (typeof totalSeconds !== "number" || !Number.isFinite(totalSeconds) || totalSeconds < 0) return null;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
