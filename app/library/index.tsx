import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../src/auth/AuthService";
import { onWorkspaceChanged } from "../../src/auth/authSignal";
import {
  distinctCourses,
  distinctSemesters,
  filterLibrarySources,
  getUnfiledLibrarySources,
  searchLibrarySources,
  sortLibrarySources,
  type SortOption,
} from "../../src/domain/libraryOrganize";
import { ALL_SOURCE_TYPES, SOURCE_TYPE_LABEL_KEYS } from "../../src/domain/librarySourceLabels";
import { useTranslation } from "../../src/i18n";
import type { LibrarySourceRecord } from "../../src/models/librarySource";
import type { SourceCollectionRecord } from "../../src/models/sourceCollection";
import {
  archiveLibrarySource,
  getActiveLibrarySources,
  getArchivedLibrarySources,
  restoreLibrarySource,
  softDeleteLibrarySource,
} from "../../src/storage/librarySources";
import { getActiveSourceCollections } from "../../src/storage/sourceCollections";
import { useTheme } from "@/src/theme";
import { Button } from "../../src/ui/Button";
import { EmptyState } from "../../src/ui/EmptyState";
import { FilterChip } from "../../src/ui/FilterChip";
import { IconButton } from "../../src/ui/IconButton";
import { Screen } from "../../src/ui/Screen";
import { SecondaryAction } from "../../src/ui/SecondaryAction";
import { showSourceActionsSheet } from "../../src/ui/sourceActionsSheet";
import { SourceCard } from "../../src/ui/SourceCard";
import { TextField } from "../../src/ui/TextField";

type LibraryView = "active" | "archived";

const SORTS: { value: SortOption; labelKey: string }[] = [
  { value: "recentlyUsed", labelKey: "library.sort.recentlyUsed" },
  { value: "recentlyAdded", labelKey: "library.sort.recentlyAdded" },
  { value: "alphabetical", labelKey: "library.sort.alphabetical" },
  { value: "newest", labelKey: "library.sort.newest" },
  { value: "oldest", labelKey: "library.sort.oldest" },
];

