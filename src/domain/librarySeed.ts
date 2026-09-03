// Development-only Library fixture data — never imported or reachable from production code
// paths. See app/dev-tools.tsx, which is itself gated behind isDevToolsEnabled() (keyed to
// INTERVAL_ENV, not the JS bundle's __DEV__ build mode — see src/config/devToolsCapability.ts)
// and has no entry point reachable from production navigation (see docs/platform-scope.md's
// "Development-only route guards" section). The guards below mirror that same gate as
// defense-in-depth, in case either function is ever called from somewhere other than that screen.
//
// Fixtures are entirely generic placeholder study-topic names, not real school, professor,
// account, or personal information — safe to ship in source control and safe to display.
// Nothing here creates a file, a binary, or any content beyond metadata.

import { isDevToolsEnabled } from "../config/devToolsCapability";
import { makeId } from "../models/deck";
import type { LibrarySource } from "../models/librarySource";
import type { SourceCollection } from "../models/sourceCollection";
import { addLibrarySource, archiveLibrarySource, getLibrarySources, setLibrarySources } from "../storage/librarySources";
import { addSourceCollection, getSourceCollections, setSourceCollections } from "../storage/sourceCollections";
import type { WorkspaceScope } from "../storage/workspaceScope";

function baseFixture(overrides: Partial<LibrarySource> & Pick<LibrarySource, "displayTitle" | "sourceType">): LibrarySource {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    originalName: undefined,
    mimeType: undefined,
    extension: undefined,
    fileSize: undefined,
    createdAt: now,
    lastUsedAt: undefined,
    processingStatus: "ready",
    sourceLanguage: undefined,
    pageCount: undefined,
    slideCount: undefined,
    sheetCount: undefined,
    audioDuration: undefined,
    collectionIds: [],
    tags: [],
    course: undefined,
    semester: undefined,
    ...overrides,
  };
}

// Adds a fixed set of generic, representative Library fixtures — long titles, an archived item,
// a multi-collection item, and one of each prioritized source type — so sorting, filtering,
// collections, and empty/non-empty states can all be exercised without a real upload pipeline
// (which does not exist in this batch). Creates two sample collections along the way. Safe to
// call more than once; each call appends a fresh batch rather than deduplicating, since this is a
// throwaway dev aid, not production data.
export async function seedDevLibraryFixtures(scope: WorkspaceScope): Promise<void> {
  if (!isDevToolsEnabled()) return;

  const calculusCollection: SourceCollection = { id: makeId(), name: "Calculus", createdAt: new Date().toISOString() };
  const examPrepCollection: SourceCollection = { id: makeId(), name: "Exam Prep", createdAt: new Date().toISOString() };
  await addSourceCollection(scope, calculusCollection);
  await addSourceCollection(scope, examPrepCollection);

  const fixtures: LibrarySource[] = [
    baseFixture({
      displayTitle: "Calculus Chapter 3",
      sourceType: "pdf",
      originalName: "calculus-ch3.pdf",
      fileSize: 2_400_000,
      pageCount: 18,
      course: "Calculus I",
      semester: "Fall 2026",
      collectionIds: [calculusCollection.id],
    }),
    baseFixture({
      displayTitle: "Database Normalization Notes",
      sourceType: "docx",
      originalName: "db-normalization-notes.docx",
      fileSize: 340_000,
      pageCount: 6,
      course: "Databases",
      tags: ["normalization", "sql"],
    }),
    baseFixture({
      displayTitle: "AWS SysOps Review Notes",
      sourceType: "text",
      tags: ["aws", "sysops", "certification"],
      collectionIds: [examPrepCollection.id],
    }),
    baseFixture({
      displayTitle: "Network Diagram",
      sourceType: "image",
      originalName: "network-diagram.png",
      fileSize: 850_000,
    }),
    baseFixture({
      displayTitle: "Lecture 04",
      sourceType: "audio",
      originalName: "lecture-04.m4a",
      fileSize: 18_500_000,
      audioDuration: 2715,
      course: "Calculus I",
      collectionIds: [calculusCollection.id, examPrepCollection.id],
    }),
    baseFixture({
      displayTitle:
        "A Very Long Source Title Used Only To Verify That Layout Handles Extended Display Titles Gracefully Without Clipping Essential Information",
      sourceType: "pdf",
      fileSize: 1_200_000,
      pageCount: 42,
    }),
  ];

  for (const fixture of fixtures) {
    await addLibrarySource(scope, fixture);
  }

  // Archived fixture — added, then archived, so the Archived view has something to show.
  const archivedSource = baseFixture({ displayTitle: "Old Syllabus (Archived Example)", sourceType: "text" });
  await addLibrarySource(scope, archivedSource);
  await archiveLibrarySource(scope, archivedSource.id);
}

// Removes ONLY Library metadata and collections for the current workspace — never touches
// decks/cards/sessions/accounts. Requires the caller to have already confirmed with the user
// (see app/dev-tools.tsx); this function itself performs no confirmation.
export async function resetDevLibraryFixtures(scope: WorkspaceScope): Promise<void> {
  if (!isDevToolsEnabled()) return;
  await setLibrarySources(scope, []);
  await setSourceCollections(scope, []);
  // Touch both read paths once so any in-memory callers relying on getLibrarySources'
  // write-back-on-read behavior see a consistent, already-empty result immediately.
  await getLibrarySources(scope);
  await getSourceCollections(scope);
}
