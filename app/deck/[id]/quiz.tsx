import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthService } from "../../../src/auth/AuthService";
import type { Card } from "../../../src/models/card";
import { smartShuffle } from "../../../src/domain/smartShuffle";
import { getCards } from "../../../src/storage/cards";

const APP_BG = "#2FA4A3";

type Option = {
  id: string;
  text: string;
};

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function QuizScreen() {
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
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);

  const [startedAt, setStartedAt] = useState(() => Date.now());

  const [options, setOptions] = useState<Option[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wasCorrect, setWasCorrect] = useState<boolean | null>(null);

  const isSingleCard = cards.length <= 1;
  const isLastCard = cards.length > 0 && index === cards.length - 1;
  const showFinishEarly = loaded && cards.length > 0 && !isSingleCard && !isLastCard;

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

        setScore(0);
        scoreRef.current = 0;

        setStartedAt(Date.now());
        setSelectedId(null);
        setWasCorrect(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [deckId]);

  const current = cards[index];

  useEffect(() => {
    if (!loaded) return;
    if (!current) return;

    const correct: Option = { id: current.id, text: current.back };

    const others = cards
      .filter((c) => c.id !== current.id)
      .map((c) => ({ id: c.id, text: c.back }));

    const wrong = shuffle(others).slice(0, 3);
    const opts = shuffle([correct, ...wrong]);

    setOptions(opts);
    setSelectedId(null);
    setWasCorrect(null);
  }, [loaded, index]); // eslint-disable-line react-hooks/exhaustive-deps

  const progress = useMemo(() => {
    if (!loaded) return "";
    if (cards.length === 0) return "0 / 0";
    return `${index + 1} / ${cards.length}`;
  }, [loaded, index, cards.length]);

  const canQuiz = loaded && cards.length >= 4;

  const onPick = (opt: Option) => {
    if (!current) return;
    if (selectedId) return;

    setSelectedId(opt.id);

    const correct = opt.id === current.id;
    setWasCorrect(correct);

    if (correct) {
      scoreRef.current += 1;
      setScore(scoreRef.current);
    }
  };

  const onNext = () => {
    if (!selectedId) return;

    const isLast = index >= cards.length - 1;
    if (isLast) {
      const total = cards.length;
      const correct = scoreRef.current;

      router.replace({
        pathname: "/deck/[id]/quiz-results",
        params: {
          id: deckId,
          total: String(total),
          correct: String(correct),
          startedAt: String(startedAt),
          finishedAt: String(Date.now()),
        },
      });
      return;
    }

    setIndex((i) => i + 1);
  };

  const confirmFinishEarly = () => {
    if (cards.length === 0) return;

    const attempted = Math.min(index + 1, cards.length);
    const correct = scoreRef.current;
    const percent = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;

    Alert.alert(
      "Finish quiz early?",
      `This will log a quiz session for ${attempted} card${
        attempted === 1 ? "" : "s"
      }.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Finish",
          style: "default",
          onPress: () =>
            router.replace({
              pathname: "/deck/[id]/quiz-results",
              params: {
                id: deckId,
                total: String(attempted),
                correct: String(correct),
                percent: String(percent),
                startedAt: String(startedAt),
                finishedAt: String(Date.now()),
              },
            }),
        },
      ]
    );
  };

  if (!loaded) {
    return (
      <SafeAreaView style={styles.screen}>
        <Text style={styles.subtle}>Loading…</Text>
      </SafeAreaView>
    );
  }

  if (cards.length === 0) {
    return (
      <SafeAreaView style={styles.screen}>
        <Pressable onPress={() => router.back()} style={styles.pill}>
          <Text style={styles.pillText}>← Back</Text>
        </Pressable>

        <View style={styles.center}>
          <Text style={styles.title}>No cards yet</Text>
          <Text style={styles.subtle}>Add cards to start a quiz.</Text>
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

  if (!canQuiz) {
    return (
      <SafeAreaView style={styles.screen}>
        <Pressable onPress={() => router.back()} style={styles.pill}>
          <Text style={styles.pillText}>← Back</Text>
        </Pressable>

        <View style={styles.center}>
          <Text style={styles.title}>Need 4 cards</Text>
          <Text style={styles.subtle}>
            Quiz Mode needs at least 4 cards to generate options.
          </Text>
          <Pressable
            onPress={() => router.push(`/deck/${deckId}/add-card`)}
            style={styles.primary}
          >
            <Text style={styles.primaryText}>+ Add more cards</Text>
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
        <Text style={styles.progress}>{progress}</Text>
      </View>

      <View style={styles.questionCard}>
        <Text style={styles.label}>Question</Text>
        <Text style={styles.questionText}>{current.front}</Text>
      </View>

      <View style={{ gap: 12 }}>
        {options.map((opt) => {
          const isSelected = selectedId === opt.id;
          const isCorrect = current && opt.id === current.id;

          const showState = selectedId !== null;

          const border =
            showState && isCorrect ? "rgba(0,0,0,0.0)" : "rgba(255,255,255,0.25)";

          const bg =
            showState && isCorrect
              ? "rgba(255,255,255,0.28)"
              : showState && isSelected && !isCorrect
              ? "rgba(255,255,255,0.10)"
              : "rgba(255,255,255,0.16)";

          return (
            <Pressable
              key={opt.id}
              onPress={() => onPick(opt)}
              disabled={selectedId !== null}
              style={[styles.option, { borderColor: border, backgroundColor: bg }]}
            >
              <Text style={styles.optionText}>{opt.text}</Text>
            </Pressable>
          );
        })}
      </View>

      {wasCorrect !== null && (
        <Text style={styles.feedback}>{wasCorrect ? "Correct" : "Not quite"}</Text>
      )}

      {showFinishEarly && (
        <Pressable onPress={confirmFinishEarly} style={styles.finishEarlyBtn}>
          <Text style={styles.finishEarlyText}>Finish early</Text>
        </Pressable>
      )}

      <Pressable
        onPress={onNext}
        disabled={!selectedId}
        style={[styles.nextBtn, !selectedId && { opacity: 0.5 }]}
      >
        <Text style={styles.nextBtnText}>
          {index >= cards.length - 1 ? "Finish" : "Next →"}
        </Text>
      </Pressable>
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
  progress: { color: "white", opacity: 0.9, fontWeight: "900" },

  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  title: { fontSize: 30, fontWeight: "900", color: "white" },
  subtle: { color: "white", opacity: 0.85, textAlign: "center" },

  primary: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: "#2247a3ff",
  },
  primaryText: { color: "white", fontWeight: "900", fontSize: 16 },

  questionCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.16)",
    padding: 18,
  },
  label: { color: "white", opacity: 0.8, fontWeight: "800", marginBottom: 10 },
  questionText: { color: "white", fontSize: 26, fontWeight: "900" },

  option: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  optionText: { color: "white", fontWeight: "800" },

  feedback: { color: "white", fontWeight: "900", textAlign: "center" },

  nextBtn: {
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    marginBottom: 10,
  },
  nextBtnText: { color: "white", fontWeight: "900", fontSize: 16 },

  finishEarlyBtn: {
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
  },
  finishEarlyText: { color: "white", fontWeight: "900", fontSize: 16, opacity: 0.95 },
});
