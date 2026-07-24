import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { AuthService } from "../src/auth/AuthService";
import { SyncService } from "../src/cloud/sync/SyncService";
import type { DeckRecord } from "../src/models/deck";
import { getCardsAll, setCards } from "../src/storage/cards";
import { cardsKeyForDeck } from "../src/storage/keys";
import { getDecksAll, setDecks } from "../src/storage/decks";
import { getSessions, setSessions } from "../src/storage/sessions";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { EmptyState } from "../src/ui/EmptyState";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";
import { SecondaryAction } from "../src/ui/SecondaryAction";
import { spacing, typography } from "../src/ui/theme";

const TRASH_DAYS = 30;

export default function RecentlyDeletedScreen() {
  const router = useRouter();
  const [decks, setDecksState] = useState<DeckRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  // Per-item, not a single screen-wide flag — restoring one deck must not disable every other
  // row's Restore button while its own network/sync round trip is in flight.
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set());

  const loadDeleted = useCallback(async () => {
    const scope = await AuthService.getActiveScope();
    const allDecks = await getDecksAll(scope);
    const cutoff = Date.now() - TRASH_DAYS * 24 * 60 * 60 * 1000;
    const deleted = allDecks
      .filter((deck) => {
        if (!deck.deletedAt) return false;
        const deletedAt = Date.parse(deck.deletedAt);
        if (!Number.isFinite(deletedAt)) return false;
        if (showExpired) return true;
        return deletedAt >= cutoff;
      })
      .sort((a, b) => {
        const aTime = a.deletedAt ? Date.parse(a.deletedAt) : 0;
        const bTime = b.deletedAt ? Date.parse(b.deletedAt) : 0;
        return bTime - aTime;
      });
    setDecksState(deleted);
    setLoaded(true);
  }, [showExpired]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        await loadDeleted();
        if (!alive) return;
      })();
      return () => {
        alive = false;
      };
    }, [loadDeleted])
  );

  const restoreDeck = async (deck: DeckRecord) => {
    // Ignore duplicate taps while this exact item is already restoring — one in-flight restore
    // per item, not a full-screen lock.
    if (restoringIds.has(deck.id)) return;
    setRestoringIds((prev) => new Set(prev).add(deck.id));
    try {
      const scope = await AuthService.getActiveScope();
      const allDecks = await getDecksAll(scope);
      const now = new Date().toISOString();
      let newRev = 0;
      const updated = allDecks.map((item) => {
        if (item.id !== deck.id) return item;
        newRev = (item.rev ?? 0) + 1;
        return {
          ...item,
          deletedAt: undefined,
          updatedAt: now,
          rev: newRev,
          dirty: true,
          lastSyncedAt: undefined,
        };
      });
      await setDecks(scope, updated);

      const allCards = await getCardsAll(scope, deck.id);
      const updatedCards = allCards.map((card) => {
        // Only cards tombstoned as a side effect of this exact deck deletion come back — a card
        // the user deleted individually beforehand has no deletedByDeckCascade flag and stays
        // deleted. See CardRecord.deletedByDeckCascade for why this can't be inferred from
        // deletedAt alone (two deletes can land in the same millisecond).
        if (!card.deletedAt || !card.deletedByDeckCascade) return card;
        return {
          ...card,
          deletedAt: undefined,
          deletedByDeckCascade: undefined,
          updatedAt: now,
          rev: (card.rev ?? 0) + 1,
          dirty: true,
        };
      });
      await setCards(scope, deck.id, updatedCards);

      // Sessions have no individual-delete path of their own — deleteSessionsForDeck (the deck
      // cascade) is the only code that ever sets a session's deletedAt, so every tombstoned
      // session for this deckId was deleted by this deck's deletion and is safe to restore.
      const allSessions = await getSessions(scope);
      const updatedSessions = allSessions.map((session) => {
        if (session.deckId !== deck.id || !session.deletedAt) return session;
        return {
          ...session,
          deletedAt: undefined,
          updatedAt: now,
          rev: (session.rev ?? 0) + 1,
          dirty: true,
        };
      });
      await setSessions(scope, updatedSessions);

      await SyncService.syncOnce();
      await loadDeleted();
      Alert.alert("Restored");
    } catch (error) {
      Alert.alert(
        "Restore failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setRestoringIds((prev) => {
        const next = new Set(prev);
        next.delete(deck.id);
        return next;
      });
    }
  };

  const purgeDeleted = async () => {
    const scope = await AuthService.getActiveScope();
    const allDecks = await getDecksAll(scope);
    const deletedIds = allDecks.filter((d) => d.deletedAt).map((d) => d.id);
    const updated = allDecks.filter((d) => !d.deletedAt);
    await setDecks(scope, updated);
    for (const id of deletedIds) {
      try {
        await AsyncStorage.removeItem(cardsKeyForDeck(scope, id));
      } catch {
        // ignore
      }
    }
    await loadDeleted();
  };

  const onEmptyTrashPress = () => {
    Alert.alert(
      "Empty trash?",
      "This permanently deletes all items in Recently Deleted and cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Empty trash", style: "destructive", onPress: purgeDeleted },
      ]
    );
  };

  const isEmpty = loaded && decks.length === 0;

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton name="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <Text style={typography.title}>Recently Deleted</Text>
      </View>
      <Text style={typography.secondary}>
        {showExpired
          ? "Showing everything, including items older than 30 days."
          : "Items older than 30 days are hidden here unless you choose to show them."}
      </Text>

      <View style={styles.actionsRow}>
        {__DEV__ && (
          <SecondaryAction
            icon={showExpired ? "eye-off-outline" : "eye-outline"}
            label={showExpired ? "Hide Expired" : "Show Expired"}
            onPress={() => setShowExpired((prev) => !prev)}
          />
        )}
        <Button label="Empty Trash" variant="danger" size="sm" onPress={onEmptyTrashPress} />
      </View>

      {isEmpty ? (
        <View style={styles.emptyFill}>
          <EmptyState
            icon="trash-outline"
            title="No deleted decks"
            description="Decks you delete will appear here."
          />
        </View>
      ) : (
        <FlatList
          data={decks}
          keyExtractor={(item) => item.id}
          style={styles.flex1}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const isRestoring = restoringIds.has(item.id);
            const meta = (() => {
              if (!item.deletedAt) return "Deleted —";
              const deletedAt = Date.parse(item.deletedAt);
              const daysSince = Math.max(
                0,
                Math.floor((Date.now() - deletedAt) / (24 * 60 * 60 * 1000))
              );
              const dateLabel = new Date(deletedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              });
              return `Deleted ${dateLabel} • ${daysSince} day${daysSince === 1 ? "" : "s"} ago`;
            })();

            return (
              <Card style={styles.deletedRow}>
                <View style={styles.flex1}>
                  <Text style={typography.bodyMedium} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={typography.caption}>{meta}</Text>
                </View>
                <Button
                  label={isRestoring ? "Restoring…" : "Restore"}
                  variant="secondary"
                  size="sm"
                  loading={isRestoring}
                  disabled={isRestoring}
                  onPress={() => restoreDeck(item)}
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
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  actionsRow: { flexDirection: "row", gap: spacing.sm },
  flex1: { flex: 1 },
  emptyFill: { flex: 1, justifyContent: "center" },
  list: { gap: spacing.sm, paddingBottom: spacing.xl },
  deletedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
});
