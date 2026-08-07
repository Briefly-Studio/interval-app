import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import { searchSourceCollections } from "../../../src/domain/libraryOrganize";
import { useTranslation } from "../../../src/i18n";
import type { LibrarySourceRecord } from "../../../src/models/librarySource";
import type { SourceCollectionRecord } from "../../../src/models/sourceCollection";
import { getActiveLibrarySources } from "../../../src/storage/librarySources";
import { getActiveSourceCollections } from "../../../src/storage/sourceCollections";
import { useTheme } from "@/src/theme";
import { Button } from "../../../src/ui/Button";
import { Card } from "../../../src/ui/Card";
import { EmptyState } from "../../../src/ui/EmptyState";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";
import { TextField } from "../../../src/ui/TextField";

export default function SourceCollectionsScreen() {
  const router = useRouter();
  const { t, plural } = useTranslation();
  const { colors, iconSizes, spacing, touchTarget, typography } = useTheme();

  const [collections, setCollections] = useState<SourceCollectionRecord[]>([]);
  const [sources, setSources] = useState<LibrarySourceRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const scope = await AuthService.getActiveScope();
    const [cols, srcs] = await Promise.all([getActiveSourceCollections(scope), getActiveLibrarySources(scope)]);
    setCollections(cols);
    setSources(srcs);
    setLoaded(true);
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

  const countFor = (collectionId: string) => sources.filter((s) => s.collectionIds.includes(collectionId)).length;

  // Filtering runs fresh against whatever `collections` currently holds — there is no separate,
  // duplicated "filtered collections" dataset kept in storage or state; `filtered` is derived on
  // every render, so a create/rename/delete (each of which reloads `collections` via the focus
  // effect above) is reflected here automatically, including clearing a search result that no
  // longer applies (e.g. the matching collection was just deleted from its own detail screen).
  const filtered = useMemo(() => searchSourceCollections(collections, query), [collections, query]);

  const isEmpty = loaded && collections.length === 0;
  const isFilteredEmpty = loaded && !isEmpty && filtered.length === 0;

  return (
    <Screen>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        <Text style={[typography.title, styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1} accessibilityRole="header">
          {t("sourceCollections.screenTitle")}
        </Text>
      </View>
      <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("sourceCollections.subtitle")}</Text>

      <Button
        label={t("sourceCollections.newButton")}
        variant="primary"
        onPress={() => router.push({ pathname: "/library/collections/create" as any })}
      />

      {isEmpty ? (
        <View style={styles.emptyFill}>
          <EmptyState icon="albums-outline" title={t("sourceCollections.emptyTitle")} description={t("sourceCollections.emptyDescription")} />
        </View>
      ) : (
        <>
          <View style={[styles.searchRow, { gap: spacing.sm }]}>
            <Ionicons name="search-outline" size={iconSizes.md} color={colors.textSecondary} />
            <View style={styles.flex1}>
              <TextField
                label={t("sourceCollections.searchLabel")}
                placeholder={t("sourceCollections.searchPlaceholder")}
                value={query}
                onChangeText={setQuery}
                accessibilityHint={t("sourceCollections.searchHint")}
              />
            </View>
            {query.length > 0 ? (
              <IconButton
                name="close-circle"
                accessibilityLabel={t("sourceCollections.clearSearchLabel")}
                variant="ghost"
                onPress={() => setQuery("")}
              />
            ) : null}
          </View>

          {isFilteredEmpty ? (
            <View style={styles.emptyFill}>
              <EmptyState icon="search-outline" title={t("sourceCollections.noResultsTitle")} description={t("sourceCollections.noResultsDescription")}>
                <Button label={t("sourceCollections.clearSearchLabel")} variant="secondary" fullWidth onPress={() => setQuery("")} />
              </EmptyState>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              style={styles.list}
              contentContainerStyle={[styles.listContent, { gap: spacing.sm, paddingBottom: spacing.xl }]}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => router.push({ pathname: "/library/collections/[id]" as any, params: { id: item.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={t("sourceCollections.rowAccessibilityLabel", { name: item.name, count: countFor(item.id) })}
                  style={({ pressed }) => [pressed && styles.pressed, { minHeight: touchTarget.min }]}
                >
                  <Card style={[styles.row, { gap: spacing.sm }]}>
                    <Text style={[typography.bodyMedium, styles.rowLabel, { color: colors.textPrimary }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={[typography.caption, { color: colors.textSecondary }]}>{plural("sourceCollections.sourceCount", countFor(item.id))}</Text>
                  </Card>
                </Pressable>
              )}
            />
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  headerTitle: { flex: 1 },
  flex1: { flex: 1 },
  searchRow: { flexDirection: "row", alignItems: "center" },
  emptyFill: { flex: 1, justifyContent: "center" },
  list: { flex: 1 },
  listContent: {},
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowLabel: { flex: 1 },
  pressed: { opacity: 0.85 },
});