export default function LibraryScreen() {
  const router = useRouter();
  const { t, plural } = useTranslation();
  const { colors, iconSizes, spacing, touchTarget, typography } = useTheme();

  const [view, setView] = useState<LibraryView>("active");
  const [activeSources, setActiveSources] = useState<LibrarySourceRecord[]>([]);
  const [archivedSources, setArchivedSources] = useState<LibrarySourceRecord[]>([]);
  const [collections, setCollections] = useState<SourceCollectionRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOption>("recentlyAdded");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [courseFilter, setCourseFilter] = useState<string | null>(null);
  const [semesterFilter, setSemesterFilter] = useState<string | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const load = useCallback(async () => {
    const scope = await AuthService.getActiveScope();
    const [active, archived, cols] = await Promise.all([
      getActiveLibrarySources(scope),
      getArchivedLibrarySources(scope),
      getActiveSourceCollections(scope),
    ]);
    setActiveSources(active);
    setArchivedSources(archived);
    setCollections(cols);
    setLoaded(true);

    // A selected filter can outlive the thing it points at — e.g. a collection deleted from
    // another screen while it was selected here. Clear any filter whose value no longer
    // resolves against the freshly-loaded data, every time that data reloads.
    setTypeFilter((prev) => (prev && !active.some((s) => s.sourceType === prev) && !archived.some((s) => s.sourceType === prev) ? null : prev));
    setCourseFilter((prev) => (prev && !distinctCourses(active).includes(prev) && !distinctCourses(archived).includes(prev) ? null : prev));
    setSemesterFilter((prev) => (prev && !distinctSemesters(active).includes(prev) && !distinctSemesters(archived).includes(prev) ? null : prev));
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!alive) return;
        await load();
      })();
      return () => {
        alive = false;
      };
    }, [load])
  );

  // Home and Settings both also subscribe directly to workspace changes (not just useFocusEffect)
  // so a background sign-out (e.g. an expired-session forced sign-out) can't leave this screen
  // showing the previous account's Library while it stays focused and nothing navigates. Library
  // is this app's closest analog to those two "hub" screens.
  useEffect(() => onWorkspaceChanged(() => load()), [load]);

  const [sourceActionBusy, setSourceActionBusy] = useState(false);

  const confirmDeleteSource = (source: LibrarySourceRecord) => {
    if (sourceActionBusy) return;
    Alert.alert(t("librarySource.detail.deleteTitle"), t("librarySource.detail.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("librarySource.detail.deleteAction"),
        style: "destructive",
        onPress: async () => {
          setSourceActionBusy(true);
          try {
            const scope = await AuthService.getActiveScope();
            await softDeleteLibrarySource(scope, source.id);
            await load();
          } catch {
            Alert.alert(t("librarySource.detail.actionFailedTitle"), t("librarySource.detail.actionFailedBody"));
          } finally {
            setSourceActionBusy(false);
          }
        },
      },
    ]);
  };

  const onSourceLongPress = (source: LibrarySourceRecord) => {
    showSourceActionsSheet({
      t,
      onEdit: () => router.push({ pathname: "/library/[id]/edit" as any, params: { id: source.id } }),
      onChooseCollections: () => router.push({ pathname: "/library/[id]/collections" as any, params: { id: source.id } }),
      isArchived: !!source.archivedAt,
      onArchive: async () => {
        if (sourceActionBusy) return;
        setSourceActionBusy(true);
        try {
          const scope = await AuthService.getActiveScope();
          await archiveLibrarySource(scope, source.id);
          await load();
        } catch {
          Alert.alert(t("librarySource.detail.actionFailedTitle"), t("librarySource.detail.actionFailedBody"));
        } finally {
          setSourceActionBusy(false);
        }
      },
      onRestore: async () => {
        if (sourceActionBusy) return;
        setSourceActionBusy(true);
        try {
          const scope = await AuthService.getActiveScope();
          await restoreLibrarySource(scope, source.id);
          await load();
        } catch {
          Alert.alert(t("librarySource.detail.actionFailedTitle"), t("librarySource.detail.actionFailedBody"));
        } finally {
          setSourceActionBusy(false);
        }
      },
      onDelete: () => confirmDeleteSource(source),
    });
  };

  const totalActiveCount = activeSources.length;
  const totalArchivedCount = archivedSources.length;
  // Genuinely nothing anywhere — the real first-use empty state. Distinct from "this particular
  // view/filter combination happens to show nothing" (handled below), which must still leave the
  // scope toggle reachable so the user can switch to the view that does have content.
  const isTrulyEmpty = loaded && totalActiveCount === 0 && totalArchivedCount === 0;

  // ROOT LIBRARY ORGANIZATION RULE — see docs/library-and-source-architecture.md's "Root Library
  // rule": the Active view shows only UNFILED sources (zero active collection memberships); a
  // filed source lives in its collection's own detail screen instead (app/library/collections/[id].tsx),
  // never duplicated here. This deliberately does NOT apply to the Archived view — Collection
  // Detail only ever queries getActiveLibrarySources, so an archived-and-filed source has no other
  // screen it would remain reachable from if this same rule applied there; Archived intentionally
  // keeps showing every archived source regardless of collection membership.
  const unfiledActiveSources = useMemo(
    () => getUnfiledLibrarySources(activeSources, collections),
    [activeSources, collections]
  );
  const baseList = view === "active" ? unfiledActiveSources : archivedSources;
  // Distinguishes "you have zero active sources at all" from "every active source is filed into a
  // collection" — the Active view can be legitimately empty for either reason, and they need
  // different empty-state copy (see isScopeEmpty's use below).
  const isAllFiled = view === "active" && totalActiveCount > 0 && unfiledActiveSources.length === 0;

  const presentTypes = useMemo(
    () => ALL_SOURCE_TYPES.filter((type) => baseList.some((s) => s.sourceType === type)),
    [baseList]
  );
  const courses = useMemo(() => distinctCourses(baseList), [baseList]);
  const semesters = useMemo(() => distinctSemesters(baseList), [baseList]);

  // Search/sort/filter operate over the root/unfiled set for the Active view (baseList already
  // narrowed above) — this is the narrowest interpretation per
  // docs/library-and-source-architecture.md's "Search/sort/filter" section: there is no existing
  // product contract for a global cross-collection search from root, so root search stays scoped
  // to exactly what root shows, matching Collection Detail's own screen-scoped search precedent.
  const filtered = useMemo(() => {
    let list = filterLibrarySources(baseList, {
      sourceType: (typeFilter as any) || undefined,
      course: courseFilter || undefined,
      semester: semesterFilter || undefined,
    });
    list = searchLibrarySources(list, query);
    return sortLibrarySources(list, sort);
  }, [baseList, typeFilter, courseFilter, semesterFilter, query, sort]);

  const activeFilterCount = [typeFilter, courseFilter, semesterFilter].filter(Boolean).length;
  const hasAnyFilter = activeFilterCount > 0 || Boolean(query.trim());
  const clearFilters = () => {
    setTypeFilter(null);
    setCourseFilter(null);
    setSemesterFilter(null);
    setQuery("");
  };

  const isScopeEmpty = loaded && !isTrulyEmpty && baseList.length === 0;
  const isFilteredEmpty = loaded && !isTrulyEmpty && !isScopeEmpty && filtered.length === 0;

  // Collections and Recently Deleted must stay reachable regardless of how many active sources
  // exist — including zero. Previously this row only rendered inside the non-empty branch below,
  // so a Library with, say, only deleted sources (nothing active, nothing archived — still
  // "isTrulyEmpty" by that definition) rendered a completely separate layout with no way to reach
  // Recently Deleted at all, forcing a new source to be created just to recover an old one. It is
  // rendered exactly once, above the branch below, so neither branch duplicates it.
  const utilityRow = (
    <View style={[styles.secondaryRow, { gap: spacing.sm }]}>
      <SecondaryAction
        icon="albums-outline"
        label={t("library.collectionsButton")}
        onPress={() => router.push({ pathname: "/library/collections" as any })}
      />
      <SecondaryAction
        icon="trash-outline"
        label={t("library.recentlyDeletedButton")}
        onPress={() => router.push({ pathname: "/library/deleted" as any })}
      />
    </View>
  );

  const summaryText =
    loaded && (totalActiveCount > 0 || totalArchivedCount > 0 || collections.length > 0) ? (
      <Text style={[typography.caption, { color: colors.textSecondary }]}>
        {t("library.summary", { sources: totalActiveCount, collections: collections.length, archived: totalArchivedCount })}
      </Text>
    ) : null;

  if (isTrulyEmpty) {
    return (
      <Screen>
        <View style={[styles.header, { gap: spacing.sm }]}>
          <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
          <Text style={[typography.title, styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1} accessibilityRole="header">
            {t("library.screenTitle")}
          </Text>
          <IconButton
            name="add"
            accessibilityLabel={t("library.addSourceButton")}
            variant="surface"
            onPress={() => router.push({ pathname: "/library/add" as any })}
          />
        </View>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("library.subtitle")}</Text>
        {utilityRow}
        {summaryText}
        <View style={styles.emptyFill}>
          <EmptyState icon="library-outline" title={t("library.emptyTitle")} description={t("library.emptyDescription")}>
            <Button label={t("library.emptyAction")} variant="primary" fullWidth onPress={() => router.push({ pathname: "/library/add" as any })} />
          </EmptyState>
        </View>
      </Screen>
    );
  }

  const listHeader = (
    <View style={{ gap: spacing.lg }}>
      <View style={[styles.searchRow, { gap: spacing.sm }]}>
        <Ionicons name="search-outline" size={iconSizes.md} color={colors.textSecondary} />
        <View style={styles.flex1}>
          <TextField
            label={t("library.searchLabel")}
            placeholder={t("library.searchPlaceholder")}
            value={query}
            onChangeText={setQuery}
            accessibilityHint={t("library.searchHint")}
          />
        </View>
        {query.length > 0 ? (
          <IconButton name="close-circle" accessibilityLabel={t("library.clearSearchLabel")} variant="ghost" onPress={() => setQuery("")} />
        ) : null}
      </View>

      <View style={[styles.viewRow, { gap: spacing.sm }]} accessibilityRole="radiogroup">
        <FilterChip label={t("library.views.active")} selected={view === "active"} onPress={() => setView("active")} />
        <FilterChip
          label={t("library.views.archived", { count: totalArchivedCount })}
          selected={view === "archived"}
          onPress={() => setView("archived")}
        />
      </View>

      <View>
        <Pressable
          onPress={() => setFiltersExpanded((prev) => !prev)}
          accessibilityRole="button"
          accessibilityState={{ expanded: filtersExpanded }}
          style={[styles.filtersToggle, { minHeight: touchTarget.min }]}
        >
          <View style={[styles.filtersToggleLabel, { gap: spacing.xs }]}>
            <Text style={[typography.subheading, { color: colors.textPrimary }]}>{t("library.filtersHeading")}</Text>
            {activeFilterCount > 0 ? (
              <Text style={[typography.caption, { color: colors.accent }]}>{plural("library.filtersActiveCount", activeFilterCount)}</Text>
            ) : null}
          </View>
          {!filtersExpanded && hasAnyFilter ? (
            <Pressable onPress={clearFilters} hitSlop={8}>
              <Text style={[typography.caption, styles.clearInline, { color: colors.accent }]}>{t("library.clearFiltersButton")}</Text>
            </Pressable>
          ) : null}
          <Ionicons name={filtersExpanded ? "chevron-up" : "chevron-down"} size={iconSizes.sm} color={colors.textSecondary} />
        </Pressable>

        {filtersExpanded && (
          <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
            {presentTypes.length > 0 && (
              <View style={{ gap: spacing.xs }}>
                <Text style={[typography.label, { color: colors.textSecondary }]}>{t("library.filterByType")}</Text>
                <View style={[styles.chipRow, { gap: spacing.xs }]} accessibilityRole="radiogroup">
                  <FilterChip label={t("library.allTypes")} selected={!typeFilter} onPress={() => setTypeFilter(null)} />
                  {presentTypes.map((type) => (
                    <FilterChip
                      key={type}
                      label={t(SOURCE_TYPE_LABEL_KEYS[type])}
                      selected={typeFilter === type}
                      onPress={() => setTypeFilter(type)}
                    />
                  ))}
                </View>
              </View>
            )}

            {courses.length > 0 && (
              <View style={{ gap: spacing.xs }}>
                <Text style={[typography.label, { color: colors.textSecondary }]}>{t("library.filterByCourse")}</Text>
                <View style={[styles.chipRow, { gap: spacing.xs }]} accessibilityRole="radiogroup">
                  <FilterChip label={t("library.allCourses")} selected={!courseFilter} onPress={() => setCourseFilter(null)} />
                  {courses.map((course) => (
                    <FilterChip key={course} label={course} selected={courseFilter === course} onPress={() => setCourseFilter(course)} />
                  ))}
                </View>
              </View>
            )}

            {semesters.length > 0 && (
              <View style={{ gap: spacing.xs }}>
                <Text style={[typography.label, { color: colors.textSecondary }]}>{t("library.filterBySemester")}</Text>
                <View style={[styles.chipRow, { gap: spacing.xs }]} accessibilityRole="radiogroup">
                  <FilterChip label={t("library.allSemesters")} selected={!semesterFilter} onPress={() => setSemesterFilter(null)} />
                  {semesters.map((semester) => (
                    <FilterChip
                      key={semester}
                      label={semester}
                      selected={semesterFilter === semester}
                      onPress={() => setSemesterFilter(semester)}
                    />
                  ))}
                </View>
              </View>
            )}

            <View style={{ gap: spacing.xs }}>
              <Text style={[typography.label, { color: colors.textSecondary }]}>{t("library.sortLabel")}</Text>
              <View style={[styles.chipRow, { gap: spacing.xs }]} accessibilityRole="radiogroup">
                {SORTS.map((option) => (
                  <FilterChip key={option.value} label={t(option.labelKey as any)} selected={sort === option.value} onPress={() => setSort(option.value)} />
                ))}
              </View>
            </View>

            {hasAnyFilter ? (
              <Button label={t("library.clearFiltersButton")} variant="secondary" onPress={clearFilters} />
            ) : null}
          </View>
        )}
      </View>

      <Text style={[typography.caption, { color: colors.textSecondary }]}>
        {t("library.showingCount", { shown: filtered.length, total: baseList.length })}
      </Text>
    </View>
  );

  return (
    <Screen>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        <Text style={[typography.title, styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1} accessibilityRole="header">
          {t("library.screenTitle")}
        </Text>
        <IconButton
          name="add"
          accessibilityLabel={t("library.addSourceButton")}
          variant="surface"
          onPress={() => router.push({ pathname: "/library/add" as any })}
        />
      </View>
      <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("library.subtitle")}</Text>
      {utilityRow}
      {summaryText}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={[styles.listContent, { gap: spacing.sm, paddingBottom: spacing.xl }]}
        ListHeaderComponent={listHeader}
        ListHeaderComponentStyle={{ marginBottom: spacing.md }}
        ListEmptyComponent={
          isScopeEmpty ? (
            isAllFiled ? (
              <EmptyState icon="albums-outline" title={t("library.allFiledTitle")} description={t("library.allFiledDescription")}>
                <Button
                  label={t("library.collectionsButton")}
                  variant="primary"
                  fullWidth
                  onPress={() => router.push({ pathname: "/library/collections" as any })}
                />
              </EmptyState>
            ) : (
              <EmptyState
                icon={view === "archived" ? "archive-outline" : "library-outline"}
                title={view === "archived" ? t("library.archivedEmptyTitle") : t("library.activeEmptyTitle")}
                description={view === "archived" ? t("library.archivedEmptyDescription") : t("library.activeEmptyDescription")}
              />
            )
          ) : isFilteredEmpty ? (
            <EmptyState icon="search-outline" title={t("library.noResultsTitle")} description={t("library.noResultsDescription")}>
              {hasAnyFilter ? <Button label={t("library.clearFiltersButton")} variant="secondary" fullWidth onPress={clearFilters} /> : null}
            </EmptyState>
          ) : null
        }
        renderItem={({ item }) => (
          <SourceCard
            source={item}
            collections={collections}
            onPress={() => router.push({ pathname: "/library/[id]" as any, params: { id: item.id } })}
            onLongPress={() => onSourceLongPress(item)}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  headerTitle: { flex: 1 },
  flex1: { flex: 1 },
  secondaryRow: { flexDirection: "row", flexWrap: "wrap" },
  searchRow: { flexDirection: "row", alignItems: "center" },
  viewRow: { flexDirection: "row" },
  filtersToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  filtersToggleLabel: { flexDirection: "row", alignItems: "baseline", flex: 1 },
  clearInline: { fontWeight: "700" },
  chipRow: { flexDirection: "row", flexWrap: "wrap" },
  emptyFill: { flex: 1, justifyContent: "center" },
  list: { flex: 1 },
  listContent: {},
});
