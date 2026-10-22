# AI Multi-Format Generation

**Status: DOCX and XLSX implemented and integrated on `feat/ai-multiformat-generation` (cut from
`v3.3-dev`); not yet founder-QA verified, not yet merged.** Image/OCR and Audio/transcription were
investigated in depth and are explicitly **BLOCKED** for this batch — concrete, audited findings
are recorded below, not a vague "too hard." Video is **FUTURE** — investigated for feasibility
only, per explicit instruction not to implement it this batch. Nothing here changes the AI
request schema, the Bedrock model, context limits, or any backend/AWS/CDK/EAS/Staging/Production
configuration — see "Confirmation of scope boundaries" at the end.

This document is the authoritative support matrix for non-TXT/PDF source formats in Generate
Study Deck. `docs/ai-pdf-generation.md` remains authoritative for PDF specifically;
`docs/source-normalization-foundation.md` remains authoritative for the normalization layer's
general contract. This document does not restate either — it covers what's new.

## Executive summary

The existing pipeline (`normalizeSource → GenerationContext → generateDeckFlow → provider
selection → backend provider → Lambda → Bedrock/Nova 2 Lite → responseValidation → draft/review/
save`) was already 100% format-agnostic — confirmed by reading every file in that chain in full,
not assumed. Making a new format AI-generation-eligible only ever required one thing: a
`normalizeSource.ts` branch that returns a real `NormalizedSourceContent` instead of a stub. No
file outside `src/domain/normalization/` changed for DOCX or XLSX.

- **DOCX**: a real WordprocessingML parser already existed in this codebase (built for the DOCX
  Reader, merged into history months ago) but `normalizeSource.ts`'s DOCX branch had never been
  wired to it — it was still returning a hardcoded `pending-extraction` stub, and the comment
  explaining why was stale (it described a branch-governance constraint that no longer applied).
  Wiring it was reuse, not new parsing code.
- **XLSX**: no parser existed. The two mature pure-JS candidates were both rejected after a real
  audit (SheetJS `xlsx`'s last npm release carries an unpatched CVE; `exceljs` is Node-oriented and
  a poor fit for React Native) — see "Dependencies" below. A purpose-built, read-only SpreadsheetML
  reader was written instead, reusing `fflate` (already a dependency) with the same security
  architecture already proven for DOCX.
