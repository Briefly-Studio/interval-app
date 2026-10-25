# Flashcard Import

Format-neutral import of existing flashcard decks into Interval, so a user moving from another
tool does not have to manually recreate their cards. This is an **import** feature, not a
general-purpose file reader and not an AI feature — see "Hard out of scope" below.

**Status: CSV/TSV (Quizlet-compatible) import is implemented. Anki `.apkg` import is
investigated and explicitly blocked for this batch — see "Anki support level" below for the full
reasoning.** No backend/AWS/CDK/EAS/Staging/Production change. No new npm dependency was added —
CSV/TSV parsing is pure string logic, reusing the app's existing creation/persistence contracts.

## Architecture

A format-neutral boundary (`src/domain/import/`) keeps parsing and persistence strictly separate:

```
FlashcardImportSource (a file)
  → parser                              (format-specific; today: csvTsvParser.ts)
  → ImportedDeckDraft                    (src/domain/import/types.ts)
  → preview                              (app/import-flashcards/preview.tsx, read-only)
  → explicit user confirmation
  → ordinary Interval DeckRecord/CardRecord  (importDeckSave.ts)
```

- `ImportedDeckDraft = { name, cards: ImportedCardDraft[], warnings: ImportWarning[], metadata? }`
- `ImportedCardDraft = { front, back, sourceDifficulty? }`

No parser ever touches storage. `src/domain/import/importDeckSave.ts` is the only place anything
is written, and only after the user taps the preview screen's confirm button. A parsed draft that
is never confirmed writes nothing at all — it only ever lives in an in-memory session
(`src/domain/import/importDraftSession.ts`, mirroring `generateDeckSession.ts`'s exact
`useSyncExternalStore` pattern) and disappears if the app is killed mid-preview, by design.

This is a **separate feature** from the existing `/import` screen
(`src/domain/deckPortability.ts`'s `importDeckFromJson`), which handles Interval's own
`.interval`/legacy `.briefly` JSON export format. Both are reachable from Home and Settings, under
distinct labels ("Import deck" vs. "Import flashcards"), and neither was modified by the other.

## CSV/TSV (Quizlet) import — implemented

`src/domain/import/csvTsvParser.ts`'s `parseDelimitedFlashcards(raw, { fileName? })` is pure,
dependency-free, and never throws for ordinary malformed input.

**Delimiter detection:** any tab character anywhere in the file selects TSV mode (simple
split-on-first-tab per line, matching how Quizlet's own TSV export is actually shaped —
unquoted); otherwise CSV mode, with a full RFC-4180-style tokenizer (`tokenizeCsv`) supporting
quoted fields, embedded commas, embedded newlines inside a quoted field, and `""` as an escaped
literal quote.

**Header-row handling:** the first row is compared against a small curated list of common
header-pair labels (`term`/`definition`, `front`/`back`, `question`/`answer`, `word`/`meaning`,
`prompt`/`answer`, `front text`/`back text`), case-insensitive, **exact match on both cells only**
— never a prefix or fuzzy match, so a genuine flashcard whose front happens to start with "term"
is never mistaken for a header. A matched header row is skipped with a `header-row-skipped`
warning; anything else is imported as a normal card, including a first row that merely looks like
real content (e.g. "terminology" / "definitions are fun").

**Row validation (never silent):**
- A row missing a front or back (after trimming) is skipped, counted under
  `rows-skipped-empty`.
- A field longer than the limits below is skipped, counted under `rows-skipped-too-long` —
  **never silently truncated**.
- A row that can't even be split into two fields is skipped, counted under
  `rows-skipped-malformed`.
- Blank lines are silently skipped (never counted or imported as empty cards).

**Deduplication:** exact duplicate rows (same front *and* back, byte-for-byte after trimming)
within one import are detected and counted under `duplicates-found` — **both copies are kept**,
never silently removed. Two cards that only *look* similar (different case, extra whitespace,
etc.) are never flagged — this is intentionally conservative, per the mission's "do not
aggressively deduplicate" instruction. Nothing here ever compares against, merges into, or removes
cards in any *other* existing Interval deck.

**Deck name:** derived from the picked file's name (extension stripped, `_`/`-` replaced with
spaces, trimmed); editable on the preview screen before confirming, same as Generate Study Deck's
editable title.

## Anki `.apkg` support — investigated, explicitly blocked

The architecture above is deliberately format-neutral so an Anki parser could plug into the same
seam later. It is not built in this batch. This section documents why, in detail, so a future
attempt starts from the real constraints rather than re-discovering them.

