import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import type { Deck } from "../../../src/models/deck";
import type { StudySession } from "../../../src/models/session";
import { getDeckById } from "../../../src/storage/decks";
import { deleteSessionsForDeck, getSessionsForDeck } from "../../../src/storage/sessions";
import { Button } from "../../../src/ui/Button";
import { EmptyState } from "../../../src/ui/EmptyState";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";
import { SessionCard } from "../../../src/ui/SessionCard";
import { spacing, typography } from "../../../src/ui/theme";

const formatTimestamp = (value: number) =>
  new Date(value).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

const formatDuration = (startedAt: number, finishedAt: number) => {
  const diff = Math.max(0, finishedAt - startedAt);
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

export default function DeckHistoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const idParam = params.id;

  const deckId =
    typeof idParam === "string"
      ? idParam
      : Array.isArray(idParam)
      ? idParam[0]
      : "";

  const [deck, setDeck] = useState<Deck | null>(null);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;

      (async () => {
        if (!deckId) return;
        const scope = await AuthService.getActiveScope();
        const [d, s] = await Promise.all([getDeckById(scope, deckId), getSessionsForDeck(scope, deckId)]);
        if (alive) {
          setDeck(d);
          setSessions(s);
          setLoaded(true);
        }
      })();

      return () => {
        alive = false;
      };
    }, [deckId])
  );

  const sorted = useMemo(() => {
    return [...sessions].sort((a, b) => b.finishedAt - a.finishedAt);
  }, [sessions]);

  const confirmClear = () => {
    if (!deckId) return;
    if (sessions.length === 0) return;

    Alert.alert(
      "Clear study history?",
      "This will delete all quiz and review sessions for this deck.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            try {
              const scope = await AuthService.getActiveScope();
              await deleteSessionsForDeck(scope, deckId);
              setSessions([]);
            } catch {
              Alert.alert("Couldn't clear history", "Please try again.");
            }
          },
        },
      ]
    );
  };

  const isEmpty = loaded && sessions.length === 0;

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton name="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <Text style={typography.title}>Study history</Text>
        <Button
          label="Clear"
          variant="danger"
          size="sm"
          disabled={sessions.length === 0}
          onPress={confirmClear}
        />
      </View>
      <Text style={typography.secondary}>
        {deck?.title ? `${deck.title} • ` : ""}
        {loaded ? `${sessions.length} session${sessions.length === 1 ? "" : "s"}` : "Loading…"}
      </Text>

      {isEmpty ? (
        <View style={styles.emptyFill}>
          <EmptyState
            icon="time-outline"
            title="No history yet"
            description="Do a review or quiz to start building your study history."
          >
            <Button
              label="Start reviewing"
              variant="primary"
              fullWidth
              onPress={() => router.push(`/deck/${deckId}/review`)}
            />
          </EmptyState>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(item) => item.id}
          style={styles.flex1}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const parts = [
              item.mode === "quiz" ? "Quiz" : "Review",
              item.mode === "quiz" && typeof item.percent === "number" ? `${item.percent}%` : null,
              `${item.total} cards`,
            ].filter(Boolean) as string[];

            return (
              <SessionCard
                title={parts.join(" • ")}
                subtitle={`${formatTimestamp(item.finishedAt)} • ${formatDuration(item.startedAt, item.finishedAt)}`}
              />
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  emptyFill: { flex: 1, justifyContent: "center" },
  flex1: { flex: 1 },
  list: { gap: spacing.sm, paddingBottom: spacing.xl },
});
