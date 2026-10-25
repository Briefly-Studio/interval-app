// Shared, explicit limits for untrusted imported files — see "Security"/"Limits" in the mission
// this was built from. An import must fail clearly rather than freezing the app or accepting an
// unbounded file.

/** Matches the existing Generate Study Deck review-field ceilings (responseValidation.ts) so an
 * imported card is never allowed to be larger than a generated or hand-typed one. */
export const MAX_IMPORT_FRONT_LENGTH = 300;
export const MAX_IMPORT_BACK_LENGTH = 500;

/** A raw CSV/TSV row longer than this is rejected as malformed rather than parsed — guards
 * against a single pathological line (e.g. an enormous quoted field) consuming unbounded memory
 * before per-field length checks below even run. */
export const MAX_IMPORT_LINE_LENGTH = 20_000;

/** Total file size ceiling, checked before any parsing begins. A plain-text CSV/TSV deck file is
 * never legitimately larger than this; a file over the limit is rejected outright (`file-too-large`)
 * rather than partially read. */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

/** Maximum cards accepted from a single import. Matches the order of magnitude of a very large
 * personal study deck without allowing an unbounded row count to blow through memory/storage —
 * rows beyond this are dropped with an explicit `cards-truncated-at-limit` warning, never silently.*/
export const MAX_IMPORT_CARDS = 2000;