**What a modern `.apkg` actually contains.** It is a ZIP archive. Historically it held
`collection.anki2` (plain SQLite, schema v11) plus a media manifest. **Since Anki 2.1.55
(December 2022), the DEFAULT export instead writes `collection.anki21b` — a Zstandard
(zstd)-compressed SQLite database** — with a dummy `collection.anki2` alongside it purely for
backward compatibility with older importers that don't know about the new format. Anki does offer
a "Support older Anki versions" / "Legacy support" export checkbox that produces the old
uncompressed `collection.anki21` (schema v11, explicitly Anki's own "Maximum Compatibility" mode)
— but that requires the *exporting* user to proactively tick it, which most real-world files
handed to this app will not have. Anki's own developers describe the package format as not a
public, stable API.

**What reliably parsing the default format would require:**
1. **ZIP extraction** — already solved; `fflate` is already an Interval dependency (used by the
   DOCX/XLSX readers and AI adapters).
2. **SQLite parsing** — would need a new native dependency. `expo-sqlite` (Expo's own official
   module, MIT-licensed, actively maintained, SDK-54-recommended version `~16.0.10`) is the
   right *category* of solution — not a forbidden "Node-only SQLite implementation" — but it
   requires a native rebuild (iOS needs `pod-install`), and genuinely opening an arbitrary
   externally-supplied database file (not one the app created itself) needs copying it into
   `expo-sqlite`'s managed SQLite directory first; there is no single-call "open this exact file"
   API confirmed for the installed SDK version.
3. **Zstandard decompression** — the actual blocker. The only pure-JS zstd decoder
   (`fzstd`, by the same author as `fflate`) has had no commits since March 2024 (roughly two and
   a half years of no maintenance as of this audit) and documents real correctness limits
   (a maximum backreference distance of 2^25 bytes, and files using "ultra" compression with
   >32MB decompressed output may not decompress correctly) — exactly the kind of edge case an
   *untrusted, arbitrary user-supplied* file cannot be assumed to avoid. WASM-based alternatives
   carry unconfirmed Hermes/React Native compatibility (community reports suggest at least one
   popular WASM SQL library has had Hermes problems, pushing people toward `expo-sqlite`
   instead).
4. **Schema-version-aware parsing** — the note/card/template/model schema itself has evolved
   (e.g. notetypes stored as a JSON blob in `col.models` in older schemas vs. relational
   `notetypes`/`templates`/`fields` tables in newer ones), so even with (1)-(3) solved, correct
   parsing isn't "run one SQL query" — it's schema-version detection plus per-version logic.

No actively-maintained, React Native/Expo-compatible, trustworthy all-in-one `.apkg` parser was
found in the npm ecosystem during this audit (several JS/TS candidates exist — `anki-reader`,
`anki-apkg-parser`, `apkg-reader`, `@seangenabe/apkg` — but each is either Node-only, explicitly
WIP, or has no confirmable recent-maintenance signal).

**Decision: STOP Anki implementation for this batch**, per this mission's own escape valve for
exactly this situation. The deciding factor is not "SQLite is hard" or "a native module is
scary" — it's that *reliably* parsing the default, most-common real-world export would put an
unmaintained decompression library with known correctness gaps in the path of untrusted binary
input, which is a real security/data-integrity risk, not a style preference. Revisiting this is a
separate, founder-gated decision that should weigh: requiring users to export with "Support older
Anki versions" ticked (sidesteps zstd entirely, at the cost of a non-obvious prerequisite most
users won't know to set) vs. adding `expo-sqlite` + a vetted zstd solution (native rebuild
required) vs. waiting for the ecosystem to produce a trustworthy maintained option.

### Anki features audited, for the record

Had implementation proceeded, the following would have needed explicit handling — recorded here
so a future attempt doesn't have to re-derive this list:

| Feature | Planned V1 treatment |
|---|---|
| Standard front/back notes | Primary target |
| Multiple note types | Only the standard "Basic" shape would be trusted; others degraded to "unsupported note type" with a warning, never guessed |
| Templates / HTML / CSS | HTML sanitized to readable text; CSS discarded (no WebView, no style fidelity) |
| Cloze deletion | Only convertible if the mapping to front/back is unambiguous; otherwise skipped with a warning, never guessed |
| Media (images/audio) | Deferred — no cloud/local media pipeline for imported binaries in this batch |
| Reversed/template-generated cards | Only mapped if trustworthy; otherwise skipped |
| Suspended/buried cards | Would still import as ordinary New cards — Anki's suspend/bury state has no Interval equivalent and would not be invented |
| Anki review/scheduling history | **Never migrated into Interval `ReviewEvent`s** — see "Scheduling" below; this holds regardless of whether Anki import itself is ever built |
| Nested deck names (`Parent::Child`) | Would need an explicit flattening/naming decision, not yet made |
| Duplicate cards | Same conservative policy as CSV/TSV: detect and warn, never silently remove |

## Scheduling

