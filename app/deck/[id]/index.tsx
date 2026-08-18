import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import { computeDeckStats } from "../../../src/domain/deckStats";
import { formatDuration, formatTimestamp } from "../../../src/domain/sessionFormat";
import { useTranslation } from "../../../src/i18n";
import type { TranslationKey } from "../../../src/i18n";
import type { Card } from "../../../src/models/card";
import type { Deck } from "../../../src/models/deck";
import type { StudySession } from "../../../src/models/session";
import { deleteCard, getCards, updateAllCardsDifficulty } from "../../../src/storage/cards";
import { getDeckById } from "../../../src/storage/decks";
import { getSessionsForDeck } from "../../../src/storage/sessions";
import { useTheme } from "@/src/theme";
import { Button } from "../../../src/ui/Button";
import { Card as Surface } from "../../../src/ui/Card";
import { EmptyState } from "../../../src/ui/EmptyState";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";

const DIFFICULTY_FILTERS = ["all", "hard", "medium", "easy"] as const;

// Maps each filter/badge value to its translation key — the raw filter values themselves stay
// English identifiers (used for comparisons/state), only their displayed label is translated.
const DIFFICULTY_LABEL_KEYS: Record<(typeof DIFFICULTY_FILTERS)[number], TranslationKey> = {
  all: "deckDetail.difficultyAll",
  easy: "deckDetail.difficultyEasy",
  medium: "deckDetail.difficultyMedium",
  hard: "deckDetail.difficultyHard",
};

