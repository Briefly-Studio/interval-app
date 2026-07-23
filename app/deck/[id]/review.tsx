import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthService } from "../../../src/auth/AuthService";
import type { Card } from "../../../src/models/card";
import { smartShuffle } from "../../../src/domain/smartShuffle";
import { getCards } from "../../../src/storage/cards";

const APP_BG = "#2FA4A3";

export default function ReviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const idParam = params.id;

  const deckId =
    typeof idParam === "string"
      ? idParam
      : Array.isArray(idParam)
      ? idParam[0]
      : "";

  const [cards, setCards] = useState<Card[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const [startedAt, setStartedAt] = useState(() => Date.now());

  const isSingleCard = cards.length <= 1;
  const isLastCard = cards.length > 0 && index === cards.length - 1;
  const showFinishEarly =
    loaded && cards.length > 0 && !isSingleCard && !isLastCard;

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!deckId) return;
      const scope = await AuthService.getActiveScope();
      const data = await getCards(scope, deckId);
      const ordered = smartShuffle(data);

      if (alive) {
        setCards(ordered);
        setLoaded(true);
        setIndex(0);
        setFlipped(false);
        setStartedAt(Date.now());
      }
    })();

    return () => {
      alive = false;
    };
  }, [deckId]);

  const current = cards[index];

  const progressText = useMemo(() => {
    if (!loaded) return "";
    if (cards.length === 0) return "0 / 0";
    return `${Math.min(index + 1, cards.length)} / ${cards.length}`;
  }, [loaded, cards.length, index]);

  const isLast = isLastCard;

  const finishSession = (attempted: number) => {
    router.replace({
      pathname: "/deck/[id]/review-results",
      params: {
        id: deckId,
        total: String(attempted),
        startedAt: String(startedAt),
        finishedAt: String(Date.now()),
      },
    });
  };

  const onNextOrFinish = () => {
    if (cards.length === 0) return;

    if (isLast) {
      // finished full deck
      finishSession(cards.length);
      return;
    }

    setFlipped(false);
    setIndex((prev) => prev + 1);
  };

  const confirmFinishEarly = () => {
    if (cards.length === 0) return;

    const attempted = Math.min(index + 1, cards.length);

    Alert.alert(
      "Finish review early?",
      `This will log a review session for ${attempted} card${attempted === 1 ? "" : "s"}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Finish",
          style: "default",
          onPress: () => finishSession(attempted),
        },
      ]
    );
  };

  if (!loaded) {
    return (
      <SafeAreaView style={styles.screen}>
        <Text style={styles.subtitle}>Loading…</Text>
      </SafeAreaView>
    );
  }

  if (cards.length === 0) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.pill}>
            <Text style={styles.pillText}>← Back</Text>
          </Pressable>
        </View>

        <View style={styles.center}>
          <Text style={styles.title}>No cards yet</Text>
          <Text style={styles.subtitle}>
            Add at least 1 card to start reviewing.
          </Text>

          <Pressable
            onPress={() => router.push(`/deck/${deckId}/add-card`)}
            style={styles.primary}
          >
            <Text style={styles.primaryText}>+ Add your first card</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={styles.pill}>
          <Text style={styles.pillText}>← Back</Text>
        </Pressable>

        <Text style={styles.progress}>{progressText}</Text>
      </View>

      <Pressable onPress={() => setFlipped((v) => !v)} style={styles.card}>
        <Text style={styles.cardLabel}>{flipped ? "Back" : "Front"}</Text>
        <Text style={styles.cardText}>{flipped ? current.back : current.front}</Text>
        <Text style={styles.tapHint}>Tap to flip</Text>
      </Pressable>

      <Pressable onPress={onNextOrFinish} style={styles.nextBtn}>
        <Text style={styles.nextBtnText}>{isLast ? "Finish" : "Next →"}</Text>
      </Pressable>

      {showFinishEarly && (
        <Pressable onPress={confirmFinishEarly} style={styles.finishEarlyBtn}>
          <Text style={styles.finishEarlyText}>Finish early</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: APP_BG,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 14,
  },
  headerRow: {
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

  progress: { color: "white", opacity: 0.9, fontWeight: "800" },

  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },

  title: { fontSize: 30, fontWeight: "900", color: "white" },
  subtitle: { color: "white", opacity: 0.85, textAlign: "center" },

  primary: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: "#2247a3ff",
  },
  primaryText: { color: "white", fontWeight: "800", fontSize: 16 },

  card: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.16)",
    padding: 18,
    justifyContent: "center",
  },
  cardLabel: {
    color: "white",
    opacity: 0.8,
    fontWeight: "800",
    marginBottom: 10,
  },
  cardText: { color: "white", fontSize: 26, fontWeight: "900" },
  tapHint: { marginTop: 14, color: "white", opacity: 0.7 },

  nextBtn: {
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
  },
  nextBtnText: { color: "white", fontWeight: "900", fontSize: 16 },

  finishEarlyBtn: {
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    marginBottom: 10,
  },
  finishEarlyText: { color: "white", fontWeight: "900", fontSize: 16, opacity: 0.95 },
});