An imported card is **never** given fabricated review history. `importDeckSave.ts` never creates
a `ReviewEvent` or a `CardSchedulingState` record — it only creates an ordinary `CardRecord` via
the exact same `upgradeCard`/`setCards` path every hand-created card uses. A freshly imported card
therefore simply has no scheduling entry yet, which
`resolveCardSchedulingState`/`recomputeCardSchedulingState`
(`src/domain/scheduling/migration.ts`, `recomputeCardSchedulingState.ts`) already treat
identically to any other never-reviewed card: honest "New," immediately eligible, zero stability
or difficulty. It enters scheduling for the first time only after a real Interval review, exactly
like any manually created card. This holds for CSV/TSV today and would hold for a future Anki
importer too — **mapping Anki's own review history into Interval `ReviewEvent`s is explicitly not
attempted** unless a provably correct mapping is designed as its own separate, explicit, founder-
approved piece of work; it is not something this or any future batch should back into
incidentally.

## Security and limits (`src/domain/import/importLimits.ts`)

Every imported file is treated as untrusted:

- `MAX_IMPORT_FILE_BYTES` (5 MB) — checked against the picked file's own reported size before any
  read begins.
- `MAX_IMPORT_LINE_LENGTH` (20,000 characters) — guards against a single pathological line (e.g.
  one unbounded quoted field) before per-field checks even run; an unsplittable file entirely over
  this length fails as `no-readable-rows` rather than being tokenized.
- `MAX_IMPORT_FRONT_LENGTH` (300) / `MAX_IMPORT_BACK_LENGTH` (500) — identical to the existing
  Generate Study Deck review-field ceilings (`responseValidation.ts`), so an imported card can
  never be larger than a generated or hand-typed one.
- `MAX_IMPORT_CARDS` (2,000) — rows beyond this are dropped with an explicit
  `cards-truncated-at-limit` warning (count = how many), never silently.

No filesystem path, raw parser exception, or stack trace is ever surfaced to the user — every
failure is a structured `ImportParseFailure`/`ImportWarning` code mapped to a fixed, localized
string (see `app/import-flashcards/index.tsx` and `preview.tsx`). CSV/TSV content is plain text;
nothing here executes or evaluates imported content in any way.

## Preview / confirm behavior

`app/import-flashcards/index.tsx` (pick + parse) → `app/import-flashcards/preview.tsx` (review +
confirm). The preview screen shows: the editable proposed deck name, a card count, up to 5 sample
cards (front/back), every structured warning in plain language, and a count-aware "Import N
cards" confirm button. **Nothing is written until that button is tapped.** The preview screen
re-checks the active workspace/account against the scope the file was parsed in
(mirroring Generate Study Deck review's own scope guard) immediately before saving, and blocks
save with a recovery screen if it changed. Save uses a synchronous in-flight guard
(`saveInFlight` in `importDeckSave.ts`, plus a screen-level `savingRef`) and rolls the deck back
if card persistence fails partway, mirroring `generateDeckSave.ts`'s exact pattern.

## Known limitations

- **Anki `.apkg` import is not implemented** — see "Anki support level" above for the full,
  audited reasoning and the exact unmet prerequisites (native SQLite module + a vetted zstd
  decoder + schema-version-aware parsing).
- **No column-mapping UI** — the first two columns are always treated as front/back; a file with
  more columns has the extra columns silently ignored (not an error, not a warning — this matches
  "robust reading of a simple two-column export," not a full spreadsheet importer).
- **No manual delimiter override** — delimiter is auto-detected (any tab → TSV, else CSV); a file
  that is genuinely neither shape will simply parse as CSV and likely produce warnings/skips
  rather than offer a manual picker.
- **No per-card edit step during preview** — the preview screen's only edit affordance is the deck
  name; fixing an individual imported card's content happens afterward, in the deck, through the
  normal card-edit screen, same as for any other card.
- **File size ceiling (5 MB) and card ceiling (2,000)** are fixed constants, not configurable per
  environment.

## Founder QA

**CSV/TSV:**
1. Export a small set of terms from Quizlet (or hand-write a small TSV/CSV file).
2. Home or Settings → "Import flashcards" → choose the file.
3. Confirm the preview shows the right deck name (editable), card count, a few sample cards, and
   any expected warnings (e.g. a header row skipped).
4. Tap the confirm button and verify the deck is created with the right cards.
5. Open the deck and confirm every imported card shows as **New** in the Due/New/Not-due summary.
6. Rate one imported card with a real FSRS rating and confirm it schedules normally afterward.
7. Restart the app and confirm the deck/cards/scheduling state all persisted correctly.
8. If signed in on Development/Staging, run a sync and confirm the imported deck/cards sync like
   any other deck (no special "imported" marker, no scheduling history created).
9. Re-import a file containing an exact duplicate row and confirm both copies appear, with a
   duplicate-count warning on the preview screen.
10. Try a file over 2,000 rows and confirm the truncation warning's count is correct and the
    import still completes with the first 2,000.
11. Edit, delete, and soft-delete-then-restore an imported card and confirm it behaves exactly
    like a hand-created card throughout.

**Anki:** not applicable — `.apkg` import is not implemented in this batch (see above).