- **Image/OCR**: no OCR capability existed. A real, audited, on-device candidate
  (`expo-mlkit-ocr`) was found and is documented in full below — but was **not wired in**, because
  the audit surfaced a concrete compatibility gap (its own `devDependencies` target Expo SDK 55 /
  RN 0.82, one version ahead of this project's SDK 54 / RN 0.81.5) that cannot be resolved without
  an actual native rebuild this environment cannot perform, on a feature this repository's own
  architecture doc explicitly lists extraction-vendor selection as an open founder decision for.
- **Audio/transcription**: no transcription capability existed. The strongest real candidate
  (`expo-speech-recognition`) is mature and heavily used, but its file-based transcription feature
  requires either a specific raw-audio sample rate Interval's arbitrary imported audio isn't
  already in (no on-device resampling capability exists in this codebase), or network-based
  (cloud) recognition by default when no on-device language model is pre-downloaded — a real
  privacy-posture change for private study audio, not a small wiring task. Blocked; needs its own
  architecture phase, exactly as the mission's own escape hatch anticipates.
- **Video**: confirmed, directly, that no video `SourceType`, no FFmpeg/video-processing
  dependency, and no audio-extraction-from-video capability exists anywhere in this codebase.
  Recommendation only, not implemented.

## Format support matrix

| Format | Extraction method | Dev generation support | Provenance | Native dependency | Offline | Status |
| --- | --- | --- | --- | --- | --- | --- |
| TXT | `textAdapter.ts` (pre-existing) | Yes | `charRange` + `lineRange` | None | Yes | **IMPLEMENTED** (unchanged) |
| PDF | `pdfAdapter.ts` + `pdfTextExtraction.ts` (pre-existing, `expo-pdf-text-extract`) | Yes | `page` + source-wide `charRange` | `expo-pdf-text-extract` | Yes | **IMPLEMENTED** (unchanged) |
| DOCX | `docxAdapter.ts` (new wiring) → existing `sourceReaderDocx.ts`/`docxContent.ts` | Yes | `blockIndex` + `heading` | `fflate` (pre-existing) | Yes | **IMPLEMENTED** |
| XLSX | `spreadsheetAdapter.ts` (new, purpose-built) | Yes | sheet/row context in chunk text (see below) | `fflate` (pre-existing) | Yes | **IMPLEMENTED** |
| Image | none | No | source identity only | none wired | N/A | **BLOCKED** — audited candidate exists, not wired (see below) |
| Audio | none | No | none | none wired | N/A | **BLOCKED** — needs its own architecture phase (see below) |
| Video | none (no `SourceType`) | No | N/A | none | N/A | **FUTURE** — feasibility only, not implemented |
| PPTX | none | No | none | none | N/A | **FUTURE** — out of scope for this batch (not requested) |

## DOCX implementation

See `docs/source-normalization-foundation.md`'s "DOCX adapter integration" section for the full
architecture record (file-by-file, exactly what changed and why the old "unmerged branch" comment
was stale). Summary: `mapDocxBlocksToGenericBlocks` + `normalizeDocxSource`
(`src/domain/normalization/docxAdapter.ts`) reuse the existing `readDocxArchive`/`DocxBlock[]`
completely as-is. `normalizeSource.ts`'s `docx` branch now resolves/stages/reads the file exactly
like `text`/`pdf` do. 17 new deterministic tests in `docxAdapter.test.ts` (listed under "Tests"
below) cover ordering, heading-context tracking, table-row flattening, empty/malformed/too-large
handling, determinism, and direct compatibility with the generic coverage layer.

**Preserved exactly as instructed:**
- Document order (block index order, never reordered).
- Headings/paragraphs/list items/table rows distinguished via `blockType`.
- No invented Word page numbers — DOCX has no reliable page concept client-side; none is
  fabricated.
- `charRange` stays omitted for `contentKind: "structured-text"` — the existing, deliberate
  contract (see `docs/source-normalization-foundation.md`'s Provenance model table) is unchanged.
- TXT/PDF behavior: zero lines changed in `textAdapter.ts`/`pdfAdapter.ts`/`pdfTextExtraction.ts`.

## XLSX implementation

See `docs/source-normalization-foundation.md`'s "XLSX normalization" section for the full
architecture record. Summary: a purpose-built SpreadsheetML reader
(`src/domain/normalization/spreadsheetAdapter.ts`) parses `xl/workbook.xml` (sheet names/order),
`xl/_rels/workbook.xml.rels` (sheet → part path), `xl/sharedStrings.xml` (string table, including
multi-run rich text), and each `xl/worksheets/sheetN.xml` (rows/cells, including shared-string,
numeric, boolean, error, formula-cached-value, and inline-string cell types) via `fflate` with the
same pre-inflation allow-list/size-ceiling defense already proven for DOCX. 15 new deterministic
tests in `spreadsheetAdapter.test.ts` cover header/data-row rendering, sparse rows, booleans,
errors, formulas (cached value only), multi-run inline strings, multi-sheet ordering,
empty/malformed/too-large handling, and compatibility with the generic coverage layer.

**Representation:** each sheet renders as `Sheet: <name>` / `Columns: <first row>` / `Row N: <cells
joined with " | ">`; the whole workbook's text is then chunked by the existing `segmentText()` —
no new chunking strategy, no new provenance field. A cell absent from the XML becomes an honest
empty slot at its real column position (Excel omits blank cells from the XML entirely) — never
dropped, never fabricated.

**What is deliberately NOT represented:** a formula's source text (`<f>…</f>`) — only its
already-computed, cached value (`<v>…</v>`) is used, the same value Excel itself displays; no
formula is evaluated by this adapter. Images/charts/drawings embedded in a workbook are never
extracted (not accepted by the archive's own allow-list — they're simply absent from the output,
same honest-omission posture as DOCX's image blocks). Cell formatting/styles are not represented.

## Image / OCR — BLOCKED, audited candidate documented for a founder decision

**No OCR capability exists anywhere in this codebase today** (confirmed via full-repo grep —
every match was inside a comment explaining the absence). `imageAdapter.ts` is unchanged in this
batch.

### Candidates investigated

| Package | Version | Stars | Downloads/mo | Last push | Engine(s) |
| --- | --- | --- | --- | --- | --- |
| `expo-mlkit-ocr` | 0.2.7 | 39 | ~15,000 | 2026-05-06 | iOS: Apple Vision (default) or Google ML Kit (opt-in); Android: Google ML Kit |
| `rn-mlkit-ocr` | 0.3.1 | 31 | ~4,000 | 2026-01-22 | ML Kit (both platforms) |
| `expo-ocr-kit` | 0.1.4 | — | ~11,000 | 2026-04-08 | ML Kit (Android) / Vision (iOS) |
| `react-native-nitro-ocr` | 0.1.0-beta.0 | 1 | ~500 | 2026-03-13 | Apple Vision / ML Kit, Nitro Modules |

`react-native-nitro-ocr` was ruled out immediately: pre-1.0 beta, 1 star, never left beta since
March 2026 — effectively abandoned-looking. `expo-mlkit-ocr` was the strongest remaining
candidate by every maintenance signal (downloads, stars, recency) and received a full source-level
audit, the same depth applied to `expo-pdf-text-extract` in the PDF batch:

- **iOS** (`ios/ExpoMlkitOcrModule.swift`, read in full): dual-engine — Google ML Kit Text
  Recognition v2 when linked, with a genuine Apple Vision (`VNRecognizeTextRequest`) fallback for
  arm64-only simulator runtimes where Google's MLKit CocoaPod binary can't link. Real, specific
  error codes (`INVALID_URI`, `IMAGE_LOAD_FAILED`, `RECOGNITION_FAILED`). Returns real block/line/
  word-level bounding boxes from the underlying engine — never fabricated.
- **Android** (`android/.../ExpoMlkitOcrModule.kt`, read in full): Google's own
  `com.google.mlkit:text-recognition:16.0.1` (first-party, mature, widely used). Clean error codes
  (`NO_CONTEXT`, `IMAGE_LOAD_FAILED`, `RECOGNITION_FAILED`). Same block/line/element structure as
  iOS.
- **No cloud service, no vendor API key, no network call** — 100% on-device on both platforms by
  default.
- **Podspec** (`ios/ExpoMlkitOcr.podspec`, read in full): declares `s.platform :ios, '16.0'`,
  gated behind an `ENV['EXPO_MLKIT_OCR_DISABLE_MLKIT']` flag the package's own config plugin
  (`plugins/withMlkitSimulatorArm64Fix.js`, read in full) sets to `1` **by default** ("auto" mode)
  — meaning, by default, the Google ML Kit CocoaPod is never even installed on iOS and the module
  silently falls back to Apple Vision unconditionally, not only on simulators. This is a real,
  non-obvious behavior difference from what the package's own name ("mlkit-ocr") implies, and
  would need to be understood and documented accurately, not assumed.

### Why this was NOT wired in

Two concrete, specific findings — not a generic "too risky" — drove the stop:

1. **SDK-version mismatch.** The package's own `package.json` `devDependencies` pin
   `"expo": "^55.0.18"` and `"react-native": "0.82.1"` — one Expo SDK major and one RN minor ahead
   of this project (`expo: ~54.0.29`, `react-native: 0.81.5`). The package was built and tested
   against a newer Expo Modules API surface than this project currently runs. `peerDependencies`
   are permissive (`"expo": "*"`), so `npm install` would not refuse it, but that does not confirm
   runtime compatibility with SDK 54 — only a real native rebuild against this project's actual
   toolchain could.
2. **Lazy-import safety is unverified.** `src/ExpoMlkitOcrModule.ts` (the package's own JS
   wrapper) calls `requireNativeModule('ExpoMlkitOcr')` at **module scope** (import time), not
   inside a function — unlike `expo-pdf-text-extract`'s own wrapper, which exposes a safe
   `isAvailable()` that never throws. Depending on how Expo's `requireNativeModule` behaves when
   the native module isn't yet linked (Expo Go, or before this project's own native rebuild), a
   bare `import` of this package could throw at app-bundle-load time rather than degrading
   gracefully — the exact risk `pdfTextExtraction.ts`'s own isolation pattern exists to prevent.
   This repository has no device/simulator available to empirically verify the real behavior, and
   a wrong guess here risks the WHOLE app failing to start, not just OCR being unavailable.

Combined with `docs/library-and-source-architecture.md` §17 explicitly listing "Extraction
providers (per format)" as an open founder decision, and the real, concrete (not hypothetical)
compatibility gap above, this cleared the bar for "STOP and report instead of forcing
implementation" — the same escape hatch the mission text itself provides.

### What a founder-approved follow-up would need

1. Confirm `expo-mlkit-ocr` (or a re-audited alternative) against this project's actual SDK 54 /
   RN 0.81.5 toolchain via a real `npx expo prebuild` + native build — not just a version read.
2. If compatible: wire `src/domain/normalization/ocrOutcome.ts` (pure, testable status/error
   mapping — same shape as `pdfExtractionOutcome.ts`) and an isolated `ocrExtraction.ts` wrapper
   (same isolation pattern as `pdfTextExtraction.ts`, with `isAvailable()` verified to never throw
   before any other code imports it) around whichever engine is approved.
3. `imageAdapter.ts` would resolve/stage the image file (same pattern as `text`/`pdf`/`docx`),
   call the wrapper, and chunk the recognized text with `segmentText()` — same reuse pattern as
   every other format. OCR output is untrusted text, handled with the same "never log content,
   never fabricate" posture already applied everywhere else in this codebase.
4. Provenance: source-image identity only (`heading`/`page`/`charRange` all stay unset unless the
   chosen engine's block/line regions are deliberately surfaced later) — never a fabricated
   bounding box or page number.
5. OCR quality depends on image resolution, handwriting, lighting, skew, and font — this must be
   stated plainly in product copy; handwriting recognition specifically must never be claimed as
   supported without separate verification (ML Kit/Vision both handle it inconsistently).

## Audio / transcription — BLOCKED, needs its own architecture phase

**No transcription capability exists anywhere in this codebase today** (confirmed via full-repo
grep). `audioAdapter.ts` is unchanged. `expo-speech` (already a dependency) is **text-to-speech**
— the opposite direction — and is unrelated; it is not a false lead this report is correcting, but
worth stating explicitly since the package name is easy to mis-grep for.

### Candidate investigated

`expo-speech-recognition` (jamsch) — by far the strongest candidate found: 697 GitHub stars,
~2.9M npm downloads/month, actively maintained (pushed within the last week of this audit),
wrapping the native, first-party `SFSpeechRecognizer` (iOS) / `SpeechRecognizer` (Android) system
APIs. Its README documents a genuine file-based transcription feature (`audioSource.uri`), not
just live-microphone streaming.

### Why this was NOT wired in

Two concrete technical findings, read directly from the package's own documentation:

1. **Arbitrary imported audio isn't already in a compatible shape.** The README's own verified
   format table lists specific working inputs: 16000 Hz 16-bit mono PCM WAV, and 16000 Hz MP3
   (mono or stereo) — i.e. a **specific sample rate**. Interval's audio sources are whatever a user
   imports (arbitrary bitrate/sample-rate MP3, M4A, AAC, WAV, etc. — nothing in this codebase
   normalizes that). Getting an arbitrary file into a verified-working shape would need an audio
   decode/resample step this codebase has no capability for today (`expo-audio` is playback-only;
   no raw-PCM/transcoding API is exposed anywhere). Adding one would itself be a new, non-trivial
   native audio-processing subsystem — exactly the kind of scope the mission's own Audio section
   explicitly says to avoid casually introducing.
2. **Reliable offline recognition is not guaranteed, and the fallback is network-based.** The
   package's own troubleshooting section states that for most devices, "you likely won't see any
   locales installed" for on-device recognition unless `androidTriggerOfflineModelDownload()` is
   explicitly called and the user completes a model download — a real UX dependency this codebase
   has no flow for. Without on-device recognition, transcription is **network-based** (the audio
   is streamed to a cloud recognition service — Google's or Apple's, by platform) by default. For
   source content that may be private lecture/study audio, defaulting to cloud transcription
   without an explicit, informed opt-in is a real privacy-posture decision, not a mechanical
   wiring task — and no transcription vendor/privacy posture has been founder-approved (see
   `docs/library-and-source-architecture.md` §17).

Per the mission's own explicit instruction — "If robust transcription requires new cloud
infrastructure, STOP and report that Audio needs its own architecture phase" — this is exactly
that case, reached through direct technical findings rather than assumption.

### What a future architecture phase would need to resolve

1. A founder decision on on-device-only vs. cloud-assisted transcription, and, if cloud-assisted,
   which vendor and what privacy disclosure/consent flow.
2. If on-device-only: either an audio decode/resample capability (new native subsystem) to get
   arbitrary imported audio into a recognizer-compatible shape, or a constraint that only
   already-compatible audio files are eligible (a real product limitation to disclose, not hide).
3. A UX flow for the Android offline-model-download dependency (silent failure otherwise).
4. Timestamp provenance only if the chosen path genuinely provides it — never invented precision
   (the existing `ChunkProvenance.timeRangeMs` field already anticipates this, unused today).

## Video — feasibility conclusion (not implemented, per explicit instruction)

Confirmed directly: `SourceType` (`src/models/librarySource.ts`) has no `video` member; no
`video/*` MIME or `.mp4`/`.mov` extension exists in the format table
(`src/domain/librarySourceFormat.ts`); no FFmpeg or video-processing dependency exists in
`package.json`; `expo-audio` (playback-only) exposes no audio-extraction-from-video capability.
Video files are correctly handed off via "Open original" today and never routed to any reader.

A future video pipeline would conceptually be `Video → audio/transcript extraction → normalized
transcript → existing AI pipeline` — but extracting audio from video client-side realistically
needs either an FFmpeg-class native dependency (meaningful binary size increase, meaningful native
complexity) or a cloud media-processing service, and transcription itself is already a blocked,
unresolved architecture question (see above) that video would inherit on top. This is explicitly
**not implemented** in this batch, per instruction, and is recorded here only as a future
recommendation: do not attempt video ingestion without first resolving Audio's own open
architecture questions, since video's transcript step depends entirely on them.

## Generic normalization architecture (confirmed, not just designed)

Every file in the generation chain — `contextPreparation.ts`, `generationAvailability.ts`,
`generationCoverage.ts`, `generateDeckFlow.ts`, `aiService.ts`, `responseValidation.ts`,
`generateDeckSession.ts` — was read in full for this batch and contains **zero** `sourceType`/
format-specific branching. DOCX and XLSX becoming generation-eligible required editing exactly one
file outside `src/domain/normalization/`: none. (The screens render whatever
`generationAvailability.ts` already told them to, unchanged.) There is still exactly one Generate
Study Deck workflow — no `generateFromDocx()`/`generateFromXlsx()` ever existed or was
considered.

## Provenance strategy by format

| Format | Provenance | Notes |
| --- | --- | --- |
| TXT | `charRange` + `lineRange` | Unchanged |
| PDF | `page` + source-wide `charRange` | Unchanged — see `docs/ai-pdf-generation.md` |
| DOCX | `blockIndex` + `heading` | No `charRange` (deliberate, pre-existing `structured-text` contract) |
| XLSX | none in `ChunkProvenance` — sheet/row context lives in the chunk's own text (`Row 12: ...`) | Deliberate, per the mission's own instruction not to redesign provenance for this; `charRange`/`lineRange` ARE populated (reused from `segmentText`) and cite real lines of the generated per-sheet text |
| Image (if later implemented) | source identity only, never a fabricated bounding box | See "Image / OCR" above |
| Audio (if later implemented) | `timeRangeMs` only if genuinely provided | Field already reserved, unused today |

`sourceChunkIds` remains mandatory on every generated card for every format — unchanged,
enforced by the pre-existing `responseValidation.ts`, never touched in this batch.

## Coverage behavior (reused generically, not reimplemented)

DOCX and XLSX content flows through the exact same `prepareGenerationContext` /
`generationCoverage.ts` (`fullSourceIncluded`, `includedChunkCount`/`totalChunkCount`,
`hasTrustworthyChunkScope`, `deriveFewerCardsExplanation`, the "Up to N cards" options-screen
copy, the setup/review disclosure UI) that TXT/PDF already use — confirmed by direct test, not
assumption: `docxAdapter.test.ts` and `spreadsheetAdapter.test.ts` each include a test that feeds
real DOCX/XLSX-produced `NormalizedSourceContent` into `prepareGenerationContext` and asserts
honest `fullSourceIncluded`/`excludedChunkCount` reporting, identical in shape to the TXT/PDF
tests already in `contextPreparation.test.ts`. No format-specific coverage UX was created.

## Error handling

Every new adapter reuses the existing `ExtractionStatus` vocabulary (`ready` / `empty` / `failed`
/ `too-large`; `unsupported` remains reachable only for image/audio/pptx) — no new status was
added. Encrypted/unrecognized DOCX and XLSX archives are deliberately mapped to `failed` (not
`unsupported`) in `normalizeSource.ts`, mirroring PDF's own password-protected handling: in
Generate Study Deck specifically, `unsupported` means "this format can never work," which would
misrepresent an otherwise-ordinary file that merely couldn't be opened this time. No raw parser
exception, native stack trace, filesystem path, or source content is ever surfaced — every mapped
outcome carries only a short diagnostic category, same posture as every existing adapter.

## Performance

`normalizeDocxSource`/`normalizeSpreadsheetSource` each read/parse their archive exactly once per
`normalizeSource()` call — no redundant re-opens. The pre-existing, already-documented
duplication (the options screen's availability check and the actual Generate tap each
independently call `normalizeSource()` once) is unchanged and applies identically to DOCX/XLSX —
not newly introduced here, not solved here. No persistent cache, no background job, and no
base64/giant native→JS payload was introduced: `fflate`'s `unzipSync` and the XML scanners here
operate on bounded, already-size-capped byte arrays exactly like DOCX's existing reader does.

## Dependencies

| Dependency | Added? | Version | Why / why not |
| --- | --- | --- | --- |
| `fflate` | No (pre-existing) | 0.8.3 | Reused for XLSX's zip reading — already audited for DOCX |
| `xlsx` (SheetJS) | **Rejected** | n/a | Last npm release (0.18.5, 2022) carries an unpatched GitHub Security Advisory (GHSA-4r6h-8v6p-xvw6 / CVE-2023-30533, prototype pollution); SheetJS's own advisory states no fixed version is available via npm |
| `exceljs` | **Rejected** | n/a | Node-oriented dependency tree (`tmp`, `archiver`, `unzipper`, `readable-stream`) — poor fit for a React Native runtime |
| `expo-mlkit-ocr` | **Not added** (audited, blocked) | 0.2.7 (candidate) | See "Image / OCR" above — SDK-version mismatch + unverified lazy-import safety |
| `expo-speech-recognition` | **Not added** (audited, blocked) | 58.0.0 (candidate) | See "Audio / transcription" above — needs an audio-decode subsystem and/or a cloud-ASR privacy decision this codebase doesn't have |

No new runtime dependency was actually added to `package.json` in this batch — DOCX and XLSX both
reuse `fflate`, already present.

## Security / privacy

Unchanged posture from every existing adapter: no OCR output, transcript, spreadsheet content,
document content, card content, prompt, auth token, or private filename is ever logged — only
metadata/category-level diagnostics (source type, extraction status, chunk/row counts, a
diagnostic reason string), via the existing `logNormalization` helper (development builds only).
DOCX/XLSX archive contents are treated as untrusted user input end to end, with the same
pre-inflation allow-list and size-ceiling defense already proven for DOCX, now also applied to
XLSX. The mobile client still never holds a provider secret — nothing in this batch changes that.

## Tests

New: `docxAdapter.test.ts` (17 tests), `spreadsheetAdapter.test.ts` (15 tests) — both zero
network/native-module dependency, run under plain `node --test` via the existing `test:ai` glob.
Combined with the existing suite, `npm run test:ai` now reports the count recorded in "Validation
results" below. No existing test was weakened or removed.

## Localization

`generateDeck.unavailable.pendingBody` (the one string that explicitly named "Text (.txt) sources
and PDFs" as what's supported) was reworded to a generic, format-list-free sentence across all 13
locales (`en, es, fr, pt-BR, it, de, nl, ru, zh-Hans, ja, ko, hi, ar`) — it no longer goes stale
every time a new format becomes eligible. No other Generate Study Deck copy named a specific
format list that needed updating; the rest of the UI (coverage disclosure, card-count framing,
provenance labels) was already generic over format from the prior batch.

## Founder QA checklist

**DOCX:**
1. Attach a simple `.docx` (a few paragraphs), confirm Generate Study Deck is now offered (no
   longer "not ready yet").
2. Attach a `.docx` with headings — confirm generated cards cite "From heading context" correctly
   by checking the review screen's provenance (a heading/paragraph relationship).
3. Attach a `.docx` with a table — confirm table rows are readable as source material.
4. Attach a long `.docx` — confirm generation completes and partial-coverage disclosure appears
   if it exceeds the context budget.
5. Attach an empty or image-only `.docx` — confirm the honest "no usable text" state.
6. Attach a password-protected `.docx` — confirm a friendly failure state with Retry (not "not
   supported").

**XLSX:**
1. Attach a simple spreadsheet (one sheet, a header row, a few data rows) — confirm Generate Study
   Deck is now offered.
2. Attach a multi-sheet workbook — confirm each sheet's content is distinguishable in generated
   cards' source material.
3. Attach a workbook with formulas — confirm the computed values (not raw formula text) inform
   generation.
4. Attach an empty workbook — confirm the honest "no usable text" state.
5. Attach a very large workbook (thousands of rows) — confirm an honest "too large" state, not a
   silent truncation or crash.

**Generic (both formats):**
6. Confirm Generate appears ONLY when the source is actually eligible (no false positives for
   image/audio/pptx).
7. Confirm generation reaches the real Nova 2 Lite path (Development), not `[MOCK]`.
8. Confirm generated cards are grounded in the source (spot-check a few cards against the actual
   document/sheet content).
9. Confirm provenance displays correctly for DOCX (heading-based) and that XLSX cards look
   reasonable without a numeric citation (by design — see "Provenance strategy" above).
10. Edit, save, and review a DOCX- and an XLSX-generated draft exactly like a TXT/PDF one.
11. Confirm fewer-than-requested cards for a small DOCX/XLSX source shows the honest "material
    didn't support more" explanation, not an error.
12. **Regression: TXT and PDF generation behave exactly as before** (no change expected).

## Known limitations

- Image/audio generation remains unavailable — audited, documented, explicitly not implemented
  this batch (see sections above).
- XLSX provenance is text-embedded only (no structured sheet/row `ChunkProvenance` field) — a
  deliberate choice to avoid broad provenance-system churn, not an oversight.
- XLSX formula text itself is never shown or evaluated — only cached values.
- DOCX/XLSX embedded images/charts/drawings are never extracted or described.
- No automated test exercises `normalizeSource.ts`'s actual DOCX/XLSX dispatch wiring end-to-end
  (it depends on `expo-file-system`'s `File` class, same untestable-under-plain-`node --test`
  category as the pre-existing PDF/text wiring) — the pure adapter logic
  (`docxAdapter.ts`/`spreadsheetAdapter.ts`) is fully tested; the wiring itself is covered only by
  founder runtime QA, same precedent as every other adapter in this file.
- No native rebuild or on-device testing has been performed from this environment for ANY of this
  batch's changes (DOCX/XLSX included) — static checks pass, but this is not yet founder-QA
  verified on a real build.

## Deferred architecture work

- Image/OCR: founder decision on vendor (see "What a founder-approved follow-up would need"
  above), then a real native-rebuild compatibility check before wiring.
- Audio/transcription: its own architecture phase — vendor/privacy-posture decision, plus either
  an audio-decode subsystem or an accepted format-compatibility constraint (see "What a future
  architecture phase would need to resolve" above).
- Video: entirely future — depends on Audio's own open questions being resolved first.
- PPTX: out of scope, not requested this batch.

## Confirmation of scope boundaries

No backend route, AI provider, model, or request schema changed. Bedrock/Nova 2 Lite is
unchanged. No embeddings, vector DB, RAG, agent/tool-calling, retry-to-fill-card-count, or
minimum-card-count logic was added. No AWS resource was deployed; no CDK/IAM/API Gateway file was
touched. No EAS/Staging/Production configuration changed — Staging remains mock, Production
Generate remains gated off, exactly as before this batch.
