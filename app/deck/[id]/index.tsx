import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AuthService } from "../../../src/auth/AuthService";
import { computeDeckStats } from "../../../src/domain/deckStats";
import { formatDuration, formatTimestamp } from "../../../src/domain/sessionFormat";
import type { Card } from "../../../src/models/card";
import type { Deck } from "../../../src/models/deck";
import type { StudySession } from "../../../src/models/session";
import { deleteCard, getCards, updateAllCardsDifficulty } from "../../../src/storage/cards";
import { getDeckById } from "../../../src/storage/decks";
import {
  getSessionsForDeck
} from "../../../src/storage/sessions";

const APP_BG = "#2FA4A3";

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
  const [showTools, setShowTools] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

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
    Alert.alert("Delete card?", "This card will be removed from this deck.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const scope = await AuthService.getActiveScope();
          const updated = await deleteCard(scope, id, card.id);
          setCards(updated);
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

  // Stats summary
  const stats = useMemo(() => computeDeckStats(sessions), [sessions]);

  if (!loaded) {
    return (
      <SafeAreaView style={styles.screen}>
        <Text style={styles.subtle}>Loading…</Text>
      </SafeAreaView>
    );
  }

  if (!deck) {
    return (
      <SafeAreaView style={styles.screen}>
        <Pressable onPress={goBackHome} style={styles.pill}>
          <Text style={styles.pillText}>← Back</Text>
        </Pressable>
        <Text style={styles.subtle}>Deck not found.</Text>
      </SafeAreaView>
    );
  }

  if (isEmptyCards) {
    return (
      <SafeAreaView style={styles.screen}>
        <Pressable onPress={goBackHome} style={styles.pill}>
          <Text style={styles.pillText}>← Back</Text>
        </Pressable>

        <View style={styles.center}>
          <Text style={styles.deckTitle}>{deck.title}</Text>
          <Text style={styles.subtle}>
            Created {new Date(deck.createdAt).toLocaleString()}
          </Text>

          <Pressable onPress={goAddCard} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>+ Add your first card</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // show “Study history button row” (compact)
  const lastSession = recentSessions[0];

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.topRow}>
        <Pressable onPress={goBackHome} style={styles.pill}>
          <Text style={styles.pillText}>← Back</Text>
        </Pressable>
      </View>

      <Text style={styles.deckTitle}>{deck.title}</Text>
      <Text style={styles.subtle}>
        Created {new Date(deck.createdAt).toLocaleString()}
      </Text>

      <Pressable
        onPress={() => setShowTools((prev) => !prev)}
        style={styles.toolsToggle}
      >
        <Text style={styles.toolsToggleText}>
          {showTools ? "Hide tools" : "Show tools"} {showTools ? "▾" : "▸"}
        </Text>
      </Pressable>

      <Pressable onPress={goReview} style={styles.secondaryBtn}>
        <Text style={styles.secondaryBtnText}>▶ Start review</Text>
      </Pressable>

      <Pressable onPress={goQuiz} style={styles.secondaryBtn}>
        <Text style={styles.secondaryBtnText}>🧠 Start quiz</Text>
      </Pressable>

      {showTools && (
        <View style={styles.toolsArea}>
          <Pressable onPress={onSetDifficulty} style={styles.secondaryBtn}>
            <Text style={styles.secondaryBtnText}>Set difficulty</Text>
          </Pressable>

          <Pressable
            onPress={() => setShowStats((prev) => !prev)}
            style={styles.sectionToggle}
          >
            <Text style={styles.sectionTitle}>Stats</Text>
            <Text style={styles.sectionChevron}>{showStats ? "˄" : "˅"}</Text>
          </Pressable>

          {showStats && (
            <View style={[styles.card, { marginTop: 10, gap: 8 }]}>
              <Text style={{ color: "white", opacity: 0.9 }}>
                Today: {stats.todaySessions} sessions • {stats.todayMinutes} min
              </Text>

              <Text style={{ color: "white", opacity: 0.9 }}>
                Last 7 days: {stats.weekSessions} sessions
                {stats.avgQuizPercent7d !== null
                  ? ` • avg quiz ${stats.avgQuizPercent7d}%`
                  : ""}
              </Text>

              <Text style={{ color: "white", opacity: 0.9 }}>
                Best quiz:{" "}
                {stats.bestQuizPercent !== null ? `${stats.bestQuizPercent}%` : "—"}
              </Text>

              <Text style={{ color: "white", opacity: 0.9 }}>
                Streak: {stats.streakDays} day{stats.streakDays === 1 ? "" : "s"}
              </Text>

              <Text style={{ color: "white", opacity: 0.75, fontSize: 12 }}>
                Total sessions: {stats.totalSessions}
              </Text>
            </View>
          )}

          <Pressable
            onPress={() => setShowDetails((prev) => !prev)}
            style={styles.sectionToggle}
          >
            <Text style={styles.sectionTitle}>Details</Text>
            <Text style={styles.sectionChevron}>{showDetails ? "˄" : "˅"}</Text>
          </Pressable>

          {showDetails && (
            <View style={styles.sectionBody}>
              <Pressable onPress={onExportDeck} style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>Share deck</Text>
              </Pressable>

              {/* Study history button */}
              <Pressable onPress={goHistory} style={styles.historyButton}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.historyButtonTitle}>
                    Study history ({sessions.length})
                  </Text>

                  {lastSession ? (
                    <Text style={styles.historyButtonSubtitle}>
                      {formatTimestamp(lastSession.finishedAt)} •{" "}
                      {lastSession.mode === "quiz"
                        ? `Quiz • ${
                            typeof lastSession.percent === "number"
                              ? `${lastSession.percent}% • `
                              : ""
                          }`
                        : "Review • "}
                      {lastSession.total} cards •{" "}
                      {formatDuration(lastSession.startedAt, lastSession.finishedAt)}
                    </Text>
                  ) : (
                    <Text style={styles.historyButtonSubtitle}>
                      No study history yet. Start a review or quiz.
                    </Text>
                  )}
                </View>

                <Text style={styles.chevron}>›</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      <View style={styles.filterHeader}>
        <Text style={styles.filterCount}>
          Showing {filteredCards.length} / {cards.length} cards
        </Text>
      </View>

      <View style={styles.filterRow}>
        {(["all", "hard", "medium", "easy"] as const).map((value) => {
          const isActive = difficultyFilter === value;
          const label = value[0].toUpperCase() + value.slice(1);
          return (
            <Pressable
              key={value}
              onPress={() => setDifficultyFilter(value)}
              style={[styles.filterChip, isActive && styles.filterChipActive]}
            >
              <Text style={[styles.filterText, isActive && styles.filterTextActive]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {filteredCards.length === 0 && (
        <View style={[styles.card, { marginTop: 14 }]}>
          <Text style={styles.emptyFilterText}>No cards with this difficulty.</Text>
        </View>
      )}

      <FlatList
        data={filteredCards}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingTop: 14, paddingBottom: 110, gap: 12 }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/deck/${id}/edit-card/${item.id}`)}
            onLongPress={() => confirmDeleteCard(item)}
            delayLongPress={350}
            style={styles.card}
          >
            <Text style={styles.cardFront}>{item.front}</Text>
            <Text style={styles.cardMeta}>
              {(item.difficulty ?? "medium")[0].toUpperCase() +
                (item.difficulty ?? "medium").slice(1)}
            </Text>
            <Text style={styles.cardBack}>{item.back}</Text>
            <Text style={styles.hint}>Tap to edit • Long-press to delete</Text>
          </Pressable>
        )}
      />

      <View style={styles.bottomBar}>
        <Pressable onPress={goAddCard} style={styles.primaryBtnWide}>
          <Text style={styles.primaryBtnText}>+ Card</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: APP_BG,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pill: {
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  pillText: { fontWeight: "700", color: "white" },

  deckTitle: {
    marginTop: 16,
    fontSize: 40,
    fontWeight: "900",
    color: "white",
  },
  subtle: { marginTop: 8, color: "white", opacity: 0.85 },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },

  primaryBtn: {
    marginTop: 10,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: "#2247a3ff",
  },
  primaryBtnWide: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "#2247a3ff",
    alignItems: "center",
  },
  primaryBtnText: { color: "white", fontWeight: "800", fontSize: 16 },

  secondaryBtn: {
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
  },
  secondaryBtnText: { color: "white", fontWeight: "900", fontSize: 16 },

  toolsToggle: {
    alignSelf: "flex-start",
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  toolsToggleText: { color: "white", fontWeight: "800", fontSize: 12 },
  toolsArea: { marginTop: 4 },

  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  cardFront: { color: "white", fontWeight: "900", fontSize: 18 },
  cardMeta: { marginTop: 4, color: "white", opacity: 0.7, fontSize: 12 },
  cardBack: { marginTop: 8, color: "white", opacity: 0.9 },
  hint: { marginTop: 10, color: "white", opacity: 0.65, fontSize: 12 },

  historyButton: {
    marginTop: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.14)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  historyButtonTitle: {
    color: "white",
    fontWeight: "900",
    fontSize: 16,
  },
  historyButtonSubtitle: {
    color: "white",
    opacity: 0.85,
    fontSize: 12,
    fontWeight: "700",
  },
  chevron: {
    color: "white",
    fontSize: 28,
    fontWeight: "900",
    opacity: 0.85,
  },

  sectionToggle: {
    marginTop: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.14)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { color: "white", fontWeight: "900", fontSize: 16 },
  sectionChevron: { color: "white", fontSize: 16, fontWeight: "900", opacity: 0.85 },
  sectionBody: { marginTop: 10, gap: 10 },

  filterRow: {
    marginTop: 8,
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  filterHeader: { marginTop: 14 },
  filterCount: { color: "white", opacity: 0.75, fontSize: 12, fontWeight: "800" },
  filterChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  filterChipActive: {
    backgroundColor: "rgba(255,255,255,0.28)",
    borderColor: "rgba(255,255,255,0.35)",
  },
  filterText: { color: "white", opacity: 0.7, fontWeight: "800", fontSize: 12 },
  filterTextActive: { opacity: 1 },
  emptyFilterText: { color: "white", opacity: 0.85, fontWeight: "800" },

  bottomBar: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 16,
  },
});
