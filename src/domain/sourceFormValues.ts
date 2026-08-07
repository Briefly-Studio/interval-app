import type { LibrarySource, SourceType } from "../models/librarySource";

// Shared shape between Add Source Details and Edit Source Details — every field is a plain
// string so both screens can drive the same <TextField>s uncontrolled-numeric-safe; numeric/array
// conversion only happens once, at submit time (see toSourcePatch below).
export type SourceFormValues = {
  displayTitle: string;
  sourceType: SourceType;
  originalName: string;
  fileSizeMB: string;
  collectionIds: string[];
  tags: string;
  course: string;
  semester: string;
  sourceLanguage: string;
  pageCount: string;
  slideCount: string;
  sheetCount: string;
  durationMinutes: string;
};

export const EMPTY_SOURCE_FORM_VALUES: SourceFormValues = {
  displayTitle: "",
  sourceType: "pdf",
  originalName: "",
  fileSizeMB: "",
  collectionIds: [],
  tags: "",
  course: "",
  semester: "",
  sourceLanguage: "",
  pageCount: "",
  slideCount: "",
  sheetCount: "",
  durationMinutes: "",
};

export function sourceToFormValues(source: LibrarySource): SourceFormValues {
  return {
    displayTitle: source.displayTitle,
    sourceType: source.sourceType,
    originalName: source.originalName ?? "",
    fileSizeMB: typeof source.fileSize === "number" ? String(Math.round((source.fileSize / (1024 * 1024)) * 100) / 100) : "",
    collectionIds: source.collectionIds,
    tags: source.tags.join(", "),
    course: source.course ?? "",
    semester: source.semester ?? "",
    sourceLanguage: source.sourceLanguage ?? "",
    pageCount: typeof source.pageCount === "number" ? String(source.pageCount) : "",
    slideCount: typeof source.slideCount === "number" ? String(source.slideCount) : "",
    sheetCount: typeof source.sheetCount === "number" ? String(source.sheetCount) : "",
    durationMinutes:
      typeof source.audioDuration === "number" ? String(Math.round((source.audioDuration / 60) * 100) / 100) : "",
  };
}

function parsePositiveNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseTags(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
    )
  );
}

// Converts form strings into the typed patch stored on a LibrarySourceRecord — the one place
// numeric/unit conversion happens (MB -> bytes, minutes -> seconds), so both Add and Edit stay in
// sync automatically.
//
// Type-specific numeric fields (pageCount/slideCount/sheetCount/audioDuration) are only carried
// through for the currently-selected sourceType — every other type-specific field is explicitly
// cleared. Without this, editing a source and switching its type (e.g. PDF, with a page count
// already entered, changed to Audio) would silently keep the old, now-irrelevant field on the
// saved record: source-detail unconditionally renders any populated count/duration field
// regardless of type, so a switched-type source could show both "Pages: 10" and "Duration: 0:05"
// at once. Explicit `undefined` here overwrites any previous value on update (object-spread
// semantics in src/storage/librarySources.ts#updateLibrarySource), not just "leaves it alone".
export function toSourcePatch(values: SourceFormValues): Omit<LibrarySource, "id" | "createdAt" | "processingStatus" | "lastUsedAt"> {
  const fileSizeMB = parsePositiveNumber(values.fileSizeMB);
  const durationMinutes = parsePositiveNumber(values.durationMinutes);

  return {
    displayTitle: values.displayTitle.trim(),
    sourceType: values.sourceType,
    originalName: values.originalName.trim() || undefined,
    fileSize: fileSizeMB !== undefined ? Math.round(fileSizeMB * 1024 * 1024) : undefined,
    collectionIds: values.collectionIds,
    tags: parseTags(values.tags),
    course: values.course.trim() || undefined,
    semester: values.semester.trim() || undefined,
    sourceLanguage: values.sourceLanguage.trim() || undefined,
    pageCount:
      values.sourceType === "pdf" || values.sourceType === "docx" ? parsePositiveNumber(values.pageCount) : undefined,
    slideCount: values.sourceType === "pptx" ? parsePositiveNumber(values.slideCount) : undefined,
    sheetCount: values.sourceType === "xlsx" ? parsePositiveNumber(values.sheetCount) : undefined,
    audioDuration: values.sourceType === "audio" && durationMinutes !== undefined ? Math.round(durationMinutes * 60) : undefined,
  };
}