export default function DeckDetails() {
  const router = useRouter();
  const { t, plural, language } = useTranslation();
  const { colors, iconSizes, spacing, touchTarget, typography } = useTheme();

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
    Alert.alert(t("deckDetail.deleteCardTitle"), t("deckDetail.deleteCardBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("deckDetail.deleteAction"),
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
          } catch (error) {
            // The card is left intact — only the busy state clears, nothing navigates away.
            console.error("[deck-detail] delete card failed:", error);
            Alert.alert(t("deckDetail.deleteCardFailedTitle"), t("deckDetail.deleteCardFailedBody"));
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
    Alert.alert(t("deckDetail.setDifficultyTitle"), t("deckDetail.setDifficultyBody"), [
      {
        text: t("deckDetail.difficultyEasy"),
        onPress: async () => {
          const scope = await AuthService.getActiveScope();
          const updated = await updateAllCardsDifficulty(scope, id, "easy");
          setCards(updated);
          Alert.alert(t("deckDetail.updatedAllTo", { difficulty: t("deckDetail.difficultyEasy") }));
        },
      },
      {
        text: t("deckDetail.difficultyMedium"),
        onPress: async () => {
          const scope = await AuthService.getActiveScope();
          const updated = await updateAllCardsDifficulty(scope, id, "medium");
          setCards(updated);
          Alert.alert(t("deckDetail.updatedAllTo", { difficulty: t("deckDetail.difficultyMedium") }));
        },
      },
      {
        text: t("deckDetail.difficultyHard"),
        onPress: async () => {
          const scope = await AuthService.getActiveScope();
          const updated = await updateAllCardsDifficulty(scope, id, "hard");
          setCards(updated);
          Alert.alert(t("deckDetail.updatedAllTo", { difficulty: t("deckDetail.difficultyHard") }));
        },
      },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };

  const onExportDeck = () => {
    router.push(`/deck/${id}/export`);
  };

  // Consolidates the old "Show tools" section (Set difficulty / Share deck / Study history)
  // into a single header overflow control — same handlers, same routes, no new behavior, just
  // one less layer of nested toggles competing with the deck's own content.
  const onEditDeck = () => {
    router.push(`/deck/${id}/edit`);
  };

  const onOverflowPress = () => {
    Alert.alert(deck?.title ?? t("deckDetail.deckOptionsTitle"), undefined, [
      { text: t("deckDetail.editDeckAction"), onPress: onEditDeck },
      { text: t("deckDetail.setDifficultyTitle"), onPress: onSetDifficulty },
      { text: t("deckDetail.shareDeckAction"), onPress: onExportDeck },
      { text: t("deckDetail.studyHistoryAction", { count: sessions.length }), onPress: goHistory },
      { text: t("common.cancel"), style: "cancel" },
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
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("deckDetail.loading")}</Text>
      </Screen>
    );
  }

  if (!deck) {
    return (
      <Screen>
        <View style={[styles.header, { gap: spacing.sm }]}>
          <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={goBackHome} />
        </View>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("deckDetail.deckNotFound")}</Text>
      </Screen>
    );
  }

  if (isEmptyCards) {
    return (
      <Screen>
        <View style={[styles.header, { gap: spacing.sm }]}>
          <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={goBackHome} />
          <Text
            style={[typography.title, styles.headerTitle, { color: colors.textPrimary }]}
            numberOfLines={1}
            accessibilityRole="header"
          >
            {deck.title}
          </Text>
        </View>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>
          {t("deckDetail.createdOn", { date: new Date(deck.createdAt).toLocaleString() })}
        </Text>
        <View style={styles.emptyFill}>
          <EmptyState
            icon="albums-outline"
            title={t("deckDetail.emptyTitle")}
            description={t("deckDetail.emptyDescription")}
          >
            <Button label={t("deckDetail.addFirstCardButton")} variant="primary" fullWidth onPress={goAddCard} />
          </EmptyState>
        </View>
      </Screen>
    );
  }

  const lastSession = recentSessions[0];

  return (
    <Screen>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={goBackHome} />
        <Text
          style={[typography.title, styles.headerTitle, { color: colors.textPrimary }]}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {deck.title}
        </Text>
        <IconButton
          name="ellipsis-horizontal"
          accessibilityLabel={t("deckDetail.moreOptionsLabel")}
          onPress={onOverflowPress}
        />
      </View>
      <Text style={[typography.secondary, { color: colors.textSecondary }]}>
        {t("deckDetail.createdOn", { date: new Date(deck.createdAt).toLocaleString() })}
      </Text>

      <View style={[styles.studyRow, { gap: spacing.sm }]}>
        <Button label={t("deckDetail.startReview")} variant="primary" onPress={goReview} style={styles.flex1} />
        <Button label={t("deckDetail.startQuiz")} variant="secondary" onPress={goQuiz} style={styles.flex1} />
      </View>

      <Pressable
        onPress={() => setShowStats((prev) => !prev)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showStats }}
        style={[styles.statsToggle, { minHeight: touchTarget.min }]}
      >
        <Text style={[typography.subheading, { color: colors.textPrimary }]}>{t("deckDetail.statsToggle")}</Text>
        <Ionicons
          name={showStats ? "chevron-up" : "chevron-down"}
          size={iconSizes.sm}
          color={colors.textSecondary}
        />
      </Pressable>

      {showStats && (
        <Surface style={[styles.statsCard, { gap: spacing.xs }]}>
          <Text style={[typography.secondary, { color: colors.textSecondary }]}>
            {t("deckDetail.statsToday", { sessions: stats.todaySessions, minutes: stats.todayMinutes })}
          </Text>
          <Text style={[typography.secondary, { color: colors.textSecondary }]}>
            {stats.avgQuizPercent7d !== null
              ? t("deckDetail.statsWeekWithAvg", { sessions: stats.weekSessions, percent: stats.avgQuizPercent7d })
              : t("deckDetail.statsWeek", { sessions: stats.weekSessions })}
          </Text>
          <Text style={[typography.secondary, { color: colors.textSecondary }]}>
            {stats.bestQuizPercent !== null
              ? t("deckDetail.statsBestQuiz", { percent: stats.bestQuizPercent })
              : t("deckDetail.statsBestQuizNone")}
          </Text>
          <Text style={[typography.secondary, { color: colors.textSecondary }]}>
            {plural("deckDetail.statsStreak", stats.streakDays)}
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t("deckDetail.statsTotalSessions", { count: stats.totalSessions })}
          </Text>

          {lastSession ? (
            <Pressable
              onPress={goHistory}
              style={[
                styles.historyRow,
                { gap: spacing.sm, marginTop: spacing.xs, paddingTop: spacing.sm, borderTopColor: colors.border },
              ]}
              accessibilityRole="button"
            >
              <View style={styles.flex1}>
                <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>
                  {t("deckDetail.studyHistoryRow", { count: sessions.length })}
                </Text>
                <Text style={[typography.caption, { color: colors.textSecondary }]}>
                  {formatTimestamp(lastSession.finishedAt, language)} •{" "}
                  {lastSession.mode === "quiz"
                    ? `${t("history.sessionModeQuiz")} • ${
                        typeof lastSession.percent === "number" ? `${lastSession.percent}% • ` : ""
                      }`
                    : `${t("history.sessionModeReview")} • `}
                  {plural("history.cardsCount", lastSession.total)} • {formatDuration(lastSession.startedAt, lastSession.finishedAt, t)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={iconSizes.sm} color={colors.textSecondary} />
            </Pressable>
          ) : (
            <Pressable
              onPress={goHistory}
              style={[
                styles.historyRow,
                { gap: spacing.sm, marginTop: spacing.xs, paddingTop: spacing.sm, borderTopColor: colors.border },
              ]}
              accessibilityRole="button"
            >
              <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("deckDetail.noHistoryYet")}</Text>
              <Ionicons name="chevron-forward" size={iconSizes.sm} color={colors.textSecondary} />
            </Pressable>
          )}
        </Surface>
      )}

      <View style={styles.sectionHeaderRow}>
        <Text style={[typography.subheading, { color: colors.textPrimary }]}>{t("deckDetail.cardsSectionTitle")}</Text>
        <Button label={t("deckDetail.addCardButton")} variant="primary" size="sm" onPress={goAddCard} />
      </View>

      <View style={[styles.filterRow, { gap: spacing.sm }]}>
        {DIFFICULTY_FILTERS.map((value) => {
          const isActive = difficultyFilter === value;
          const label = t(DIFFICULTY_LABEL_KEYS[value]);
          return (
            <Pressable
              key={value}
              onPress={() => setDifficultyFilter(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={t("deckDetail.filterLabel", { label })}
              style={[
                styles.filterChip,
                {
                  minHeight: touchTarget.min,
                  paddingHorizontal: spacing.md,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                },
                isActive && { backgroundColor: colors.accentSubtle, borderColor: colors.accent },
              ]}
            >
              <Text
                style={[
                  typography.caption,
                  styles.filterChipText,
                  { color: colors.textPrimary },
                  isActive && { color: colors.accent, fontWeight: "700" },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>
        {t("deckDetail.showingCount", { shown: filteredCards.length, total: cards.length })}
      </Text>

      {filteredCards.length === 0 && (
        <Surface>
          <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("deckDetail.noCardsForDifficulty")}</Text>
        </Surface>
      )}

      <FlatList
        data={filteredCards}
        keyExtractor={(item) => item.id}
        style={styles.flex1}
        contentContainerStyle={[styles.list, { gap: spacing.sm, paddingBottom: spacing.xl }]}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/deck/${id}/edit-card/${item.id}`)}
            onLongPress={() => confirmDeleteCard(item)}
            delayLongPress={350}
            accessibilityRole="button"
            accessibilityLabel={t("deckDetail.cardAccessibilityLabel", { front: item.front })}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Surface style={[styles.cardRow, { gap: spacing.xs }]}>
              <View style={[styles.cardRowHeader, { gap: spacing.sm }]}>
                <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={2}>
                  {item.front}
                </Text>
                <Text style={[typography.caption, { color: colors.textSecondary }]}>
                  {t(DIFFICULTY_LABEL_KEYS[item.difficulty ?? "medium"])}
                </Text>
              </View>
              <Text style={[typography.secondary, { color: colors.textSecondary }]} numberOfLines={2}>
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
  header: { flexDirection: "row", alignItems: "center" },
  headerTitle: { flex: 1 },
  flex1: { flex: 1 },

  emptyFill: { flex: 1, justifyContent: "center" },

  studyRow: { flexDirection: "row" },

  statsToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statsCard: {},
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
  },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  filterRow: { flexDirection: "row", flexWrap: "wrap" },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  filterChipText: { fontWeight: "600" },

  list: {},
  cardRow: {},
  cardRowHeader: { flexDirection: "row", justifyContent: "space-between" },
  pressed: { opacity: 0.85 },
});
