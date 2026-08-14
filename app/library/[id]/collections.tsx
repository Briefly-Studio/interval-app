import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import { useTranslation } from "../../../src/i18n";
import type { LibrarySourceRecord } from "../../../src/models/librarySource";
import type { SourceCollectionRecord } from "../../../src/models/sourceCollection";
import { getLibrarySources, updateLibrarySource } from "../../../src/storage/librarySources";
import { getActiveSourceCollections } from "../../../src/storage/sourceCollections";
import { useTheme } from "@/src/theme";
import { Button } from "../../../src/ui/Button";
import { EmptyState } from "../../../src/ui/EmptyState";
import { FilterChip } from "../../../src/ui/FilterChip";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";

// A dedicated, focused screen for changing which collections a source belongs to — separate from
// the full Edit Source Details form. Reachable directly from Source Details' "Choose collections"
// action. Its own useFocusEffect reload means creating a new collection from here (via "+ New
// collection" -> Create Collection -> back) returns to this exact screen with the new collection
// already available to check, without losing the source context — see
// docs/library-ui-foundation.md.
export default function ManageSourceCollectionsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();

  const params = useLocalSearchParams();
  const idParam = params.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? idParam[0] : "";

  const [source, setSource] = useState<LibrarySourceRecord | null>(null);
  const [collections, setCollections] = useState<SourceCollectionRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Tracks whether selectedIds has been seeded from the saved record for the current `id` yet.
  // Reset to false whenever `id` changes, so navigating between different sources' collection
  // screens each get their own fresh seed. Deliberately NOT reset on every focus — that's what
  // lets returning from "+ New collection" (a refocus, same id) keep the user's in-progress
  // checks instead of reverting them to whatever was last saved.
  const seededForId = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!id) return;
        const scope = await AuthService.getActiveScope();
        const [all, cols] = await Promise.all([getLibrarySources(scope), getActiveSourceCollections(scope)]);
        const found = all.find((s) => s.id === id) ?? null;
        if (!alive) return;
        setSource(found);
        setCollections(cols);
        if (found && seededForId.current !== id) {
          setSelectedIds(found.collectionIds);
          seededForId.current = id;
        }
        setLoaded(true);
      })();
      return () => {
        alive = false;
      };
    }, [id])
  );

  const toggle = (collectionId: string) => {
    setSelectedIds((prev) => (prev.includes(collectionId) ? prev.filter((c) => c !== collectionId) : [...prev, collectionId]));
  };

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace({ pathname: "/library/[id]" as any, params: { id } });
  };

  const onSave = async () => {
    if (!source || submitting) return;
    setSubmitting(true);
    try {
      const scope = await AuthService.getActiveScope();
      await updateLibrarySource(scope, source.id, { collectionIds: selectedIds });
      goBack();
    } catch {
      Alert.alert(t("librarySource.form.saveFailedTitle"), t("librarySource.form.saveFailedBody"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loaded && !source) {
    return (
      <Screen>
        <View style={[styles.header, { gap: spacing.sm }]}>
          <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={goBack} />
        </View>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("librarySource.detail.notFound")}</Text>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.cancel")} onPress={goBack} disabled={submitting} />
        <Text style={[typography.title, styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1} accessibilityRole="header">
          {t("librarySource.manageCollections.screenTitle")}
        </Text>
      </View>
      <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("librarySource.manageCollections.subtitle")}</Text>

      {collections.length === 0 ? (
        <EmptyState
          icon="albums-outline"
          title={t("librarySource.manageCollections.emptyTitle")}
          description={t("librarySource.manageCollections.emptyDescription")}
        >
          <Button
            label={t("librarySource.manageCollections.newCollectionButton")}
            variant="secondary"
            fullWidth
            onPress={() => router.push({ pathname: "/library/collections/create" as any })}
          />
        </EmptyState>
      ) : (
        <>
          <View style={[styles.chipRow, { gap: spacing.xs }]}>
            {collections.map((collection) => (
              <FilterChip
                key={collection.id}
                role="checkbox"
                label={collection.name}
                selected={selectedIds.includes(collection.id)}
                onPress={() => toggle(collection.id)}
              />
            ))}
          </View>
          <Button
            label={t("librarySource.manageCollections.newCollectionButton")}
            variant="ghost"
            onPress={() => router.push({ pathname: "/library/collections/create" as any })}
          />
        </>
      )}

      <Button
        label={t("librarySource.manageCollections.saveButton")}
        variant="primary"
        fullWidth
        loading={submitting}
        disabled={!source}
        onPress={onSave}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  headerTitle: { flex: 1 },
  chipRow: { flexDirection: "row", flexWrap: "wrap" },
});
