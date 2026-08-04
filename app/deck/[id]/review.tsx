import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import { smartShuffle } from "../../../src/domain/smartShuffle";
import { useTranslation } from "../../../src/i18n";
import type { Card } from "../../../src/models/card";
import type { Deck } from "../../../src/models/deck";
import { getCards } from "../../../src/storage/cards";
import { getDeckById } from "../../../src/storage/decks";
import { Button } from "../../../src/ui/Button";
import { EmptyState } from "../../../src/ui/EmptyState";
import { FlashcardSurface } from "../../../src/ui/FlashcardSurface";
import { ProgressBar } from "../../../src/ui/ProgressBar";
import { Screen } from "../../../src/ui/Screen";
import { StudyHeader } from "../../../src/ui/StudyHeader";
import { useTheme } from "@/src/theme";

export default function ReviewScreen() {
  const router = useRouter();
  const { t, plural } = useTranslation();
  const { colors, typography } = useTheme();
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
  const [flipped, setFlipped] = useState(false);

  const [startedAt, setStartedAt] = useState(() => Date.now());
  // Guards the final "Finish" transition against a rapid double-tap firing two navigations.
  // Reset per-card below since it's harmless (and expected) to tap Next again once the next
  // card is showing.
  const advancingRef = useRef(false);

  const isSingleCard = cards.length <= 1;
  const isLastCard = cards.length > 0 && index === cards.length - 1;
  const showFinishEarly =
    loaded && cards.length > 0 && !isSingleCard && !isLastCard;

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
        setFlipped(false);
        setStartedAt(Date.now());
      }
    })();

    return () => {
      alive = false;
    };
  }, [deckId]);

  const current = cards[index];

  useEffect(() => {
    advancingRef.current = false;
  }, [index]);

  const progressText = useMemo(() => {
    if (!loaded) return "";
    if (cards.length === 0) return "0 / 0";
    return `${Math.min(index + 1, cards.length)} / ${cards.length}`;
  }, [loaded, cards.length, index]);

  const isLast = isLastCard;

  const goBack = () => router.back();

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
    if (advancingRef.current) return;
    advancingRef.current = true;

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
      t("review.finishEarlyTitle"),
      plural("review.finishEarlyBody", attempted),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("review.finishButton"),
          style: "default",
          onPress: () => finishSession(attempted),
        },
      ]
    );
  };

  if (!loaded) {
    return (
      <Screen>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("review.loading")}</Text>
      </Screen>
    );
  }

  if (cards.length === 0) {
    return (
      <Screen>
        <StudyHeader title={deck?.title ?? t("review.fallbackTitle")} onClose={goBack} />
        <View style={styles.emptyFill}>
          <EmptyState
            icon="albums-outline"
            title={t("review.emptyTitle")}
            description={t("review.emptyDescription")}
          >
            <Button
              label={t("review.addFirstCardButton")}
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
    <Screen>
      <StudyHeader title={deck?.title ?? t("review.fallbackTitle")} progressLabel={progressText} onClose={goBack} />
      <ProgressBar current={index} total={cards.length} />

      <FlashcardSurface
        label={flipped ? t("review.cardBackLabel") : t("review.cardFrontLabel")}
        content={flipped ? current.back : current.front}
        onPress={() => setFlipped((v) => !v)}
        hint={t("review.flipHint")}
      />

      {!flipped && (
        <Button label={t("review.showAnswerButton")} variant="secondary" fullWidth onPress={() => setFlipped(true)} />
      )}

      <Button
        label={isLast ? t("review.finishButton") : t("review.nextButton")}
        variant="primary"
        fullWidth
        onPress={onNextOrFinish}
      />

      {showFinishEarly && (
        <Button label={t("review.finishEarlyButton")} variant="ghost" fullWidth onPress={confirmFinishEarly} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  emptyFill: { flex: 1, justifyContent: "center" },
});
