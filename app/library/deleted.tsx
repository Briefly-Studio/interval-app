import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../src/auth/AuthService";
import { SOURCE_TYPE_LABEL_KEYS } from "../../src/domain/librarySourceLabels";
import { useTranslation } from "../../src/i18n";
import type { LibrarySourceRecord } from "../../src/models/librarySource";
import { getDeletedLibrarySources, restoreLibrarySource } from "../../src/storage/librarySources";
import { useTheme } from "@/src/theme";
import { Button } from "../../src/ui/Button";
import { Card } from "../../src/ui/Card";
import { EmptyState } from "../../src/ui/EmptyState";
import { IconButton } from "../../src/ui/IconButton";
import { Screen } from "../../src/ui/Screen";

// Deliberately separate from app/recently-deleted.tsx (decks/cards) rather than folded into it —
// that screen's restore logic is tightly coupled to deck/card recovery semantics
// (resolveCardRestoreTarget, recovery-deck creation), and Library sources have none of that. A
// small, self-contained screen avoids forcing that coupling. See docs/library-ui-foundation.md.
export default function LibraryDeletedScreen() {
  const router = useRouter();
  const { t, language } = useTranslation();
  const { colors, spacing, typography } = useTheme();

  const [deleted, setDeleted] = useState<LibrarySourceRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const scope = await AuthService.getActiveScope();
    const sources = await getDeletedLibrarySources(scope);
    sources.sort((a, b) => (Date.parse(b.deletedAt ?? "") || 0) - (Date.parse(a.deletedAt ?? "") || 0));
    setDeleted(sources);
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

  const onRestore = async (source: LibrarySourceRecord) => {
    if (restoringIds.has(source.id)) return;
    setRestoringIds((prev) => new Set(prev).add(source.id));
    try {
      const scope = await AuthService.getActiveScope();
      await restoreLibrarySource(scope, source.id);
      await load();
    } catch {
      Alert.alert(t("library.deleted.restoreFailedTitle"), t("library.deleted.restoreFailedBody"));
    } finally {
      setRestoringIds((prev) => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
    }
  };

  const isEmpty = loaded && deleted.length === 0;

  return (
    <Screen>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        <Text style={[typography.title, styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1} accessibilityRole="header">
          {t("library.deleted.screenTitle")}
        </Text>
      </View>
      <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("library.deleted.subtitle")}</Text>

      {isEmpty ? (
        <View style={styles.emptyFill}>
          <EmptyState icon="trash-outline" title={t("library.deleted.emptyTitle")} description={t("library.deleted.emptyDescription")} />
        </View>
      ) : (
        <FlatList
          data={deleted}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={[styles.listContent, { gap: spacing.sm, paddingBottom: spacing.xl }]}
          renderItem={({ item }) => {
            const isRestoring = restoringIds.has(item.id);
            return (
              <Card style={[styles.row, { gap: spacing.sm }]}>
                <View style={styles.flex1}>
                  <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={2}>
                    {item.displayTitle}
                  </Text>
                  <Text style={[typography.caption, { color: colors.textSecondary }]}>
                    {t(SOURCE_TYPE_LABEL_KEYS[item.sourceType])} · {new Date(item.deletedAt ?? item.updatedAt).toLocaleDateString(language)}
                  </Text>
                </View>
                <Button
                  label={isRestoring ? t("library.deleted.restoring") : t("library.deleted.restore")}
                  variant="secondary"
                  loading={isRestoring}
                  disabled={isRestoring}
                  onPress={() => onRestore(item)}
                  accessibilityLabel={
                    isRestoring
                      ? t("library.deleted.restoringLabel", { title: item.displayTitle })
                      : t("library.deleted.restoreLabel", { title: item.displayTitle })
                  }
                />
              </Card>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  headerTitle: { flex: 1 },
  emptyFill: { flex: 1, justifyContent: "center" },
  list: { flex: 1 },
  listContent: {},
  flex1: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
