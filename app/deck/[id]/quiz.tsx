import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { speechLanguageTag } from "../../../src/accessibility/speech";
import { useSpeech } from "../../../src/accessibility/useSpeech";
import { AuthService } from "../../../src/auth/AuthService";
import { smartShuffle } from "../../../src/domain/smartShuffle";
import { useTranslation } from "../../../src/i18n";
import type { Card } from "../../../src/models/card";
import type { Deck } from "../../../src/models/deck";
import { getCards } from "../../../src/storage/cards";
import { getDeckById } from "../../../src/storage/decks";
import { AnswerOption, type AnswerOptionState } from "../../../src/ui/AnswerOption";
import { Button } from "../../../src/ui/Button";
import { Card as Surface } from "../../../src/ui/Card";
import { EmptyState } from "../../../src/ui/EmptyState";
import { ProgressBar } from "../../../src/ui/ProgressBar";
import { Screen } from "../../../src/ui/Screen";
import { SpeakButton } from "../../../src/ui/SpeakButton";
import { StudyHeader } from "../../../src/ui/StudyHeader";
import { useTheme } from "@/src/theme";

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
  const { t, plural, language } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const { speak, stop, isSpeaking, speechEnabled } = useSpeech(speechLanguageTag(language));
  const params = useLocalSearchParams();
  const idParam = params.id;

  const deckId =
    typeof idParam === "string"
      ? idParam
      : Array.isArray(idParam)
      ? idParam[0]
      : "";

  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [index, setIndex] = useState(0);
  const scoreRef = useRef(0);

  const [startedAt, setStartedAt] = useState(() => Date.now());
  // Guards the final "Finish" transition against a rapid double-tap firing two navigations.
  const advancingRef = useRef(false);

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
      const [d, data] = await Promise.all([getDeckById(scope, deckId), getCards(scope, deckId)]);
      const ordered = smartShuffle(data);

      if (alive) {
        setDeck(d);
        setCards(ordered);
        setLoaded(true);
        setIndex(0);
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
    advancingRef.current = false;
    // A new question is now on screen — any speech for the previous one must stop rather than
    // keep reading over it. (Unmount/navigating away is handled separately, inside useSpeech.)
    stop();
  }, [loaded, index]); // eslint-disable-line react-hooks/exhaustive-deps

  const progress = useMemo(() => {
    if (!loaded) return "";
    if (cards.length === 0) return "0 / 0";
    return `${index + 1} / ${cards.length}`;
  }, [loaded, index, cards.length]);

  const canQuiz = loaded && cards.length >= 4;

  const goBack = () => router.back();

  const onPick = (opt: Option) => {
    if (!current) return;
    if (selectedId) return;

    setSelectedId(opt.id);

    const correct = opt.id === current.id;
    setWasCorrect(correct);

    if (correct) {
      scoreRef.current += 1;
    }
  };

  const onNext = () => {
    if (!selectedId) return;
    if (advancingRef.current) return;

    const isLast = index >= cards.length - 1;
    if (isLast) {
      advancingRef.current = true;
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
      t("quiz.finishEarlyTitle"),
      plural("quiz.finishEarlyBody", attempted),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("quiz.finishButton"),
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
      <Screen>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("quiz.loading")}</Text>
      </Screen>
    );
  }

  if (cards.length === 0) {
    return (
      <Screen>
        <StudyHeader title={deck?.title ?? t("quiz.fallbackTitle")} onClose={goBack} />
        <View style={styles.emptyFill}>
          <EmptyState icon="albums-outline" title={t("quiz.emptyTitle")} description={t("quiz.emptyDescription")}>
            <Button
              label={t("quiz.addFirstCardButton")}
              variant="primary"
              fullWidth
              onPress={() => router.push(`/deck/${deckId}/add-card`)}
            />
          </EmptyState>
        </View>
      </Screen>
    );
  }

  if (!canQuiz) {
    return (
      <Screen>
        <StudyHeader title={deck?.title ?? t("quiz.fallbackTitle")} onClose={goBack} />
        <View style={styles.emptyFill}>
          <EmptyState
            icon="help-circle-outline"
            title={t("quiz.needMoreCardsTitle")}
            description={t("quiz.needMoreCardsDescription")}
          >
            <Button
              label={t("quiz.addMoreCardsButton")}
              variant="primary"
              fullWidth
              onPress={() => router.push(`/deck/${deckId}/add-card`)}
            />
          </EmptyState>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <StudyHeader title={deck?.title ?? t("quiz.fallbackTitle")} progressLabel={progress} onClose={goBack} />
      <ProgressBar current={index} total={cards.length} />

      <Surface style={[styles.questionCard, { gap: spacing.sm }]}>
        <View style={styles.questionHeaderRow}>
          <Text style={[typography.label, { color: colors.textPrimary }]}>{t("quiz.questionLabel")}</Text>
          {speechEnabled && (
            <SpeakButton
              isSpeaking={isSpeaking}
              onPress={() => (isSpeaking ? stop() : speak(current.front))}
              playLabel={t("quiz.speakQuestionLabel")}
              stopLabel={t("quiz.stopSpeechLabel")}
            />
          )}
        </View>
        <Text style={[typography.title, styles.questionText, { color: colors.textPrimary }]}>{current.front}</Text>
      </Surface>

      <View style={[styles.optionsList, { gap: spacing.sm }]}>
        {options.map((opt) => {
          const isSelected = selectedId === opt.id;
          const isCorrectOption = !!current && opt.id === current.id;
          const showState = selectedId !== null;

          let state: AnswerOptionState = "default";
          if (showState) {
            if (isCorrectOption) state = "correct";
            else if (isSelected) state = "incorrect";
            else state = "dimmed";
          }

          return (
            <AnswerOption
              key={opt.id}
              label={opt.text}
              state={state}
              disabled={selectedId !== null}
              onPress={() => onPick(opt)}
            />
          );
        })}
      </View>

      {wasCorrect !== null && (
        <Text
          style={[
            typography.bodyMedium,
            styles.feedback,
            { color: wasCorrect ? colors.success : colors.danger },
          ]}
        >
          {wasCorrect ? t("quiz.correctFeedback") : t("quiz.incorrectFeedback")}
        </Text>
      )}

      <Button
        label={index >= cards.length - 1 ? t("quiz.finishButton") : t("quiz.nextButton")}
        variant="primary"
        fullWidth
        disabled={!selectedId}
        onPress={onNext}
      />

      {showFinishEarly && (
        <Button label={t("quiz.finishEarlyButton")} variant="ghost" fullWidth onPress={confirmFinishEarly} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  emptyFill: { flex: 1, justifyContent: "center" },
  questionCard: {},
  questionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  questionText: { fontSize: 22 },
  optionsList: {},
  feedback: { textAlign: "center" },
});
