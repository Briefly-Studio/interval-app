import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import { getUnfiledDecks } from "../../../src/domain/deckCollectionMembership";
import { sortDecksCanonical } from "../../../src/domain/deckOrder";
import { useTranslation } from "../../../src/i18n";
import type { DeckRecord } from "../../../src/models/deck";
import type { DeckCollectionRecord } from "../../../src/models/deckCollection";
import { getDecksAll } from "../../../src/storage/decks";
import { assignDeckToCollection, getActiveDeckCollections } from "../../../src/storage/deckCollections";
import { useTheme } from "@/src/theme";
import { Button } from "../../../src/ui/Button";
import { EmptyState } from "../../../src/ui/EmptyState";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";

// "Add decks" means exactly that — it only ever offers currently UNFILED decks (active decks
// belonging to no collection). It never shows, and never moves, a deck already in this or any
// other collection — that's the explicit, separate "Move to collection" action
// (app/deck/[id]/move-to-collection.tsx). See docs/deck-collections.md's interaction model:
// "Add never implicitly moves a deck between collections."
export default function AddDecksToCollectionScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, touchTarget, typography } = useTheme();

  const params = useLocalSearchParams();
  const idParam = params.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? idParam[0] : "";

  const [collection, setCollection] = useState<DeckCollectionRecord | null>(null);
  const [unfiledDecks, setUnfiledDecks] = useState<DeckRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!id) return;
        const scope = await AuthService.getActiveScope();
        const [cols, allDecks] = await Promise.all([getActiveDeckCollections(scope), getDecksAll(scope)]);
        const found = cols.find((c) => c.id === id) ?? null;
        if (!alive) return;
        const active = allDecks.filter((d) => !d.deletedAt);
        setCollection(found);
        setUnfiledDecks(sortDecksCanonical(getUnfiledDecks(active, cols)));
        // Deliberately never seeded from `found.deckIds` — this picker only ever starts with
        // nothing selected, since everything it shows is, by construction, not yet in any
        // collection. See this file's header comment.
        setSelectedIds([]);
        setLoaded(true);
      })();
      return () => {
        alive = false;
      };
    }, [id])
  );

  const toggle = (deckId: string) => {
    setSelectedIds((prev) => (prev.includes(deckId) ? prev.filter((d) => d !== deckId) : [...prev, deckId]));
  };

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace({ pathname: "/deck-collections/[id]" as any, params: { id } });
  };

  const onSave = async () => {
    if (!collection || submitting || selectedIds.length === 0) return;
    setSubmitting(true);
    try {
      const scope = await AuthService.getActiveScope();
      // Every id here is a deck that was unfiled when this screen loaded — assigning it is a
      // pure add, never a move, since it had no prior collection to move it away from.
      for (const deckId of selectedIds) {
        await assignDeckToCollection(scope, deckId, collection.id);
      }
      goBack();
    } catch {
      Alert.alert(t("deckCollections.form.saveFailedTitle"), t("deckCollections.form.saveFailedBody"));
    } finally {
      setSubmitting(false);
    }
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

  return (
    <Screen>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.cancel")} onPress={goBack} disabled={submitting} />
        <Text style={[typography.title, styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1} accessibilityRole="header">
          {t("deckCollections.picker.screenTitle")}
        </Text>
      </View>
      <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("deckCollections.picker.subtitle")}</Text>

      {loaded && unfiledDecks.length === 0 ? (
        <EmptyState icon="checkmark-done-outline" title={t("deckCollections.picker.emptyTitle")} description={t("deckCollections.picker.emptyDescription")} />
      ) : (
        <FlatList
          data={unfiledDecks}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={[styles.listContent, { gap: spacing.xs, paddingBottom: spacing.xl }]}
          renderItem={({ item }) => {
            const checked = selectedIds.includes(item.id);
            return (
              <Pressable
                onPress={() => toggle(item.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={item.title}
                style={({ pressed }) => [
                  styles.row,
                  { gap: spacing.sm, minHeight: touchTarget.min, borderColor: colors.border },
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name={checked ? "checkmark-circle" : "ellipse-outline"}
                  size={22}
                  color={checked ? colors.accent : colors.textSecondary}
                />
                <Text style={[typography.bodyMedium, styles.rowLabel, { color: colors.textPrimary }]} numberOfLines={1}>
                  {item.title}
                </Text>
              </Pressable>
            );
          }}
        />
      )}

      {unfiledDecks.length > 0 && (
        <Button
          label={t("deckCollections.picker.doneButton")}
          variant="primary"
          fullWidth
          loading={submitting}
          disabled={!collection || selectedIds.length === 0}
          onPress={onSave}
        />
      )}
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
  pressed: { opacity: 0.85 },
});
