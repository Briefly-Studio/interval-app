import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthService } from "../../../src/auth/AuthService";
import type { StudySession } from "../../../src/models/session";
import { deleteSessionsForDeck, getSessionsForDeck } from "../../../src/storage/sessions";

const APP_BG = "#2FA4A3";

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

  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;

      (async () => {
        if (!deckId) return;
        const scope = await AuthService.getActiveScope();
        const s = await getSessionsForDeck(scope, deckId);
        if (alive) {
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
              Alert.alert("Couldn’t clear history", "Please try again.");
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.topRow}>
        <Pressable onPress={() => router.back()} style={styles.pill}>
          <Text style={styles.pillText}>← Back</Text>
        </Pressable>

        <Pressable
          onPress={confirmClear}
          disabled={sessions.length === 0}
          style={[styles.clearBtn, sessions.length === 0 && { opacity: 0.45 }]}
        >
          <Text style={styles.clearBtnText}>Clear</Text>
        </Pressable>
      </View>

      <Text style={styles.title}>Study history</Text>
      <Text style={styles.subtle}>
        {loaded ? `${sessions.length} session${sessions.length === 1 ? "" : "s"}` : "Loading…"}
      </Text>

      {loaded && sessions.length === 0 ? (
        <View style={[styles.card, { marginTop: 14 }]}>
          <Text style={styles.emptyText}>No history yet. Do a review or quiz.</Text>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 14, paddingBottom: 20, gap: 12 }}
          renderItem={({ item }) => {
            const parts = [
              item.mode === "quiz" ? "Quiz" : "Review",
              item.mode === "quiz" && typeof item.percent === "number" ? `${item.percent}%` : null,
              `${item.total} cards`,
            ].filter(Boolean) as string[];

            return (
              <View style={styles.card}>
                <Text style={styles.rowPrimary}>{parts.join(" • ")}</Text>
                <Text style={styles.rowSecondary}>
                  {formatTimestamp(item.finishedAt)} • {formatDuration(item.startedAt, item.finishedAt)}
                </Text>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: APP_BG, paddingHorizontal: 20, paddingTop: 10 },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  pillText: { color: "white", fontWeight: "700" },

  clearBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  clearBtnText: { color: "white", fontWeight: "900" },

  title: { marginTop: 16, fontSize: 34, fontWeight: "900", color: "white" },
  subtle: { marginTop: 8, color: "white", opacity: 0.85 },

  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  rowPrimary: { color: "white", fontWeight: "900" },
  rowSecondary: { marginTop: 6, color: "white", opacity: 0.75, fontSize: 12 },
  emptyText: { color: "white", opacity: 0.85 },
});
