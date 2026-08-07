import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import { useTranslation } from "../../../src/i18n";
import type { LibrarySourceRecord } from "../../../src/models/librarySource";
import type { SourceCollectionRecord } from "../../../src/models/sourceCollection";
import { getActiveLibrarySources, removeLibrarySourceFromCollection } from "../../../src/storage/librarySources";
import { getActiveSourceCollections, softDeleteSourceCollection, updateSourceCollection } from "../../../src/storage/sourceCollections";
import { useTheme } from "@/src/theme";
import { Button } from "../../../src/ui/Button";
import { EmptyState } from "../../../src/ui/EmptyState";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";
import { SourceCard } from "../../../src/ui/SourceCard";
import { TextField } from "../../../src/ui/TextField";

const MAX_NAME_LENGTH = 60;

export default function SourceCollectionDetailScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();

  const params = useLocalSearchParams();
  const idParam = params.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? idParam[0] : "";

  const [collection, setCollection] = useState<SourceCollectionRecord | null>(null);
  const [allCollections, setAllCollections] = useState<SourceCollectionRecord[]>([]);
  const [sources, setSources] = useState<LibrarySourceRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [mutating, setMutating] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const scope = await AuthService.getActiveScope();
    const [cols, srcs] = await Promise.all([getActiveSourceCollections(scope), getActiveLibrarySources(scope)]);
    const found = cols.find((c) => c.id === id) ?? null;
    setCollection(found);
    setName(found?.name ?? "");
    setAllCollections(cols);
    setSources(srcs.filter((s) => s.collectionIds.includes(id)));
    setLoaded(true);
  }, [id]);

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

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/library/collections");
  };

  const trimmedName = useMemo(() => name.trim(), [name]);
  const nameChanged = collection ? trimmedName !== collection.name : false;
  const isValidName = trimmedName.length > 0 && trimmedName.length <= MAX_NAME_LENGTH;

  const onRename = async () => {
    if (!collection || !isValidName || !nameChanged || renaming) return;
    setRenaming(true);
    try {
      const scope = await AuthService.getActiveScope();
      const isDuplicate = allCollections.some(
        (c) => c.id !== collection.id && c.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
      if (isDuplicate) {
        Alert.alert(t("sourceCollections.form.nameDuplicateError"));
        return;
      }
      await updateSourceCollection(scope, collection.id, trimmedName);
      await load();
    } catch {
      Alert.alert(t("sourceCollections.form.saveFailedTitle"), t("sourceCollections.form.saveFailedBody"));
    } finally {
      setRenaming(false);
    }
  };

  const confirmDeleteCollection = () => {
    if (!collection || mutating) return;
    Alert.alert(t("sourceCollections.detail.deleteTitle"), t("sourceCollections.detail.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("sourceCollections.detail.deleteAction"),
        style: "destructive",
        onPress: async () => {
          setMutating(true);
          try {
            const scope = await AuthService.getActiveScope();
            await softDeleteSourceCollection(scope, collection.id);
            goBack();
          } catch {
            Alert.alert(t("sourceCollections.form.saveFailedTitle"), t("sourceCollections.form.saveFailedBody"));
          } finally {
            setMutating(false);
          }
        },
      },
    ]);
  };

  const onRemoveSource = async (source: LibrarySourceRecord) => {
    if (!collection || mutating) return;
    setMutating(true);
    try {
      const scope = await AuthService.getActiveScope();
      await removeLibrarySourceFromCollection(scope, source.id, collection.id);
      await load();
    } catch {
      Alert.alert(t("sourceCollections.form.saveFailedTitle"), t("sourceCollections.form.saveFailedBody"));
    } finally {
      setMutating(false);
    }
  };

  if (loaded && !collection) {
    return (
      <Screen>
        <View style={[styles.header, { gap: spacing.sm }]}>
          <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={goBack} />
        </View>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("sourceCollections.detail.notFound")}</Text>
      </Screen>
    );
  }

  const listHeader = (
    <View style={{ gap: spacing.md }}>
      <View style={[styles.renameRow, { gap: spacing.sm }]}>
        <TextField
          label={t("sourceCollections.form.nameLabel")}
          value={name}
          onChangeText={setName}
          editable={!renaming && !mutating}
        />
        <Button
          label={t("sourceCollections.detail.renameAction")}
          variant="secondary"
          disabled={!isValidName || !nameChanged}
          loading={renaming}
          onPress={onRename}
        />
      </View>

      <Button label={t("sourceCollections.detail.deleteAction")} variant="danger" fullWidth disabled={mutating} onPress={confirmDeleteCollection} />

      <Text style={[typography.subheading, { color: colors.textPrimary }]}>{t("sourceCollections.detail.sourcesSectionTitle")}</Text>
    </View>
  );

  return (
    <Screen>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={goBack} />
        <Text style={[typography.title, styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1} accessibilityRole="header">
          {collection?.name ?? ""}
        </Text>
      </View>

      <FlatList
        data={sources}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={[styles.listContent, { gap: spacing.sm, paddingBottom: spacing.xl }]}
        ListHeaderComponent={listHeader}
        ListHeaderComponentStyle={{ marginBottom: spacing.md }}
        ListEmptyComponent={
          <EmptyState icon="document-outline" title={t("sourceCollections.detail.emptySourcesTitle")} description={t("sourceCollections.detail.emptySourcesDescription")} />
        }
        renderItem={({ item }) => (
          <View style={{ gap: spacing.xs }}>
            <SourceCard
              source={item}
              collections={allCollections}
              onPress={() => router.push({ pathname: "/library/[id]" as any, params: { id: item.id } })}
            />
            <Button
              label={t("sourceCollections.detail.removeFromCollectionAction")}
              variant="ghost"
              disabled={mutating}
              onPress={() => onRemoveSource(item)}
            />
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  headerTitle: { flex: 1 },
  renameRow: { flexDirection: "row", alignItems: "flex-end" },
  list: { flex: 1 },
  listContent: {},
});
