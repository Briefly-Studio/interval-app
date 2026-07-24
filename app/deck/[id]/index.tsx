import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import { computeDeckStats } from "../../../src/domain/deckStats";
import { formatDuration, formatTimestamp } from "../../../src/domain/sessionFormat";
import type { Card } from "../../../src/models/card";
import type { Deck } from "../../../src/models/deck";
import type { StudySession } from "../../../src/models/session";
import { deleteCard, getCards, updateAllCardsDifficulty } from "../../../src/storage/cards";
import { getDeckById } from "../../../src/storage/decks";
import { getSessionsForDeck } from "../../../src/storage/sessions";
import { Button } from "../../../src/ui/Button";
import { Card as Surface } from "../../../src/ui/Card";
import { EmptyState } from "../../../src/ui/EmptyState";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";
import { colors, iconSizes, spacing, touchTarget, typography } from "../../../src/ui/theme";

const DIFFICULTY_FILTERS = ["all", "hard", "medium", "easy"] as const;

export default function DeckDetails() {
  const router = useRouter();

  const params = useLocalSearchParams();
  const idParam = params.id;
  const id =
    typeof idParam === "string"
      ? idParam
      : Array.isArray(idParam)
      ? idParam[0]
      : "";

  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [difficultyFilter, setDifficultyFilter] = useState<
    "all" | "hard" | "medium" | "easy"
  >("all");
  const [showStats, setShowStats] = useState(false);
  // Per-card guard against duplicate delete taps — mirrors the same pattern used for Restore.
  const [deletingCardIds, setDeletingCardIds] = useState<Set<string>>(new Set());

  const goBackHome = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  useFocusEffect(
    useCallback(() => {
      let alive = true;

      (async () => {
        if (!id) return;
        const scope = await AuthService.getActiveScope();
        const d = await getDeckById(scope, id);
        const c = await getCards(scope, id);
        const s = await getSessionsForDeck(scope, id);

        if (alive) {
          setDeck(d);
          setCards(c);
          setSessions(s);
          setLoaded(true);
        }
      })();

      return () => {
        alive = false;
      };
    }, [id])
  );

  const goAddCard = () => router.push(`/deck/${id}/add-card`);
  const goReview = () => router.push(`/deck/${id}/review`);
  const goQuiz = () => router.push(`/deck/${id}/quiz`);
  const goHistory = () => router.push(`/deck/${id}/history`);

  const confirmDeleteCard = (card: Card) => {
    if (deletingCardIds.has(card.id)) return;
    Alert.alert("Delete card?", "This card will be removed from this deck.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (deletingCardIds.has(card.id)) return;
          setDeletingCardIds((prev) => new Set(prev).add(card.id));
          try {
            const scope = await AuthService.getActiveScope();
            // deleteCard awaits the storage write before returning, so by the time we reach
            // here the tombstone is durable — but it returns the raw (unfiltered) card array,
            // the same as getCardsAll. The screen's `cards` state is meant to hold only active
            // cards (matching the filtered getCards() used on load), so it must be filtered
            // here too — otherwise the just-deleted card keeps rendering until the next focus
            // reload silently re-fetches the filtered list.
            const updated = await deleteCard(scope, id, card.id);
            setCards(updated.filter((c) => !c.deletedAt));
          } finally {
            setDeletingCardIds((prev) => {
              const next = new Set(prev);
              next.delete(card.id);
              return next;
            });
          }
        },
      },
    ]);
  };

  const onSetDifficulty = () => {
    if (!id) return;
    Alert.alert("Set difficulty", "Apply to all cards in this deck?", [
      {
        text: "Easy",
        onPress: async () => {
          const scope = await AuthService.getActiveScope();
          const updated = await updateAllCardsDifficulty(scope, id, "easy");
          setCards(updated);
          Alert.alert("Updated all cards to Easy");
        },
      },
      {
        text: "Medium",
        onPress: async () => {
          const scope = await AuthService.getActiveScope();
          const updated = await updateAllCardsDifficulty(scope, id, "medium");
          setCards(updated);
          Alert.alert("Updated all cards to Medium");
        },
      },
      {
        text: "Hard",
        onPress: async () => {
          const scope = await AuthService.getActiveScope();
          const updated = await updateAllCardsDifficulty(scope, id, "hard");
          setCards(updated);
          Alert.alert("Updated all cards to Hard");
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const onExportDeck = () => {
    router.push(`/deck/${id}/export`);
  };

  // Consolidates the old "Show tools" section (Set difficulty / Share deck / Study history)
  // into a single header overflow control — same handlers, same routes, no new behavior, just
  // one less layer of nested toggles competing with the deck's own content.
  const onOverflowPress = () => {
    Alert.alert(deck?.title ?? "Deck options", undefined, [
      { text: "Set difficulty", onPress: onSetDifficulty },
      { text: "Share deck", onPress: onExportDeck },
      { text: `Study history (${sessions.length})`, onPress: goHistory },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const isEmptyCards = loaded && deck && cards.length === 0;

  const recentSessions = useMemo(() => {
    if (sessions.length === 0) return [];
    return [...sessions]
      .sort((a, b) => b.finishedAt - a.finishedAt)
      .slice(0, 5);
  }, [sessions]);

  const filteredCards = useMemo(() => {
    if (difficultyFilter === "all") return cards;
    return cards.filter((card) => (card.difficulty ?? "medium") === difficultyFilter);
  }, [cards, difficultyFilter]);

  const stats = useMemo(() => computeDeckStats(sessions), [sessions]);

  if (!loaded) {
    return (
      <Screen>
        <Text style={typography.secondary}>Loading…</Text>
      </Screen>
    );
  }

  if (!deck) {
    return (
      <Screen>
        <View style={styles.header}>
          <IconButton name="chevron-back" accessibilityLabel="Back" onPress={goBackHome} />
        </View>
        <Text style={typography.secondary}>Deck not found.</Text>
      </Screen>
    );
  }

  if (isEmptyCards) {
    return (
      <Screen>
        <View style={styles.header}>
          <IconButton name="chevron-back" accessibilityLabel="Back" onPress={goBackHome} />
          <Text style={[typography.title, styles.headerTitle]} numberOfLines={1}>
            {deck.title}
          </Text>
        </View>
        <Text style={typography.secondary}>
          Created {new Date(deck.createdAt).toLocaleString()}
        </Text>
        <View style={styles.emptyFill}>
          <EmptyState
            icon="albums-outline"
            title="No cards yet"
            description="Cards need a front and a back to start studying."
          >
            <Button label="Add your first card" variant="primary" fullWidth onPress={goAddCard} />
          </EmptyState>
        </View>
      </Screen>
    );
  }

  const lastSession = recentSessions[0];

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton name="chevron-back" accessibilityLabel="Back" onPress={goBackHome} />
        <Text style={[typography.title, styles.headerTitle]} numberOfLines={1}>
          {deck.title}
        </Text>
        <IconButton
          name="ellipsis-horizontal"
          accessibilityLabel="More deck options"
          onPress={onOverflowPress}
        />
      </View>
      <Text style={typography.secondary}>
        Created {new Date(deck.createdAt).toLocaleString()}
      </Text>

      <View style={styles.studyRow}>
        <Button label="Start review" variant="primary" onPress={goReview} style={styles.flex1} />
        <Button label="Start quiz" variant="secondary" onPress={goQuiz} style={styles.flex1} />
      </View>

      <Pressable
        onPress={() => setShowStats((prev) => !prev)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showStats }}
        style={styles.statsToggle}
      >
        <Text style={typography.subheading}>Stats</Text>
        <Ionicons
          name={showStats ? "chevron-up" : "chevron-down"}
          size={iconSizes.sm}
          color={colors.textSecondary}
        />
      </Pressable>

      {showStats && (
        <Surface style={styles.statsCard}>
          <Text style={typography.secondary}>
            Today: {stats.todaySessions} sessions • {stats.todayMinutes} min
          </Text>
          <Text style={typography.secondary}>
            Last 7 days: {stats.weekSessions} sessions
            {stats.avgQuizPercent7d !== null ? ` • avg quiz ${stats.avgQuizPercent7d}%` : ""}
          </Text>
          <Text style={typography.secondary}>
            Best quiz: {stats.bestQuizPercent !== null ? `${stats.bestQuizPercent}%` : "—"}
          </Text>
          <Text style={typography.secondary}>
            Streak: {stats.streakDays} day{stats.streakDays === 1 ? "" : "s"}
          </Text>
          <Text style={typography.caption}>Total sessions: {stats.totalSessions}</Text>

          {lastSession ? (
            <Pressable onPress={goHistory} style={styles.historyRow} accessibilityRole="button">
              <View style={styles.flex1}>
                <Text style={typography.bodyMedium}>Study history ({sessions.length})</Text>
                <Text style={typography.caption}>
                  {formatTimestamp(lastSession.finishedAt)} •{" "}
                  {lastSession.mode === "quiz"
                    ? `Quiz • ${
                        typeof lastSession.percent === "number" ? `${lastSession.percent}% • ` : ""
                      }`
                    : "Review • "}
                  {lastSession.total} cards • {formatDuration(lastSession.startedAt, lastSession.finishedAt)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={iconSizes.sm} color={colors.textSecondary} />
            </Pressable>
          ) : (
            <Pressable onPress={goHistory} style={styles.historyRow} accessibilityRole="button">
              <Text style={typography.caption}>No study history yet. Start a review or quiz.</Text>
              <Ionicons name="chevron-forward" size={iconSizes.sm} color={colors.textSecondary} />
            </Pressable>
          )}
        </Surface>
      )}

      <View style={styles.sectionHeaderRow}>
        <Text style={typography.subheading}>Cards</Text>
        <Button label="+ Add card" variant="primary" size="sm" onPress={goAddCard} />
      </View>

      <View style={styles.filterRow}>
        {DIFFICULTY_FILTERS.map((value) => {
          const isActive = difficultyFilter === value;
          const label = value[0].toUpperCase() + value.slice(1);
          return (
            <Pressable
              key={value}
              onPress={() => setDifficultyFilter(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`Filter: ${label}`}
              style={[styles.filterChip, isActive && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={typography.caption}>
        Showing {filteredCards.length} / {cards.length} cards
      </Text>

      {filteredCards.length === 0 && (
        <Surface>
          <Text style={typography.secondary}>No cards with this difficulty.</Text>
        </Surface>
      )}

      <FlatList
        data={filteredCards}
        keyExtractor={(item) => item.id}
        style={styles.flex1}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/deck/${id}/edit-card/${item.id}`)}
            onLongPress={() => confirmDeleteCard(item)}
            delayLongPress={350}
            accessibilityRole="button"
            accessibilityLabel={`Card: ${item.front}. Double tap to edit. Long press to delete.`}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Surface style={styles.cardRow}>
              <View style={styles.cardRowHeader}>
                <Text style={typography.bodyMedium} numberOfLines={2}>
                  {item.front}
                </Text>
                <Text style={typography.caption}>
                  {(item.difficulty ?? "medium")[0].toUpperCase() +
                    (item.difficulty ?? "medium").slice(1)}
                </Text>
              </View>
              <Text style={typography.secondary} numberOfLines={2}>
                {item.back}
              </Text>
            </Surface>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headerTitle: { flex: 1 },
  flex1: { flex: 1 },

  emptyFill: { flex: 1, justifyContent: "center" },

  studyRow: { flexDirection: "row", gap: spacing.sm },

  statsToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: touchTarget.min,
  },
  statsCard: { gap: spacing.xs },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  filterRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  filterChip: {
    minHeight: touchTarget.min,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  filterChipActive: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accentStrong,
  },
  filterChipText: { ...typography.caption, fontWeight: "600" },
  filterChipTextActive: { color: colors.accentStrong, fontWeight: "700" },

  list: { gap: spacing.sm, paddingBottom: spacing.xl },
  cardRow: { gap: spacing.xs },
  cardRowHeader: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  pressed: { opacity: 0.85 },
});
