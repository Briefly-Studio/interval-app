// Deterministic column sizing for the DOCX reader's native table renderer
// (app/library/[id]/reader.tsx).
//
// The DOCX parser (src/domain/docxContent.ts) emits each table row as an ordered list of
// `DocxRun[][]` cells with NO width information — Word's own column widths (twips in
// `w:tblGrid` / `w:tcW`) are deliberately not parsed in this batch. So the renderer has to
// choose widths itself, with exactly one goal: keep every column readable on a phone.
//
// Strategy (intentionally simple — not a layout engine):
//   - Every column gets the SAME width, so cells line up vertically across rows.
//   - A table "wants" `columnCount * minColumnWidth`.
//   - If that fits the content viewport, widen the columns evenly to fill it: no wasted
//     horizontal space, no horizontal scroll (`scrollable: false`).
//   - If it does not, hold every column at `minColumnWidth`, let the table be wider than the
//     viewport, and let the caller wrap it in a horizontal ScrollView (`scrollable: true`).
//
// A column is never shrunk below `minColumnWidth`, so a 10-column table on a 360pt phone
// scrolls horizontally instead of collapsing into 36pt ribbons of unreadable wrapped text.

/** Readable lower bound for a single DOCX table column on a phone, in density-independent px. */
export const DOCX_TABLE_MIN_COLUMN_WIDTH = 120;

export type DocxTableLayout = {
  /** Width the table's inner content `View` should be given. */
  tableWidth: number;
  /** Width every cell in every row is given (uniform, so columns align across rows). */
  columnWidth: number;
  /** True when `tableWidth` exceeds the viewport — the caller enables horizontal scrolling. */
  scrollable: boolean;
  /** Column count actually used (input clamped to a non-negative integer). */
  columnCount: number;
};

/**
 * @param columnCount   how many columns the table has (usually the max cell count across its rows)
 * @param viewportWidth the horizontal space available to the table inside the reader
 * @param minColumnWidth readable per-column minimum (defaults to `DOCX_TABLE_MIN_COLUMN_WIDTH`)
 */
export function computeDocxTableLayout(
  columnCount: number,
  viewportWidth: number,
  minColumnWidth: number = DOCX_TABLE_MIN_COLUMN_WIDTH
): DocxTableLayout {
  const safeMin =
    Number.isFinite(minColumnWidth) && minColumnWidth > 0 ? minColumnWidth : DOCX_TABLE_MIN_COLUMN_WIDTH;
  const safeViewport = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : safeMin;
  const cols = Number.isFinite(columnCount) && columnCount > 0 ? Math.floor(columnCount) : 0;

  if (cols === 0) {
    // Defensive: a row with no cells at all. Nothing meaningful to size — never scroll.
    return { tableWidth: safeViewport, columnWidth: safeViewport, scrollable: false, columnCount: 0 };
  }

  const naturalWidth = cols * safeMin;

  if (naturalWidth <= safeViewport) {
    // Narrow table — distribute the viewport evenly across columns, no horizontal scroll.
    const columnWidth = Math.floor(safeViewport / cols);
    return { tableWidth: columnWidth * cols, columnWidth, scrollable: false, columnCount: cols };
  }

  // Wide table — hold the readable minimum per column, exceed the viewport, scroll.
  return { tableWidth: naturalWidth, columnWidth: safeMin, scrollable: true, columnCount: cols };
}
