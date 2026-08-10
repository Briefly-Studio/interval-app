import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../src/auth/AuthService";
import { sortDecksCanonical } from "../../src/domain/deckOrder";
import { useTranslation } from "../../src/i18n";
import type { DeckRecord } from "../../src/models/deck";
import type { DeckCollectionRecord } from "../../src/models/deckCollection";
import { deleteDeckById, getDecksAll } from "../../src/storage/decks";
import {
  getActiveDeckCollections,
  renameDeckCollection,
  softDeleteDeckCollection,
  unassignDeckFromCollection,
} from "../../src/storage/deckCollections";
import { useTheme } from "@/src/theme";
import { Button } from "../../src/ui/Button";
import { DeckCard } from "../../src/ui/DeckCard";
import { showDeckActionsSheet } from "../../src/ui/deckActionsSheet";
import { EmptyState } from "../../src/ui/EmptyState";
import { IconButton } from "../../src/ui/IconButton";
import { Screen } from "../../src/ui/Screen";
import { TextField } from "../../src/ui/TextField";

const MAX_NAME_LENGTH = 60;

export default function DeckCollectionDetailScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();

  const params = useLocalSearchParams();
  const idParam = params.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? idParam[0] : "";

  const [collection, setCollection] = useState<DeckCollectionRecord | null>(null);
  const [allCollections, setAllCollections] = useState<DeckCollectionRecord[]>([]);
  const [decks, setDecks] = useState<DeckRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [mutating, setMutating] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const scope = await AuthService.getActiveScope();
    const [cols, allDecks] = await Promise.all([getActiveDeckCollections(scope), getDecksAll(scope)]);
    const found = cols.find((c) => c.id === id) ?? null;
    setCollection(found);
    setName(found?.name ?? "");
    setAllCollections(cols);
    const activeDecks = allDecks.filter((d) => !d.deletedAt);
    const memberIds = new Set(found?.deckIds ?? []);
    setDecks(sortDecksCanonical(activeDecks.filter((d) => memberIds.has(d.id))));
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
    router.replace("/");
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
        Alert.alert(t("deckCollections.form.nameDuplicateError"));
        return;
      }
      await renameDeckCollection(scope, collection.id, trimmedName);
      await load();
    } catch {
      Alert.alert(t("deckCollections.form.saveFailedTitle"), t("deckCollections.form.saveFailedBody"));
    } finally {
      setRenaming(false);
    }
  };

  const confirmDeleteCollection = () => {
    if (!collection || mutating) return;
    Alert.alert(t("deckCollections.detail.deleteTitle"), t("deckCollections.detail.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("deckCollections.detail.deleteAction"),
        style: "destructive",
        onPress: async () => {
          setMutating(true);
          try {
            const scope = await AuthService.getActiveScope();
            await softDeleteDeckCollection(scope, collection.id);
            goBack();
          } catch {
            Alert.alert(t("deckCollections.form.saveFailedTitle"), t("deckCollections.form.saveFailedBody"));
          } finally {
            setMutating(false);
          }
        },
      },
    ]);
  };

  const onRemoveDeck = async (deck: DeckRecord) => {
    if (!collection || mutating) return;
    setMutating(true);
    try {
      const scope = await AuthService.getActiveScope();
      await unassignDeckFromCollection(scope, deck.id);
      await load();
    } catch {
      Alert.alert(t("deckCollections.form.saveFailedTitle"), t("deckCollections.form.saveFailedBody"));
    } finally {
      setMutating(false);
    }
  };

  // Same rename/delete action sheet as Home (app/index.tsx), via the shared helper — a deck
  // shown here is still a full deck, so it gets the same management actions, plus "Remove from
  // collection" since every deck on this screen is, by definition, currently assigned here.
  const confirmDeleteDeck = (deck: DeckRecord) => {
    if (mutating) return;
    Alert.alert(t("home.deleteDeckTitle"), t("home.deleteDeckBody", { title: deck.title }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("deckDetail.deleteAction"),
        style: "destructive",
        onPress: async () => {
          if (mutating) return;
          setMutating(true);
          try {
            const scope = await AuthService.getActiveScope();
            await deleteDeckById(scope, deck.id);
            await load();
          } catch {
            Alert.alert(t("home.deleteDeckFailedTitle"), t("home.deleteDeckFailedBody"));
          } finally {
            setMutating(false);
          }
        },
      },
    ]);
  };

  const onDeckLongPress = (deck: DeckRecord) => {
    showDeckActionsSheet({
      t,
      onRename: () => router.push(`/deck/${deck.id}/edit`),
      onMoveToCollection: () => router.push(`/deck/${deck.id}/move-to-collection` as any),
      onRemoveFromCollection: () => onRemoveDeck(deck),
      onDelete: () => confirmDeleteDeck(deck),
    });
  };

  if (loaded && !collection) {
    return (
      <Screen>
        <View style={[styles.header, { gap: spacing.sm }]}>
          <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={goBack} />
        </View>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("deckCollections.detail.notFound")}</Text>
      </Screen>
    );
  }

  const listHeader = (
    <View style={{ gap: spacing.md }}>
      <View style={[styles.renameRow, { gap: spacing.sm }]}>
        <TextField
          label={t("deckCollections.form.nameLabel")}
          value={name}
          onChangeText={setName}
          editable={!renaming && !mutating}
        />
        <Button
          label={t("deckCollections.detail.renameAction")}
          variant="secondary"
          disabled={!isValidName || !nameChanged}
          loading={renaming}
          onPress={onRename}
        />
      </View>

      <Button
        label={t("deckCollections.detail.addDecksButton")}
        variant="secondary"
        fullWidth
        disabled={mutating}
        onPress={() => router.push({ pathname: "/deck-collections/[id]/add" as any, params: { id } })}
      />
      <Button label={t("deckCollections.detail.deleteAction")} variant="danger" fullWidth disabled={mutating} onPress={confirmDeleteCollection} />

      <Text style={[typography.subheading, { color: colors.textPrimary }]}>{t("deckCollections.detail.decksSectionTitle")}</Text>
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
        data={decks}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={[styles.listContent, { gap: spacing.sm, paddingBottom: spacing.xl }]}
        ListHeaderComponent={listHeader}
        ListHeaderComponentStyle={{ marginBottom: spacing.md }}
        ListEmptyComponent={
          <EmptyState icon="albums-outline" title={t("deckCollections.detail.emptyDecksTitle")} description={t("deckCollections.detail.emptyDecksDescription")} />
        }
        renderItem={({ item }) => (
          <View style={{ gap: spacing.xs }}>
            <DeckCard deck={item} onPress={() => router.push(`/deck/${item.id}`)} onLongPress={() => onDeckLongPress(item)} />
            <Button
              label={t("deckCollections.detail.removeFromCollectionAction")}
              variant="ghost"
              disabled={mutating}
              onPress={() => onRemoveDeck(item)}
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
