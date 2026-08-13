// TEMPORARY diagnostic instrumentation for the Library file-attach runtime-failure investigation
// (founder QA reported "Couldn't attach file" on a physical device with no visible cause). Safe
// to delete once the underlying issue is confirmed resolved by founder re-test — not meant to be
// permanent product logging.
//
// Dev-only (no-ops when `__DEV__` is false) and sanitized: call sites must never pass a full
// filesystem path, the picker URI, an original filename, a Cognito sub, an S3 key, an API URL, a
// presigned URL, or a token — only stage names and small booleans/enums/counts.
export function logLibraryFileAttach(stage: string, detail?: Record<string, unknown>): void {
  if (!__DEV__) return;
  if (detail && Object.keys(detail).length > 0) {
    console.log(`[LibraryFileAttach] ${stage}`, detail);
  } else {
    console.log(`[LibraryFileAttach] ${stage}`);
  }
}
