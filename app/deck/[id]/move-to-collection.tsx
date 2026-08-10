import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import { sortDeckCollectionsCanonical } from "../../../src/domain/deckCollectionOrder";
import { useTranslation } from "../../../src/i18n";
import type { DeckRecord } from "../../../src/models/deck";
import type { DeckCollectionRecord } from "../../../src/models/deckCollection";
import { getDeckById } from "../../../src/storage/decks";
import { getActiveDeckCollections, getCollectionIdForDeck, moveDeckToCollection } from "../../../src/storage/deckCollections";
import { useTheme } from "@/src/theme";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";

// Explicit destination picker for "Move to collection" — see docs/deck-collections.md's
// interaction model. Distinct from the Add Decks picker (app/deck-collections/[id]/add.tsx):
// this one is deck-centric (one deck, choose its destination) and always replaces any existing
// membership atomically via moveDeckToCollection, never silently, always as the result of an
// explicit tap on a named destination.
export default function MoveDeckToCollectionScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, touchTarget, typography } = useTheme();

  const params = useLocalSearchParams();
  const idParam = params.id;
  const deckId = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? idParam[0] : "";

  const [deck, setDeck] = useState<DeckRecord | null>(null);
  const [collections, setCollections] = useState<DeckCollectionRecord[]>([]);
  const [currentCollectionId, setCurrentCollectionId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [moving, setMoving] = useState(false);

  const load = useCallback(async () => {
    if (!deckId) return;
    const scope = await AuthService.getActiveScope();
    const [foundDeck, activeCollections, currentId] = await Promise.all([
      getDeckById(scope, deckId),
      getActiveDeckCollections(scope),
      getCollectionIdForDeck(scope, deckId),
    ]);
    setDeck(foundDeck);
    setCollections(sortDeckCollectionsCanonical(activeCollections));
    setCurrentCollectionId(currentId);
    setLoaded(true);
  }, [deckId]);

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

  const onSelectCollection = async (collectionId: string) => {
    if (moving || collectionId === currentCollectionId) return;
    setMoving(true);
    try {
      const scope = await AuthService.getActiveScope();
      await moveDeckToCollection(scope, deckId, collectionId);
      goBack();
    } catch {
      Alert.alert(t("deckCollections.move.moveFailedTitle"), t("deckCollections.move.moveFailedBody"));
    } finally {
      setMoving(false);
    }
  };

  const onNewCollection = () => {
    if (moving) return;
    // The create screen assigns the deck into the newly-created collection itself (see
    // app/deck-collections/create.tsx's assignDeckId handling) — this reuses the existing
    // creation logic rather than duplicating it here.
    router.push({ pathname: "/deck-collections/create" as any, params: { assignDeckId: deckId } });
  };

  if (loaded && !deck) {
    return (
      <Screen>
        <View style={[styles.header, { gap: spacing.sm }]}>
          <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={goBack} />
        </View>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("deckCollections.move.notFound")}</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.cancel")} onPress={goBack} disabled={moving} />
        <Text style={[typography.title, styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1} accessibilityRole="header">
          {t("deckCollections.move.screenTitle")}
        </Text>
      </View>
      {deck && (
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>
          {t("deckCollections.move.subtitle", { title: deck.title })}
        </Text>
      )}

      <FlatList
        data={collections}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={[styles.listContent, { paddingBottom: spacing.xl }]}
        ListHeaderComponent={
          <Pressable
            onPress={onNewCollection}
            disabled={moving}
            accessibilityRole="button"
            accessibilityLabel={t("deckCollections.move.newCollectionOption")}
            style={({ pressed }) => [styles.row, { gap: spacing.sm, minHeight: touchTarget.min, borderColor: colors.border }, pressed && styles.pressed]}
          >
            <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
            <Text style={[typography.bodyMedium, styles.rowLabel, { color: colors.accent }]}>{t("deckCollections.move.newCollectionOption")}</Text>
          </Pressable>
        }
        renderItem={({ item }) => {
          const isCurrent = item.id === currentCollectionId;
          return (
            <Pressable
              onPress={() => onSelectCollection(item.id)}
              disabled={moving || isCurrent}
              accessibilityRole="radio"
              accessibilityState={{ selected: isCurrent, disabled: isCurrent }}
              accessibilityLabel={isCurrent ? `${item.name}, ${t("deckCollections.move.currentLabel")}` : item.name}
              style={({ pressed }) => [
                styles.row,
                { gap: spacing.sm, minHeight: touchTarget.min, borderColor: colors.border },
                pressed && !isCurrent && styles.pressed,
              ]}
            >
              <Text style={[typography.bodyMedium, styles.rowLabel, { color: colors.textPrimary }]} numberOfLines={1}>
                {item.name}
              </Text>
              {isCurrent && (
                <View style={[styles.currentBadge, { gap: 4 }]}>
                  <Ionicons name="checkmark" size={16} color={colors.textSecondary} />
                  <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("deckCollections.move.currentLabel")}</Text>
                </View>
              )}
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  headerTitle: { flex: 1 },
  list: { flex: 1 },
  listContent: {},
  row: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  rowLabel: { flex: 1 },
  currentBadge: { flexDirection: "row", alignItems: "center" },
  pressed: { opacity: 0.85 },
});
