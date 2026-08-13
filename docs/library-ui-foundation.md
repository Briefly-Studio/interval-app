# Interval Library UI Foundation

This document describes what the **Library Local UI Foundation** batch actually implemented — a
polished, accessible, offline-first Library experience built entirely against local metadata and
safe, dev-only simulated entries. It exists so this batch's real scope (and, just as importantly,
its explicit non-scope) is a checkable fact, not something re-derived from reading every file.

See `docs/library-and-source-architecture.md` for the full future product/architecture
specification this batch begins implementing, and that document's own "Implementation status"
section (added by this batch) for the authoritative implemented-vs-not-implemented split.

**No real document, audio, or file content is stored anywhere by this batch.** A Library "source"
created here is metadata only — a title, type, size, page/slide/sheet/duration count, tags,
course, semester, and a couple of timestamps. There is no file URI, no cloud storage key, no
extracted text, and no AI-generated content on any record this batch creates.

## Routes and screens

| Route | Purpose |
|---|---|
| `app/library/index.tsx` | Library main screen — search, sort, filter, organization, list, empty states |
| `app/library/add.tsx` | Add source details (metadata-only creation) |
| `app/library/[id]/index.tsx` | Source detail — view metadata, grouped "Source actions" (Edit/Manage collections/Archive-Restore/Delete), Development-only Original File card (attach/retry-upload/verify-cloud-access and, per `docs/library-and-source-architecture.md`'s "Source open/preview" section, Open Original) |
| `app/library/[id]/edit.tsx` | Edit source details (reuses the same field set as Add) |
| `app/library/[id]/collections.tsx` | Manage collections for one source — checkable multi-select, "+ New collection" |
| `app/library/collections/index.tsx` | Collection list, with per-collection source counts |
| `app/library/collections/create.tsx` | Create a collection |
| `app/library/collections/[id].tsx` | Collection detail — rename, delete, list/remove sources |
| `app/library/deleted.tsx` | Recently Deleted (Library) — restore soft-deleted source metadata |

## Founder QA remediation (first hands-on pass)

The founder's first iOS Simulator pass confirmed the underlying behavior works but found several
concrete usability/layout defects — treated as product usability failures, not user error, per the
founder's own standard: "if the founder and main developer gets confused, a normal user will be
more confused." This section documents what changed in response; `docs/v3-beta-release-checklist.md`
tracks which of these still need a founder retest versus which are newly confirmed.

- **Scrollability.** Root cause: `src/ui/Screen.tsx`'s content `View` applied `flex: 1`
  unconditionally, including when wrapped in a `ScrollView` — this caps content to viewport height
  instead of letting it grow to its natural (larger) size, which is what made longer screens unable
  to scroll to their lower content. Fixed at the `Screen` primitive (the `flex: 1` now only applies
  in the non-scroll case), which corrects every existing `<Screen scroll>` screen in the app, not
  just Library's. Dev Tools' main content also gained `scroll` (it didn't have it at all).
- **Recently Deleted title.** Shortened from "Library Recently Deleted" to "Recently Deleted" /
  "Eliminado recientemente" — it was visibly clipped. The supporting subtitle already explains this
  is Library's Recently Deleted, so the screen title didn't need to repeat that context.
- **Main-screen hierarchy.** Restructured into: header (title + Add) → one concise supporting
  sentence → Collections/Recently Deleted → search (with a leading search icon and a clear-query
  control) → Active/Archived scope toggle → a collapsible "Sort & Filters" section (shows an
  active-filter count, offers Clear even while collapsed) → results summary → the source list. All
  of this now lives inside the list's `ListHeaderComponent`/`ListEmptyComponent` rather than as
  static content above a separately-scrolling list, so the whole screen scrolls as one unit with no
  nested-scroll conflict, however many filter groups happen to be present.
- **"All Sources" → "Active".** Sitting next to "Archived," "All Sources" read as if it meant
  everything including archived items. Renamed to "Active" / "Activas" — a state of the Library, not
  a claim of completeness.
- **Search discoverability.** Given a leading icon and moved higher in the reorganized hierarchy;
  search and filters both now apply to whichever scope (Active/Archived) is selected, not just
  Active, so switching scope doesn't silently drop an in-progress search.
- **Source-card affordance.** `SourceCard` gained a trailing chevron (decorative,
  `importantForAccessibility="no"` — the existing `accessibilityHint` already carries the
  interaction meaning for assistive technology) so a sighted user has a visual cue the row opens
  something, not just an accessibility-only hint.
- **Source action discoverability.** Source Detail's actions are now grouped under a visible
  "Source actions" / "Acciones de la fuente" heading. "Assign / change collection" was renamed to
  "Manage collections" / "Administrar colecciones" (the data model already supports multiple
  collections per source — the old singular wording undersold that).
- **Collection reassignment.** "Manage collections" now opens a dedicated screen
  (`app/library/[id]/collections.tsx`) instead of the full Edit form — a focused checkable list of
  every active collection, with its own "+ New collection" action. Creating a collection from there
  and returning lands back on the same Manage Collections screen (ordinary stack `back()`
  navigation, reloaded via the screen's existing `useFocusEffect`) with the new collection already
  checkable and the user's in-progress selection preserved — no need to re-find the source from
  Library.
- **Long source titles.** Source Detail's header already truncated to one line
  (`numberOfLines={1}`) with the back button protected by a `flex: 1` sibling style, and React
  Native already exposes a `Text`'s full string as its accessibility name regardless of visual
  truncation. What was missing: the full title wasn't shown anywhere else on the screen. Fixed by
  adding an explicit "Title" / "Título" row at the top of the detail body, so a sighted user with a
  visually truncated header can still read the complete title.
- **Empty-state repetition.** The always-visible top sentence now states only the product's
  *purpose* (reusable sources you can turn into decks and more); the local-only/no-upload honesty
  statement now lives once, in the empty-state body, not duplicated at similar length in both
  places.

## Founder QA remediation (second pass)

A second iOS Simulator retest confirmed the first pass's fixes and surfaced three further,
narrower issues:

- **Collection search.** The Collections screen (`app/library/collections/index.tsx`) had no
  search, unlike the main Library screen. Added the same visible pattern (leading icon, labeled
  field, clear-query control) and a new `searchSourceCollections()` helper in
  `src/domain/libraryOrganize.ts` that filters by collection name. It reuses the exact same
  `foldForSearch()` normalization already used for source search (now exported from that file
  specifically so both call sites share one implementation) — case-insensitive and
  accent-insensitive for the same reason source search needed it. Search is shown once at least
  one collection exists, not on the very first "no collections yet" state, mirroring the same
  choice already made for source search on the main Library screen. A non-matching query gets its
  own distinct "no collections match" state (separate from "no collections yet") with a way to
  clear the search. Filtering is computed fresh on every render from whatever `collections`
  currently holds (`useMemo` keyed on `[collections, query]`) — there is no separate filtered
  dataset to go stale, so create/rename/delete (each already reloading `collections` via this
  screen's existing `useFocusEffect`) are reflected immediately, including a search result that no
  longer applies because the matching collection was just deleted.
- **User-facing delete language.** "Delete metadata" was technically accurate but not normal user
  language. Source Detail's destructive action now reads **"Delete from Library" / "Eliminar de la
  Biblioteca"**, with confirmation copy **"Remove this source from your Library?" / "¿Eliminar
  esta fuente de tu Biblioteca?"** and body text explaining the removal in plain language — no
  claim of external-file deletion, cloud deletion, or permanent purge, same as before. The word
  "metadata" no longer appears anywhere in production Library UI strings; it remains accurate and
  fine to use in code, comments, and this document, which describe the underlying model, not what
  a user reads.
- **Recovery navigation hidden on empty.** The main Library screen's "nothing here yet" state
  (`isTrulyEmpty` — no active sources and no archived sources) previously rendered a completely
  separate, minimal layout with no Collections/Recently Deleted row at all. A Library holding only
  *deleted* sources (which count toward neither active nor archived) hit exactly this state,
  leaving no way to reach Recently Deleted short of creating a new source first. Fixed by rendering
  the utility row (and the summary line) exactly once, shared by both the empty-state branch and
  the normal branch, rather than duplicated in one and missing from the other — see the
  `utilityRow`/`summaryText` variables in `app/library/index.tsx`.

## Navigation decision

The app has no tab bar or bottom navigation anywhere — `app/_layout.tsx` is a single Expo Router
`Stack`. Introducing a tab layout now would touch startup (`BrandStartup`), the web gate, and
`sign-in-transition`'s custom screen options, for a requirement ("dedicated primary destination
with contextual entry points") that doesn't actually need one.

Library is reached via:

- **A first-class `SecondaryAction` chip on Home** (`app/index.tsx`), at the same visual tier as
  Import/Recently Deleted — visible to guests and signed-in users alike, satisfying "reachable
  while signed out" directly.
- **A contextual `SettingsRow` entry** under a new "Library" section in Settings
  (`app/settings.tsx`), for signed-in users browsing Settings.

No root layout changes, no tab bar, no risk to existing routing.

## Local data model

`src/models/librarySource.ts` (`LibrarySourceRecord`) and `src/models/sourceCollection.ts`
(`SourceCollectionRecord`), following the same `upgradeX()`/defensive-normalization convention as
`src/models/deck.ts`/`src/models/card.ts` — malformed stored records never crash the app; every
field is validated and coerced to a safe default on read.

`LibrarySourceRecord` has no `ownerId` field. There is no cloud record in this batch, so there is
nothing to own yet — see "Local/account boundary" below.

## Storage keys

New, Interval-prefixed keys (see `src/storage/libraryKeys.ts`) — this is a genuinely new
post-rebrand feature with no legacy `briefly.*` data to preserve:

- `interval.librarySources.v1`
- `interval.sourceCollections.v1`

No existing `briefly.*` key was renamed, touched, or migrated.

## Local/account boundary

Keys are scoped through the **existing** `scopedKey(WorkspaceScope, ...)` mechanism
(`src/storage/workspaceScope.ts`) — the exact same guest-vs-`user:<sub>` local partitioning
decks/cards/sessions already use. This was a deliberate reuse decision, not a new isolation model:
it directly satisfies `docs/library-and-source-architecture.md` §18's requirement that sign-out/
account-switch never blend one account's local Library metadata with another's, using
already-proven infrastructure instead of inventing a device-wide store.

Concretely: Library metadata is **not device-wide**. A guest's local Library metadata lives under
the guest-scoped key; a signed-in user's lives under a key namespaced to that account's local
scope. Signing out and back in as a different account sees a different Library, the same way it
already sees different decks. This is local, on-device scoping only — there is no cloud Library
record, no Cognito authorization check, and no server-side ownership anywhere in this batch. See
`docs/library-and-source-architecture.md` §18 for what a real account-adoption flow (turning local
guest metadata into an authenticated cloud record) would require; that remains entirely future
work, not started here.

## Source lifecycle

Three states, tracked via `archivedAt`/`deletedAt` timestamps (mirroring `DeckRecord`/
`CardRecord`'s `deletedAt` tombstone pattern):

- **Active** — appears in normal Library views.
- **Archived** — hidden from Active by default, visible under the Archived toggle, restorable.
- **Deleted** — a soft-delete tombstone (`deletedAt`), visible only in Library Recently Deleted
  (`app/library/deleted.tsx`), restorable.

**Why a separate Library Recently Deleted screen, not a section in `app/recently-deleted.tsx`:**
that screen's restore logic is tightly coupled to deck/card recovery semantics
(`resolveCardRestoreTarget`, recovery-deck creation for orphaned cards) that have no Library
equivalent. Folding Library into it would have created real architectural coupling between two
unrelated domains. A small, self-contained screen keeps every required storage operation
(`softDeleteLibrarySource`, `restoreLibrarySource`, `getDeletedLibrarySources`) genuinely exercised
by real UI, without that coupling.

Deletion copy is explicit and honest: deleting a source removes the local Library entry only. It
never claims to delete an external file (none has ever been imported), and never affects decks.

## Collection behavior

User-created only — no automatic Canvas/course collections (explicitly future work per
`docs/library-and-source-architecture.md` §16). A collection assigns to zero or more sources via
`LibrarySourceRecord.collectionIds` (array, supporting multi-collection membership). Deleting a
collection (`softDeleteSourceCollection`) unassigns it from every source first
(`unassignCollectionFromAllSources`) and only then tombstones the collection — sources are never
deleted as a side effect, and the confirmation copy says so explicitly.

## Sorting / filtering / search behavior

`src/domain/libraryOrganize.ts` — pure, side-effect-free functions run against a single loaded
source array, composed freely by the Library main screen (type filter + course/semester filter +
search + sort all apply simultaneously, e.g. "PDF + Calculus + Recently used"), per
`docs/library-and-source-architecture.md` §2's explicit "filters compose, not exclusive views"
requirement. No duplicate per-view datasets are created.

**No collection filter on the root screen** — this was removed by the Library Organization
Refinement batch (see `docs/library-and-source-architecture.md`'s "Root Library rule"). Once root
only shows unfiled sources, a "filter by collection" chip on that same screen would always produce
zero results (nothing on root belongs to any collection by definition), so it was removed rather
than left as dead UI. Browsing one specific collection's sources is Collection Detail's job
(`app/library/collections/[id].tsx`), unchanged by this note.

Root's search/sort/filter pipeline runs over the root/unfiled source set only, for the Active view
— not a cross-collection global search. This is the narrowest reading of an otherwise-ambiguous
prior contract; see `docs/library-and-source-architecture.md`'s "Root Library rule" for the full
reasoning. The Archived view is unaffected — it still searches/filters/sorts every archived
source regardless of collection membership, since Collection Detail never surfaces archived
sources at all (see that same doc section for why the unfiled rule deliberately does not apply to
Archived).

"Recently used" sorting has a genuine limitation: this foundation has no study/generation
integration to derive real usage from, so `lastUsedAt` is only updated when a source's metadata is
actually **edited and saved** (a real, deliberate interaction) — not on merely viewing its detail
screen. Sources never edited fall back to their `createdAt` for this sort. This is disclosed here
rather than silently treated as a fully-populated signal.

## Accessibility implementation

Follows `docs/accessibility-foundation.md` from the start, per that document's existing §11
Library requirements (already written in a prior batch):

- Screen titles carry `accessibilityRole="header"`.
- `SourceCard` (`src/ui/SourceCard.tsx`) exposes a single composed `accessibilityLabel` covering
  title, type, status, size, and context — never relies on an icon or color alone; type/status/
  size are also rendered as literal on-screen text.
- `FilterChip` (`src/ui/FilterChip.tsx`) exposes `accessibilityRole="radio"` for exclusive-choice
  groups (organization toggle, type/collection/course/semester single-value filters, sort) and
  `accessibilityRole="checkbox"` with `accessibilityState.checked` for the multi-select collection
  assignment in the source form — matching `src/ui/DifficultySelector.tsx`'s existing pattern.
- Selected/checked state is never color-only: filled background + accent text + bold weight
  together, plus the real accessibility state.
- Every text field carries a real `label` (`src/ui/TextField.tsx`'s existing convention); no
  placeholder-only fields.
- `TextField`'s existing `accessibilityLiveRegion="polite"`/`accessibilityRole="alert"` error
  pattern is reused as-is for the title-required and collection-name-duplicate validation errors —
  no new error-announcement mechanism was built.
- No fixed-height text clipping — every row uses `Card`/`touchTarget.min`-based sizing, matching
  every other list row in the app; long titles (`numberOfLines={2}` on `SourceCard`) truncate
  visually only, never in the underlying accessibility label.
- No new animation was introduced anywhere in this batch.
- No text-to-speech was added to any Library screen — none was in scope, and none was added
  speculatively.
- No source metadata (title, filename, tags, course, semester) is ever logged — see "Security and
  privacy" below.
- **VoiceOver/TalkBack have not been runtime-tested for these new screens.** Every claim above is a
  code-level, static-evidence claim, exactly like the rest of `docs/accessibility-foundation.md`'s
  existing "implemented vs. runtime-confirmed vs. pending device verification" framing (see that
  document's §2). Do not describe Library accessibility as device-verified until a real pass has
  happened.

## Development fixture behavior

`src/domain/librarySeed.ts` exports `seedDevLibraryFixtures`/`resetDevLibraryFixtures`, both
no-ops unless `__DEV__` is true. Wired into `app/dev-tools.tsx`, which is itself gated behind
`if (!__DEV__)` with no production-reachable entry point (see `docs/platform-scope.md`'s
"Development-only route guards" section — the Home long-press/gear-icon entry to Dev Tools is
already `__DEV__`-only, and this batch adds nothing new to that entry path).

Fixtures are entirely generic placeholder study-topic names (Calculus Chapter 3, Database
Normalization Notes, AWS SysOps Review Notes, Network Diagram, Lecture 04, plus a long-title
fixture, an archived fixture, and a multi-collection fixture) — no real school, professor, account,
or personal information. Seeding never creates a file; every fixture is metadata only, the same as
anything a real user could enter through Add Source Details. Reset removes only Library sources
and collections for the current workspace (`setLibrarySources`/`setSourceCollections` to empty
arrays) — it never touches decks, cards, sessions, or account state, and requires an explicit
confirmation dialog before running.

## Known limitations

- No real file intake exists — Add/Edit Source Details is a metadata-only form; there is no file
  picker anywhere in this batch.
- "Recently used" sorting only reflects metadata edits, not real study/generation usage (see
  "Sorting/filtering/search behavior" above).
- Collection assignment (in Add/Edit Source Details, and in the dedicated Manage Collections
  screen) is a flat multi-select chip list — there is no search/filter within the collection picker
  itself; this is fine at small collection counts and would need revisiting if a user accumulates
  dozens of collections.
- File size and audio duration are entered by the user as plain numbers (MB / minutes) rather than
  derived from a real file, since no real file exists to derive them from.
- Library metadata is local-device-scoped per account, exactly like decks/cards — it does **not**
  sync across a signed-in user's devices. This is not a bug relative to this batch's scope (no
  Library sync exists yet — see `docs/library-and-source-architecture.md` §12), but it is a real,
  disclosed limitation: creating a source on one device will not appear on another device signed
  into the same account.
- No VoiceOver/TalkBack device testing has been performed on any Library screen (see
  "Accessibility implementation" above).

## Confirmation: no real source content is stored

Verified by direct code review of every new file in this batch: no file picker, no
`expo-document-picker`/`expo-file-system` binary read, no file URI persisted to storage, no AWS
SDK import, no Cognito import, no network call, no AI client, and no field on `LibrarySourceRecord`
capable of holding binary content, a URI, extracted text, or generated study material. Every field
is a plain string, number, boolean, string array, or ISO timestamp describing metadata about a
source a user typed in by hand.

## Future integration seams

Documented here so a future implementation phase knows where this foundation expects to be
extended, without this batch guessing at how:

- `LibrarySourceRecord` has no `ownerId` — a future cloud-adoption flow (per
  `docs/library-and-source-architecture.md` §18) would add a parallel cloud record keyed by
  Cognito `sub`, not retrofit one onto the local record's identity.
- `processingStatus` is deliberately narrow (`ready`/`needsReview`/`archived`) — a real intake
  pipeline would need `uploading`/`processing`/`failed`/`unsupported` states, intentionally not
  added here since nothing in this batch could ever produce them honestly.
- `extractionVersion`, `extractedTextReference`, and provenance fields from
  `docs/library-and-source-architecture.md` §3's full `LibrarySource` model are intentionally
  absent from this batch's `LibrarySourceRecord` — they describe a real extraction pipeline this
  batch does not implement.
- The dirty/rev fields exist on `LibrarySourceRecord`/`SourceCollectionRecord` but are never read
  by any sync path — they are shape-preparation only, per the mission's explicit instruction, not a
  claim that Library sync exists.

## Founder runtime QA checklist

See the Final Report's "Manual founder QA checklist" section for the full checklist. Nothing in
that checklist is marked passed by this document — every item requires an actual manual pass on a
real device/simulator, consistent with `docs/v3-beta-release-checklist.md`'s existing standard of
only marking an item `[x]` once it has actually been done.
