# Library and Source Architecture

**Status: specification only. Nothing described in this document is implemented.** No Library
route, no upload code, no extraction pipeline, no AI generation, and no sharing beyond the
existing `.interval`/legacy `.briefly` deck file export/import exists in the app today. This
document exists to remove architectural ambiguity *before* implementation begins, per the
founder's product direction — not to describe current behavior.

Where this document says "must" or "should," it is a requirement for whenever this is built, not
a claim about what exists now. See `docs/branch-and-release-policy.md` for why none of this can
launch against the current single, unseparated backend environment.

## 1. What the Library is

**The Library is a user-owned collection of reusable source materials that can later be
transformed into multiple approved study artifacts. It is not merely an upload history.**

The distinction matters: an upload history is a list of files a user once added. A Library is an
asset a user keeps *because* it's reusable — the same calculus textbook chapter should be able to
produce a flashcard deck today, a practice exam next week, and a summary before a final, without
re-uploading anything. The product's value compounds the more a source gets reused, not the more
files get added.

### Core product loop

```
Upload or record once
  → organize the source (title, type, collection, tags)
  → extract and normalize content
  → create multiple draft study artifacts
  → Review & Approve
  → save approved artifacts
  → reuse the source later for something new
  → optionally share approved study artifacts (never the source itself, by default)
```

Every step after "upload or record once" can happen more than once, using the same source. That
repeatability is the point of a Library as opposed to a one-shot import.

### Supported future source categories

- PDF
- DOCX / Word
- PPTX / PowerPoint
- XLSX / Excel
- PNG
- JPEG
- Plain text
- Pasted notes
- Short-form voice input (see §9)
- Recorded lecture audio (see §9)
- Future Canvas-derived source metadata (see `docs/canvas-companion-spec.md`)
- Any other format only after explicit validation that it can be safely and usefully extracted —
  this list is not a promise to eventually support every format that exists.

## 2. Library information architecture

The Library needs more than one way to find something, because "what am I looking for" changes by
context — sometimes it's a title, sometimes it's "everything for this class," sometimes it's
"whatever I haven't touched yet."

### All Sources (default/flat view)

- Alphabetical (by display title)
- Recently added
- Recently used
- Oldest / newest
- Title search

### By Type

- PDFs
- Word documents
- Presentations
- Spreadsheets
- Images
- Audio recordings
- Text and notes
- Future Canvas sources

### By Collection

User-defined groupings, e.g.:

- Calculus
- AWS SysOps
- Fall 2026
- Midterm 1
- Certification material
- Research sources

### By Status

- Uploading
- Processing
- Ready
- Needs review
- Failed
- Unsupported
- Archived
- Recently Deleted

### How these coexist

Type, Collection, and Status are not mutually exclusive views the user picks once — they're
**filters that compose**. A user should be able to look at "By Type: PDFs" and then further
filter to "Collection: Calculus" and sort "Recently used," landing on the same underlying source
list, just narrowed and ordered differently. Alphabetical-by-title is one sort option among
several, not the primary or only organizing principle — it should not be the default if
"Recently used" would surface what a returning user actually wants faster.

### Metadata and filters

- Display title (user-editable, separate from original filename)
- Original filename
- File type
- MIME type
- Extension
- Size
- Date added
- Last used
- Collection(s)
- Tags
- Course
- Semester
- Processing status
- Page count / slide count / sheet count / audio duration, where applicable to the type
- Source language, where known
- Generated-artifact count (how many decks/quizzes/etc. have come from this source)
- Deletion state

## 3. Canonical source data model

This is a proposed domain model for planning purposes — field names and shapes to design against,
not a schema being created in this batch. No AWS-specific attribute naming (e.g. DynamoDB
single-table key conventions) is introduced here unless it's necessary for architectural clarity;
that level of detail belongs to an implementation batch, not this specification.

### `LibrarySource`

| Field | Purpose |
|---|---|
| `id` | Unique identifier |
| `ownerId` | Cognito `sub` of the owning user. **This is the cloud-record model, not a claim that every locally-created source begins authenticated** — see §18 for the full account/guest boundary this field depends on. A cloud `LibrarySource` row only exists once a source has actually been adopted into an authenticated account; local-only source metadata (before that point) must not assume a Cognito `sub` exists. Same trust model as existing sync data otherwise (see `CLAUDE.md`: never accepted from client input, always derived from the authenticated identity). |
| `originalName` | The filename as uploaded/recorded |
| `displayTitle` | User-editable title shown in the Library UI |
| `sourceType` | e.g. `pdf`, `docx`, `pptx`, `xlsx`, `image`, `text`, `audio` |
| `mimeType` | As reported by the upload/recording |
| `extension` | As reported — never trusted alone for type validation (see §11's storage/security principles) |
| `fileSize` | Bytes |
| `storageKey` (or storage reference) | Where the binary lives — an opaque reference, not a public URL |
| `checksum` | Where appropriate, for integrity/dedup purposes |
| `createdAt` / `updatedAt` | Standard timestamps |
| `lastUsedAt` | Updated whenever the source is used to generate something — this is what "Recently used" sorts on |
| `processingStatus` | e.g. `uploading`, `processing`, `ready`, `needsReview`, `failed`, `unsupported` |
| `processingErrorCode` | A stable, safe-to-log code — never a raw error message with potentially sensitive detail |
| `extractionVersion` | Which version of the extraction pipeline produced the current extracted content — allows re-extraction if the pipeline improves |
| `extractedTextReference` | Pointer to the extracted/normalized text, not the text inline |
| `sourceLanguage` | Where known/detected |
| `pageCount` / `slideCount` / `sheetCount` / `audioDuration` | Type-specific, populated where applicable |
| `collectionIds` | Which `SourceCollection`(s) this belongs to |
| `tags` | Free-form, user-defined |
| `courseId` | Optional link to a course context (manual today; potentially Canvas-derived later) |
| `semester` | Optional |
| `deletedAt` | Soft-delete tombstone, same pattern as `DeckRecord`/`CardRecord` (see `docs/sync-invariants.md`) — not a hard delete |

### `SourceCollection`

| Field | Purpose |
|---|---|
| `id` | Unique identifier |
| `ownerId` | Same trust model as above |
| `name` | e.g. "Calculus" |
| `description` | Optional |
| `createdAt` / `updatedAt` | Standard timestamps |
| `deletedAt` | Soft-delete tombstone |

### `SourceExtraction`

| Field | Purpose |
|---|---|
| `id` | Unique identifier |
| `sourceId` | Which `LibrarySource` this extraction belongs to |
| `extractionVersion` | See above |
| `status` | e.g. `pending`, `running`, `succeeded`, `failed` |
| `extractedTextReference` | Pointer to the normalized output |
| `structuralMetadata` | e.g. headings, page/slide boundaries, table locations — whatever structure the format-specific extractor can recover (see §8) |
| `createdAt` / `completedAt` | Standard timestamps |
| `failureCode` | Stable, safe-to-log code |

A source can have more than one `SourceExtraction` over time (e.g. after an extraction-pipeline
upgrade) — `LibrarySource.extractionVersion` points at the current one, but prior extractions
don't need to be discarded immediately.

### `GeneratedArtifactDraft`

| Field | Purpose |
|---|---|
| `id` | Unique identifier |
| `ownerId` | Same trust model as above |
| `sourceIds` | Which source(s) this draft was generated from — plural, since a future multi-source generation is plausible |
| `artifactType` | e.g. `deck`, `quiz`, `summary`, `practiceExam`, `studyGuide` |
| `title` | Draft title, editable before approval |
| `generationSettings` | What the user asked for (depth, quantity, difficulty, artifact type) — see §10 |
| `status` | e.g. `draft`, `approved`, `rejected` |
| `draftPayload` | The actual generated content, in draft form, before it becomes real deck/card/etc. data |
| `createdAt` | Standard timestamp |
| `approvedAt` / `rejectedAt` | Set on the Review & Approve decision |
| `savedDeckId` / `savedArtifactId` | Once approved, points at the real, saved artifact this draft became |
| `provenance` | Which source(s) and which section(s)/page(s)/timestamp(s) this content traces back to |

### Lifecycle summary

`LibrarySource` → (async) → `SourceExtraction` → user requests generation → `GeneratedArtifactDraft`
(status `draft`) → Review & Approve → either `approved` (becomes a real saved deck/card/artifact,
referenced via `savedDeckId`/`savedArtifactId`) or `rejected` (discarded, but the source remains in
the Library for another attempt). A source's `deletedAt` tombstone does not retroactively delete
artifacts already approved and saved from it — those are independent records once approved, matching
the same "approval creates a durable, independent thing" pattern already used elsewhere (e.g. a
deck import becomes the importing user's own independent deck, not a live link back to the
exporter).

## 4. Private sources vs. shareable artifacts

This is the single most important trust boundary in the whole Library concept, and it must be
explicit rather than implied.

### Private by default

Original sources are private by default:

- Textbook excerpts
- Professor slides
- Personal notes
- Lecture recordings
- Transcripts
- Assignment descriptions
- Canvas-derived information
- Spreadsheets
- Images
- Uploaded documents

None of the above should ever become visible to another user without an explicit, separate
sharing action — and even then, per the next section, it's the *artifact*, not the source, that
gets shared.

### Shareable with explicit user action

Study artifacts — the *output* of a source, not the source itself — may be shared:

- Decks
- Flashcards
- Quizzes
- Summaries
- Study guides
- Practice exams
- Other approved Interval packages

### The distinction, stated explicitly

- Sharing a generated deck does **not** automatically share the original source it came from.
- Importing a shared deck does **not** transfer the source owner's Library access — the recipient
  gets the deck's content, not a door into the sender's Library.
- Shared artifacts should preserve limited provenance (e.g. "derived from a source the creator
  controls") without exposing the private file itself.
- Generation rights and quotas do not transfer with a shared artifact — receiving a shared deck
  does not grant the recipient any ability to generate more content from the sender's sources.
- Recipients import an independent copy and may edit it — approved product direction, see §16.
  Editing a recipient's copy never writes back to the sender's original artifact or source.
- Source documents should never become public accidentally — there is no code path in this
  specification where sharing an artifact has a side effect on the source's visibility.
- Sharing must require explicit confirmation — never a default-on or ambient behavior.

### Copyright and institutional trust

- Interval should not encourage redistribution of instructor-owned or copyrighted source
  documents. The product design (sharing artifacts, not sources) is itself the primary mitigation
  here — it structurally discourages "here's the whole textbook PDF" sharing by making the
  natural, easy path be "here's a deck I made," not "here's the file."
- Generated study artifacts may still contain user-selected material derived from copyrighted
  sources, and the user remains responsible for what they choose to include and share — Interval
  is a tool, not a legal reviewer of every artifact's content.
- No legal certification is claimed anywhere in this specification or in any future
  implementation of it, absent an actual legal review establishing otherwise.
- Future UI must make the sharing boundary visually and textually clear at the moment of sharing
  — not just documented here.

## 5. Interval package and sharing architecture

The current `.interval` deck file format (see `docs/platform-scope.md` and the Beta Readiness
batch that introduced it) stays exactly as it is — **this document does not change it.** This
section is about how sharing *could* evolve for artifact types beyond a single deck, without
touching what already works.

### Two different sharing systems

It matters that these are kept conceptually distinct, because they have very different
infrastructure requirements and very different current status:

**Direct package sharing (exists today, unchanged by this document)**

- The current `.interval` deck file, shared through the OS's own share sheet — Files, AirDrop,
  Messages, email, and similar mechanisms.
- Does not require AWS or any backend infrastructure — it's a local file export/import, the same
  as it works today.
- Produces an independent imported copy on the recipient's device, per §4.
- Existing behavior is unchanged by anything in this document.

**Future in-platform sharing (not implemented, not approved for the first Library release)**

- Hosted links, account-to-account delivery, creator identity, revocation, discovery, or
  collaboration features.
- Requires real backend architecture and requires environment separation (see
  `docs/branch-and-release-policy.md`) before it could launch with real users.
- Not implemented and not approved for the initial Library release — see §16's approved decision
  that the first Library sharing evolution continues using explicit `.interval` package sharing,
  with hosted/social sharing considered later, timing not yet decided (§17).

### Possible future artifact types

- Deck package (already exists today, unchanged)
- Quiz package
- Summary package
- Practice-exam package
- Study-guide package
- Multi-artifact study bundle (e.g. a deck + a quiz + a summary, all from the same source, shared
  together)

### What a future package format needs to document/carry

- A versioned file schema (so an older app version can at least recognize, and gracefully decline
  or degrade, a newer package it doesn't fully understand)
- Artifact type
- Title
- The actual content (cards/questions/summary text/etc., depending on type)
- A provenance summary (not the private source itself — see §4)
- A creator-controlled display name, if the sharing product ever supports attribution
- Created timestamp
- A compatibility/version marker
- Import validation (the same shape-only validation principle the current importer already uses
  — see `src/domain/deckPortability.ts`: validate the JSON payload's structure, never trust a
  file extension alone)
- No embedded original private source, by default
- Backward compatibility with whatever came before it
- Safe filename behavior (matching the existing `interval-deck-<title>-<timestamp>.interval`
  sanitization pattern)
- Explicit user confirmation before import, same as today

### Approved direction: extend, don't fork

**Approved product decision (§16):** extend the current versioned `.interval` container with an
`artifactType` field (defaulting to `"deck"` for full backward compatibility with every existing
`.interval` file) rather than introducing an entirely separate, new container format per artifact
type. A single, versioned, type-tagged container is simpler to validate, simpler to document, and
simpler for the importer to reason about than N parallel formats. This direction holds **unless
implementation evidence later proves a separate container necessary** — e.g. a future artifact
type turning out to need a fundamentally different shape than "metadata + content array." Nothing
in the artifact types listed above obviously requires that yet, but this isn't treated as
irreversible dogma if a real implementation constraint says otherwise.

## 6. Retention and the social product loop

This describes an intended *product* loop, not a plan to add analytics or social features. No
analytics, no follower graphs, no feeds, no quotas are introduced by this specification.

```
User saves valuable sources
  → sources become reusable (not one-shot)
  → user creates multiple study formats from the same source
  → user returns to existing material instead of starting over
  → approved artifacts can be shared
  → friends import useful materials
  → recipients discover Interval through something a friend actually made
  → each user builds their own Library and their own personalized outputs
```

### Product principles

- The Library is what creates long-term user investment — a user with a growing, reusable
  collection of sources has a reason to keep coming back that a pile of already-made flashcards
  alone doesn't provide.
- Sharing increases platform interaction, but the *mechanism* is "I made something useful and
  shared it," not a social feed or engagement-optimized mechanic.
- Users should feel their work can genuinely help a friend — this is a reason to share, not a
  growth trick layered on top.
- Sharing must not provide unlimited AI generation to the recipient. Source ownership and
  generation quotas (whatever they end up being — see §17) remain account-specific. Receiving a
  shared deck is not a backdoor to someone else's generation capacity.
- One shared deck does not replace personalized generation — recipients may want different
  difficulty, depth, format, or focus than what the original creator chose, and the product
  should not assume a shared artifact is "good enough" for everyone who receives it.
- Collaboration (e.g. co-editing a shared deck, seeing who else has a copy) is explicitly **not
  assumed** in the initial Library release. If it happens, it's a later, separately-scoped
  decision.

No monetization pricing is invented here, and no quotas are implemented here — both are
explicitly out of scope per the mission, and are listed as open decisions in §17 where relevant.

## 7. Document intake and extraction pipeline

### Canonical future pipeline

```
Source selection
  → client-side validation
  → secure upload
  → malware/file-safety controls
  → source metadata creation
  → extraction
  → normalization
  → chunking
  → preview
  → user selection (which parts to use for generation)
  → AI generation
  → structural validation
  → Review & Approve
  → persistence
  → future regeneration (same source, different artifact or settings)
```

No extraction vendor or service is selected in this document — that is an implementation-time
decision, not a specification-time one.

## 8. Format-specific extraction considerations

### PDF
- Selectable-text PDFs vs. scanned (image-only) PDFs need different handling — the former can be
  extracted directly, the latter needs OCR.
- Page structure, headings, tables, and images should be recognized where possible, not just
  flattened into one text blob — structure is what makes later topic segmentation and heading
  navigation (see the accessibility requirements in §14) possible at all.
- OCR fallback for scanned pages within an otherwise-text PDF.

### DOCX
- Headings, paragraphs, lists, and tables should be preserved structurally, not flattened.
- Embedded images need their own handling (likely OCR or simple inclusion-as-reference, not
  guaranteed interpretation).
- A policy is needed for comments and tracked changes — most likely: ignore them for extraction
  purposes, since they represent editorial process, not final content — but this needs an
  explicit decision when implemented, not an assumption.

### PPTX
- Slide title and slide body should be extracted separately, not merged.
- Speaker notes are a distinct, valuable source of extra context and should be extracted
  separately from slide-visible text.
- Image-heavy slides (a diagram with little or no text) need a fallback strategy (OCR, or an
  explicit "this slide had no extractable text" marker) rather than silently producing nothing.
- Slide order must be preserved — it's often pedagogically meaningful.

### XLSX
- A workbook can contain multiple sheets — each needs to be considered, not just the first.
- Tables/ranges within a sheet are more useful extraction units than raw cell dumps.
- Formulas vs. displayed values: extraction should almost always prefer displayed/computed
  values, since a raw formula string is rarely useful study content.
- Spreadsheets are the format most likely to produce poor study material (e.g. a large numeric
  dataset has little pedagogical structure) — a suitability warning shown to the user before
  generation is more honest than silently attempting it and producing something useless.

### Images (PNG/JPEG)
- OCR for text-containing images.
- Diagram interpretation (e.g. "this is a labeled diagram of X") is a meaningfully harder problem
  than plain OCR and should not be assumed solved by the same pipeline step.
- Low-quality images and handwriting both have real, expected failure/low-confidence rates — the
  user should see a preview of what was actually extracted before generation, not just trust it
  silently.

### Audio
- Covers both live in-app recording and uploaded audio files — same downstream pipeline either
  way.
- Transcription into text.
- Timestamps, so generated content can link back to a specific moment in the recording (see §9's
  provenance requirement).
- Topic segmentation of the transcript into logical sections.
- Long-duration audio implies long-running processing — the user needs visible, accessible
  progress (see §14), not a silent multi-minute wait.
- Privacy and consent considerations are covered in full in §9.

### Plain text / pasted notes
- The simplest case — mostly a matter of encoding correctness and direct normalization into the
  same internal representation every other source type produces, so downstream generation doesn't
  need format-specific logic.

## 9. Voice-created study material

Two genuinely distinct future flows — different inputs, different durations, different privacy
weight, and different UI. Neither is implemented in this batch.

### Short-form voice creation

Examples: dictate a deck title, dictate one question and answer, speak rough notes, describe a
topic, request a draft set of cards.

```
Explicit microphone activation
  → recording state (visibly and accessibly shown)
  → speech-to-text
  → transcript preview
  → AI organization
  → draft generation
  → Review & Approve
  → save
```

### Long-form recorded lecture

```
Record or upload audio
  → private Library source (see §4 — never public by default)
  → transcription
  → timestamps
  → topic segmentation
  → transcript preview
  → summaries / cards / quizzes / practice exams
  → Review & Approve
  → provenance linking back to the specific recording and transcript section
```

### Required trust rules (both flows)

- No automatic microphone activation — ever. Recording only starts from a deliberate, explicit
  user action, the same "explicit user action" principle already applied to text-to-speech (see
  `docs/accessibility-foundation.md` §4).
- No background recording without explicit action.
- Visible and accessible recording state (see §14).
- Stop and cancel are always reachable while recording — never a dead end.
- The user controls whether audio is retained after transcription, and controls transcript
  deletion.
- A recording-law and institutional-policy reminder is shown before recording begins — some
  jurisdictions and institutions restrict recording lectures or other people's speech without
  consent, and this is the user's responsibility to navigate, not something Interval can decide
  for them. The reminder makes sure they're not caught off guard by it.
- File-size and/or duration limits, so a user can't unknowingly start an effectively unbounded
  recording or upload.
- Private by default (§4).
- No study-content logging — recordings, transcripts, and generated content are study content
  under the same rule already established for text-to-speech (never logged).
- No automatic permanent save of generated artifacts — Review & Approve applies here exactly as
  it does to any other AI-generated draft (§10).

### Who this serves

This should not be framed solely as a disability feature, even though it is a genuine
accessibility benefit. It serves:

- Blind and low-vision learners
- Users with limited motor ability (typing is harder than speaking for some users)
- Older users who may find speaking more natural than typing
- Dyslexic users
- Auditory learners generally
- Students who already record lectures as a normal study habit
- Users who simply think more naturally out loud than in writing

Framing it as "a better way to create study material" rather than "an accessibility
accommodation" is both more accurate and more respectful — it's useful to nearly everyone, not a
special-case feature bolted on for a subset of users.

## 10. AI generation contract

### AI may create drafts for

- Flashcards
- Multiple-choice quizzes
- True/false
- Fill in the blank
- Summaries
- Study guides
- Practice exams
- Weak-topic review sets
- Explanations
- Mixed study sessions

### AI must not

- Automatically save generated content — every generation is a draft until approved.
- Produce submission-ready assignments — Interval helps someone study *for* their work, not
  produce the work itself.
- Answer active exams.
- Impersonate the student.
- Bypass Review & Approve, under any circumstance.
- Silently use unrelated Library sources — generation only draws from sources the user explicitly
  selected for that generation.
- Expose private source files, in the generated output or otherwise.
- Fabricate source provenance — if a generated item can't be honestly traced to a real part of
  the selected source(s), that should be visible as a gap, not papered over.
- Generate without clear, explicit user initiation.

### Required flow

```
User selects sources
  → user selects artifact type
  → user selects depth/quantity/difficulty
  → AI generates draft
  → system validates structure
  → user reviews
  → user edits
  → user approves or rejects
  → approved content enters the existing Interval engine (i.e. becomes real deck/card/etc. data,
     synced and studied exactly like anything created by hand)
```

Every generated artifact must retain a pointer back to the source(s) it came from (see
`GeneratedArtifactDraft.provenance` in §3) — generated content should never look
indistinguishable from something the user typed themselves, both for trust and for the "generated
content headings"/"source provenance announcements" accessibility requirements in
`docs/accessibility-foundation.md`.

No AI client, prompt, endpoint, or provider code is implemented or selected in this document.

## 11. Storage, security, privacy, and cost principles

No infrastructure is provisioned by this document. These are requirements for whenever
implementation happens.

### Likely storage separation

Future storage should probably distinguish, as separate concerns even if not necessarily separate
literal storage systems:

- Original source binary
- Extracted text
- Metadata
- Generated drafts
- Approved artifacts
- Deletion state
- Audit-safe processing status (safe to log/inspect without exposing content)

### Requirements

- Per-user ownership on every record, same trust model as the existing sync data (owner derived
  from the authenticated identity, never client input — see `CLAUDE.md`).
- Authorization checked on every operation, not just at upload time.
- Encryption in transit.
- Encryption at rest.
- Presigned or equivalent scoped upload (the client never gets broad write access to shared
  storage).
- File-size limits, enforced server-side, not just suggested client-side.
- Supported MIME-type validation — and extension alone is never trusted, since it's trivially
  spoofable (this is the same principle already applied to `.interval`/`.briefly` import, which
  validates payload shape, never extension, for exactly this reason).
- A malware/file-safety strategy for uploaded binaries before they're processed or served back.
- Rate limits on upload and generation endpoints.
- Upload cancellation and retry support.
- Idempotent processing — a retried extraction/generation request must not duplicate work or
  data.
- Cleanup of abandoned uploads (e.g. a client that started an upload and never completed it).
- Retention controls, consistent with whatever data-retention promises the product actually makes
  (see `docs/branch-and-release-policy.md` and the existing beta privacy notice's honesty
  standard — no promise not backed by real implementation).
- No public source URLs, ever, by default.
- No source data in logs, ever — this extends the existing "never log study content" rule from
  `docs/accessibility-foundation.md` to source documents and their extracted text.
- Cost monitoring, since binary storage and AI generation both have real, ongoing cost — visibility
  into this before it becomes a surprise is a requirement for the team, not the user.
- Generation quotas (exact numbers are an open decision — see §17 — but the *mechanism* for
  enforcing a quota should exist from the start, even if the initial quota is generous).
- Transcription-duration limits, for the same cost/abuse reasons as generation quotas.
- Processing-status transparency — a user should always be able to see whether something is
  uploading, processing, ready, or failed, never left guessing.

### Private-source deletion lifecycle

Deletion of original documents, recordings, transcripts, and extracted content needs a stronger,
more explicit lifecycle than a single "deletion propagation" bullet can carry — sensitive material
like a recorded lecture deserves a lifecycle that's honest about timing, not just a promise that
deletion "happens":

1. **Immediate hide.** The source becomes hidden and inaccessible to the user immediately on
   deletion — no waiting on backend processing before it disappears from the user's own view.
2. **Tombstone sync.** A metadata tombstone (same `deletedAt` pattern as `DeckRecord`/`CardRecord`,
   see §3 and `docs/sync-invariants.md`) synchronizes the deletion to the user's other devices, so
   it disappears everywhere, not just on the device the deletion happened on.
3. **In-flight work cancellation.** Any active extraction, transcription, or generation work tied
   to the source is canceled where technically possible, rather than continuing to process
   something the user just deleted.
4. **Queued permanent purge.** The original binary, extracted content, transcript, previews, and
   any dependent processing records are queued for permanent backend deletion. This is
   deliberately **distinct from step 2** — the tombstone is what makes the sync protocol converge
   across devices quickly; the actual physical purge of a potentially large binary (audio, PDF,
   etc.) from backend storage is a separate, likely-asynchronous operation that follows it.
5. **Visible purge status.** Where permanent deletion is asynchronous, the UI exposes that — a user
   should be able to tell "deleted, purge pending" from "deleted, and gone," rather than being left
   to assume instant physical erasure happened.
6. **Approved artifacts are independent.** Deleting a source does not retroactively delete
   artifacts already approved and saved from it (see §3's lifecycle summary) — those remain unless
   the user separately deletes them.
7. **Honest backup/retention disclosure.** Once implemented, any backup or retention window that
   could keep a copy of deleted source data alive longer than the primary deletion flow suggests
   must be disclosed honestly to the user — not left implicit.
8. **No unproven purge-speed promises.** No copy in the app or its documentation may promise
   instantaneous physical purge of deleted source data unless the actual implementation can prove
   that's what happens. Until then, the honest framing is "deleted and inaccessible immediately,
   permanently removed on a queued/asynchronous basis" — the same "soft delete, not instantly
   purged everywhere" honesty already used for decks and cards (see
   `docs/accessibility-foundation.md`'s recording-deletion note and `docs/sync-invariants.md`),
   extended here to cover source binaries specifically, including sensitive audio — sensitive
   recordings must not be implied to remain soft-deleted-but-recoverable forever; they are subject
   to the same eventual permanent purge as every other source type.

Whether a transcript can be deleted independently of its source recording, or only together with
it, is not resolved by this lifecycle — see §17.

No AWS resources are created by this document. No exact pricing or quota numbers are specified —
both require a founder decision informed by real usage data this app doesn't have yet.

## 12. Offline-first boundary

Interval's Core Product Rule (see `CLAUDE.md`) is that the app remains useful without an account
and without connectivity. The Library, by its nature, involves genuinely online-dependent
operations — this section defines where that boundary sits, honestly.

### Can plausibly work offline

- Cached Library metadata (titles, types, collections, status — the "index," not the binaries)
- Previously downloaded source previews (if a preview was already fetched once)
- Approved decks/artifacts (once approved, they're normal Interval study content — same
  offline-first guarantee as any other deck/card)
- Queued metadata edits (renaming a source, changing its collection/tags) — same dirty-flag/sync
  pattern already used for decks and cards
- Local collection organization (creating/renaming a `SourceCollection` locally, syncing later)
- Local study sessions using already-approved, already-synced artifacts

### Requires connectivity

- New cloud upload of a source binary
- Server-side extraction
- AI generation
- Canvas synchronization (see `docs/canvas-companion-spec.md`)
- Cloud transcription
- Retrieving a source (or its full binary) on a device that doesn't already have it cached

### Queue/retry expectations

Metadata-level changes (rename, re-tag, re-collect, mark for deletion) should follow the same
dirty-flag/queue/sync-when-online pattern the existing deck/card sync already uses (see
`docs/sync-invariants.md`). Binary uploads and AI generation are fundamentally different in kind —
they're not small deltas that make sense to silently retry from a queue; a failed upload or
generation should surface as a clear, visible state (`processingStatus: "failed"`), not silently
retry forever in the background.

### A dedicated protocol is likely needed

**This document does not extend the current sync protocol, and this mission does not implement
one.** But it's worth flagging plainly: forcing multi-megabyte (or larger) binary files, and their
processing lifecycle, into the existing deck/card/session change-log sync model (designed for
small, frequent, textual deltas — see `docs/sync-invariants.md`) is very likely the wrong fit.
Library/source synchronization should probably get its own, purpose-built protocol — a
recommendation for a future architecture decision, not something resolved here.

## 13. Additional study modalities

These reuse approved artifacts (from the Library or from manual creation) — none of them require
their own separate content model beyond what already exists or is proposed above.

| Modality | Classification |
|---|---|
| Standard flashcard review | Already exists |
| Quiz (multiple choice) | Already exists |
| True/false | Strong near-term candidate |
| Fill in the blank | Strong near-term candidate |
| Matching | Later enhancement |
| Practice exam | Requires new data model (a practice exam is more than a quiz — likely needs its own artifact type, timing/section structure) |
| Mixed-mode session | Later enhancement (depends on multiple modalities existing first) |
| Weak-topic review | Requires new data model (needs per-card/per-topic performance tracking beyond what exists today) |
| Listen-only review | Accessibility-dependent (directly builds on the existing text-to-speech foundation — see `docs/accessibility-foundation.md`) |
| Spaced practice | Requires new data model (scheduling/interval data this app doesn't currently track) |
| Timed focus session | Later enhancement |
| Oral-response practice | Requires AI (needs speech input *and* some evaluation of the spoken answer — meaningfully harder than TTS alone) |
| Guided summary review | Requires AI (depends on the summary-generation artifact type existing) |
| Study plan | Requires AI (depends on Canvas and/or weak-topic data existing first) |

### Recommended implementation order

1. True/false and fill-in-the-blank — smallest incremental addition to the existing quiz engine,
   no new data model.
2. Listen-only review — already has its underlying capability (text-to-speech) built; this is
   mostly a study-mode UI decision, not new infrastructure.
3. Matching — modest new UI, no fundamentally new data model.
4. Weak-topic review and spaced practice — these two are related (both need
   performance-over-time tracking) and are worth designing together rather than twice.
5. Practice exam and mixed-mode session — once weak-topic/spaced-practice data exists, these
   become more valuable and better-informed than if built first.
6. Oral-response practice, guided summary review, study plan — all explicitly depend on AI
   generation (§10) and, for study plan, likely Canvas (`docs/canvas-companion-spec.md`) — these
   come last because their prerequisites come last.

The first two steps of this order — true/false and fill-in-the-blank, then listen-only review —
are now an approved product decision (§16), not just a recommendation. The remaining steps stay a
recommendation, not a promise of what ships next.

## 14. Accessibility requirements

See `docs/accessibility-foundation.md`, which has been updated with the Library/AI/Voice-specific
requirements this specification implies (accessible file pickers, generated-content headings,
Review & Approve semantics, recording-state announcements, and more). This document doesn't
duplicate that detail — the accessibility document is the authoritative source for accessibility
requirements, including future ones (see `docs/accessibility-foundation.md`'s own "Future
document/AI accessibility requirements" and "Voice and Recorded-Audio Input" sections, both
already written).

## 15. Implementation roadmap

A disciplined, phased order — later phases depend on earlier ones being genuinely done, not just
started.

### Phase 1 — Product and architecture approval
- **Objective**: get founder sign-off on this specification. Most product-direction decisions are
  now resolved — see §16's approved decisions. This phase now covers resolving what remains in
  §17's open decisions.
- **Prerequisites**: none — this is the starting point.
- **Main risks**: proceeding with an unresolved §17 item baked in as an assumption.
- **Exit criteria**: every item in §17 has a founder answer, or an explicit "defer, revisit later"
  decision.
- **AWS/backend changes required**: no.
- **Founder QA required**: no (this phase is a decision/approval phase, not a QA phase).

### Phase 2 — Local Library UI foundation
- **Objective**: build the Library's navigation/organization UI (§2) against local, mock, or
  manually-entered source metadata — no cloud files yet.
- **Prerequisites**: Phase 1. The Library-placement decision itself is already approved (§16,
  dedicated tab plus contextual entry points) — this phase's dependency on Phase 1 is about any
  remaining §17 items that affect UI scope, not about placement.
- **Main risks**: building UI against a metadata shape that doesn't match what Phase 4's real
  upload pipeline eventually produces.
- **Exit criteria**: sorting, filtering, collections, and accessibility (§14) all work against
  local data; no cloud dependency yet.
- **AWS/backend changes required**: no.
- **Founder QA required**: yes.

### Phase 3 — Environment separation
- **Objective**: establish development/staging/production separation before any real, persistent
  third-party data exists (see `docs/branch-and-release-policy.md`).
- **Prerequisites**: none technically, but must happen before Phase 4 goes live with real users.
- **Main risks**: skipping this and discovering the cost of not having it after real user data
  already exists in a single environment.
- **Exit criteria**: a real, documented environment separation exists and is verified.
- **AWS/backend changes required**: yes.
- **Founder QA required**: yes.

### Phase 4 — Secure upload foundation
- **Objective**: user-scoped binary storage, metadata creation, upload progress, retry/cancel,
  deletion.
- **Prerequisites**: Phase 3.
- **Main risks**: getting the security principles in §11 wrong is expensive to fix after the fact
  (once real user files exist).
- **Exit criteria**: a user can upload a file, see it in their Library with correct metadata, and
  delete it — no extraction or generation yet.
- **AWS/backend changes required**: yes.
- **Founder QA required**: yes.

### Phase 5 — Extraction
- **Objective**: text, PDF, DOCX, PPTX, XLSX, image, and audio transcription extraction, per §8.
- **Prerequisites**: Phase 4.
- **Main risks**: format-specific extraction quality varies a lot; scanned PDFs and low-quality
  images are the likely long tail of difficulty.
- **Exit criteria**: each supported format reliably produces normalized, previewable extracted
  content, with honest failure states for what doesn't extract well.
- **AWS/backend changes required**: yes (likely a vendor/service decision, not made here).
- **Founder QA required**: yes.

### Phase 6 — Preview and source management
- **Objective**: extracted-text preview, processing status, source edit/delete/archive,
  collection organization.
- **Prerequisites**: Phase 5.
- **Main risks**: none unique to this phase — mostly UI/UX refinement risk.
- **Exit criteria**: a user can review what was extracted from their source before generating
  anything from it.
- **AWS/backend changes required**: no (beyond what Phase 5 already added).
- **Founder QA required**: yes.

### Phase 7 — AI draft generation
- **Objective**: artifact selection, generation settings, structural validation, Review &
  Approve, provenance (§10).
- **Prerequisites**: Phase 6.
- **Main risks**: this is the phase most exposed to the AI-generation contract (§10) being
  violated by an implementation shortcut (e.g. auto-saving to "improve the demo") — the Review &
  Approve requirement needs to be enforced structurally, not just as a UI convention.
- **Exit criteria**: a user can generate a draft from an approved source, review it, and either
  approve (it becomes real study content) or reject it (it's discarded, source remains).
- **AWS/backend changes required**: yes.
- **Founder QA required**: yes.

### Phase 8 — In-platform sharing evolution
- **Objective**: this phase is specifically about *future in-platform sharing* (§5) — hosted
  links, account-to-account delivery, creator identity, revocation. It is **not** about direct
  `.interval` package sharing, which already works today via the OS share sheet without AWS or any
  backend change (§5), and is unaffected by this phase existing or not. This phase covers
  `.interval` format evolution to an `artifactType` field (approved, §16), plus whatever hosted
  sharing infrastructure is eventually built, and enforcement of the private-source boundary (§4)
  in that hosted context specifically.
- **Prerequisites**: Phase 7 (there needs to be something worth sharing). Hosted-sharing timing
  itself is an open decision (§17) — this phase may be deferred well past Phase 7 without blocking
  anything else.
- **Main risks**: accidentally exposing a source instead of just the artifact — this is the
  single most important thing to get right in this phase, and should be tested adversarially, not
  just for the happy path.
- **Exit criteria**: a user can share an artifact through hosted infrastructure, a recipient can
  import it, and at no point is the original private source exposed. (Direct `.interval` package
  sharing has no exit criteria here — it already works and needs no further work to remain
  available.)
- **AWS/backend changes required**: yes, for the hosted-sharing portion only.
- **Founder QA required**: yes.

### Phase 9 — Canvas companion
- **Objective**: feasibility confirmation, OAuth/institution requirements, course selection,
  upcoming work, reminders — see `docs/canvas-companion-spec.md` for the full specification.
- **Prerequisites**: full Canvas-derived study generation is approved to follow general Library/AI
  work (§16) — this phase's generation-dependent scope is sequenced after Phase 7, not run before
  or fully in parallel with it. Narrow Canvas reminder *feasibility* research (institutional
  access, OAuth requirements) is explicitly not blocked on that sequencing (§16) and may start
  earlier.
- **Main risks**: institutional Canvas developer-key approval is outside Interval's control and
  could block or delay this phase independent of engineering readiness (§17).
- **Exit criteria**: see `docs/canvas-companion-spec.md`.
- **AWS/backend changes required**: yes.
- **Founder QA required**: yes.

### Phase 10 — Additional study modalities
- **Objective**: build out §13's modalities, prioritized using real beta feedback rather than
  this document's recommended order alone.
- **Prerequisites**: varies per modality — see §13.
- **Main risks**: building a modality nobody asked for instead of listening to actual beta usage.
- **Exit criteria**: per-modality, defined when that modality is actually scoped.
- **AWS/backend changes required**: varies per modality.
- **Founder QA required**: yes, always.

## 16. Approved product decisions

These product directions have been reviewed and approved by the founder. They are decisions, not
recommendations — implementation should proceed against them rather than treating them as still
open, unless a genuine implementation-time constraint requires revisiting one (see each item's own
caveats where noted).

- **Library placement**: a dedicated primary Library tab, with contextual entry points from Home
  and relevant study screens — not one or the other, both.
- **Collections**: user-created collections first. Automatic course collections may be added later,
  once Canvas/course context actually exists (see `docs/canvas-companion-spec.md`) — not assumed
  for the first release.
- **Initial source-format priority**: PDF, DOCX, plain text/pasted notes, images, and audio launch
  first (§1, §8). PPTX and XLSX remain planned but do not need to launch in the first intake
  release.
- **Private-by-default sources, no first-release source sharing**: original sources are private by
  default and are not directly shareable in the first Library release (§4). Whether that boundary
  is ever relaxed for source documents specifically remains open — see §17.
- **Recipient-editable shared copies**: shared artifacts import as independent copies that
  recipients may edit (§4) — editing a copy never writes back to the sender's original.
- **`.interval` format evolution**: the format should evolve through a versioned `artifactType`
  field (§5) rather than a new container, unless implementation evidence later proves a separate
  container necessary.
- **First AI artifact priorities**: flashcards, summaries, and multiple-choice quizzes (§10) are the
  first artifact types to actually ship.
- **First additional study-mode priorities**: true/false, fill-in-the-blank, then listen-only
  review (§13) — the first of §13's recommended order is now approved, not just recommended.
- **Library/AI before Canvas-derived generation**: general Library/document intake and AI
  generation should precede full Canvas-derived study generation (affects §15 Phase 7 vs. Phase 9
  sequencing — see the updated Phase 9 note below).
- **Narrow Canvas reminder feasibility may be investigated independently** of that sequencing —
  feasibility research (institutional access, OAuth requirements) is not blocked on Library/AI
  shipping first, even though full Canvas-derived *generation* is.
- **Environment separation gates persistent external uploads**: environment separation (§15 Phase
  3) is required before external users can upload persistent source files — this is now the
  concrete condition Phase 3 gates on, not an unspecified future trigger.
- **User-controlled retention with eventual purge**: source retention is user-controlled, with
  eventual permanent purge after deletion (§11's deletion lifecycle) — exact retention/backup
  windows remain open, see §17.
- **Creator identity opt-in, off by default**: creator identity in shared artifacts is optional and
  disabled by default during early sharing — sharing can be anonymous unless a user explicitly
  opts into attribution.

## 17. Open founder decisions

These remain genuinely unresolved — this document does not guess at them. Each needs an actual
founder decision, or a specific implementation-time answer, before the relevant phase can proceed
with full confidence:

- Exact file-size limits (per file, and possibly per type).
- Exact generation/upload quotas.
- Exact retention and backup windows.
- Guest-to-account migration mechanics — the exact adoption/migration implementation is
  unresolved until the implementation phase (§18).
- Transcription vendor.
- Extraction providers (per format, §8).
- Notification default cadence (see `docs/canvas-companion-spec.md`).
- Private beta cohort timing for Library/AI features, and how that cohort is selected.
- Hosted/in-platform sharing timing (§5) — direct `.interval` package sharing is the approved first
  step; when, or whether, hosted sharing follows is not yet decided.
- Canvas institutional access feasibility — some institutions may restrict or deny third-party
  OAuth access entirely (see `docs/canvas-companion-spec.md`), independent of Interval's own
  engineering readiness.
- Can transcripts be deleted independently of their source recording, or only together (§11)?
- Whether the "artifacts only, sources stay private" boundary in §4 is permanent product policy, or
  could ever be relaxed for source documents specifically.

## 18. Account and guest boundary

This section exists because §3's `LibrarySource.ownerId` models cloud records as owned by a
Cognito `sub`, while Interval's Core Product Rule (`CLAUDE.md`) requires the app to remain useful
without an account. Those two facts need an explicit boundary between them, not an implied one.

### Approved product direction

- **Manual decks/cards/study remain available to guests and offline users**, unchanged by anything
  in this document — the Library is an addition, not a precondition for Interval's existing core
  usefulness.
- **Permanent cloud Library storage requires an authenticated account.** A `LibrarySource` row with
  a real Cognito-`sub` `ownerId` (§3) only exists once a source has actually been adopted into an
  authenticated account.
- **Cloud-dependent operations require authentication and connectivity**: cloud transcription,
  cloud extraction, AI generation, Canvas synchronization, and cross-device source retrieval all
  require both an authenticated account and connectivity — none of these can be guest-accessible by
  their nature (see §12's offline-first boundary).
- **A future local-only or temporary intake flow may exist for guests** — e.g. selecting or pasting
  material for local processing where technically possible — but any such flow must not be
  described as, or behave like, permanent cloud Library ownership. It's a local, temporary
  convenience, not a Library.
- **Local source metadata must not assume a Cognito `sub` exists before sign-in.** Any local
  representation of a not-yet-adopted source needs its own local identity, not a placeholder or
  assumed Cognito identity.
- **A future implementation must choose a workspace-scoped local identity model** for pre-account
  local sources, plus an explicit adoption/migration flow for when a guest signs in — analogous in
  spirit to how existing local decks/cards already work before an account exists, but this specific
  mechanism is not designed here (see §17's open "guest-to-account migration mechanics" item).
- **Local sources must never silently attach themselves to the wrong account.** Adoption into an
  account must be an explicit, attributable action, not an ambient side effect of, e.g., a device
  simply having a signed-in session at some point.
- **Sign-out and account-switch behavior must protect source isolation** — switching accounts on a
  device must not blend one account's local/adopted sources with another's, the same isolation
  standard already required of synced deck/card data (see `docs/sync-invariants.md`).

### What remains unresolved

The exact adoption/migration implementation — how a guest's local, pre-account source material is
offered to, and adopted into, a newly signed-in account — is not resolved here. This is
appropriately an implementation-phase decision, not a product-direction decision, and is tracked as
open in §17.
