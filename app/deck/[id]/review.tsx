import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Alert, StyleSheet, Text, View } from "react-native";

import { speechLanguageTag } from "../../../src/accessibility/speech";
import { useSpeech } from "../../../src/accessibility/useSpeech";
import { AuthService } from "../../../src/auth/AuthService";
import { applyCardReview } from "../../../src/domain/scheduling/applyCardReview";
import { activeScheduler } from "../../../src/domain/scheduling/defaults";
import { formatSchedulingIntervalPreview } from "../../../src/domain/scheduling/intervalFormat";
import { resolveCardSchedulingState } from "../../../src/domain/scheduling/migration";
import { consumePendingReviewQueue } from "../../../src/domain/scheduling/reviewQueueSession";
import { resolveReviewQueueCards } from "../../../src/domain/scheduling/resolveReviewQueueCards";
import type { CardSchedulingState, ReviewRating } from "../../../src/domain/scheduling/types";
import { smartShuffle } from "../../../src/domain/smartShuffle";
import { useTranslation } from "../../../src/i18n";
import { useLayoutDirection } from "../../../src/i18n/direction";
import type { Card } from "../../../src/models/card";
import type { Deck } from "../../../src/models/deck";
import { getCardSchedulingMap, upsertCardScheduling } from "../../../src/storage/cardScheduling";
import { getCards } from "../../../src/storage/cards";
import { getDeckById } from "../../../src/storage/decks";
import { addReviewEvent } from "../../../src/storage/reviewEvents";
import type { WorkspaceScope } from "../../../src/storage/workspaceScope";
import { Button } from "../../../src/ui/Button";
import { EmptyState } from "../../../src/ui/EmptyState";
import { FlashcardSurface } from "../../../src/ui/FlashcardSurface";
import { ProgressBar } from "../../../src/ui/ProgressBar";
import { Screen } from "../../../src/ui/Screen";
import { SpeakButton } from "../../../src/ui/SpeakButton";
import { StudyHeader } from "../../../src/ui/StudyHeader";
import { useTheme } from "@/src/theme";

const RATING_LABEL_KEYS: Record<ReviewRating, string> = {
  again: "review.rating.again",
  hard: "review.rating.hard",
  good: "review.rating.good",
  easy: "review.rating.easy",
};

// Never conveys the rating by color alone — every button also carries its own text label (the
// rating name + previewed interval); color is purely a visual accent on top of that.
const RATING_VARIANTS: Record<ReviewRating, "danger" | "secondary" | "primary"> = {
  again: "danger",
  hard: "secondary",
  good: "primary",
  easy: "secondary",
};

export default function ReviewScreen() {
  const router = useRouter();
  const { t, plural, language } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const { row, text } = useLayoutDirection();
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
  const [scope, setScope] = useState<WorkspaceScope | null>(null);
  // cardId -> its current scheduling state (absent entries are legacy/never-reviewed cards —
  // see resolveCardSchedulingState, called per-card below rather than backfilled eagerly here).
  const [schedulingMap, setSchedulingMap] = useState<Record<string, CardSchedulingState>>({});
  // Whether this session came from deck-detail's "Study Due Cards" (a scheduler-aware queue was
  // handed off) vs. plain "Study All Cards" (no queue) — affects ordering (see the load effect
  // below) and the empty-state copy only; never affects which cards count as "due" anywhere.
  const [isDueSession, setIsDueSession] = useState(false);

  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const [startedAt, setStartedAt] = useState(() => Date.now());
  // When the current card became visible — the basis for `responseTimeMs` (see
  // src/domain/scheduling/types.ts's doc comment: only ever recorded when genuinely measured).
  const [cardShownAt, setCardShownAt] = useState(() => Date.now());
  // Guards both the final "Finish" transition and a rating tap against a rapid double-tap firing
  // two navigations/reviews for the same card. Reset per-card below since it's harmless (and
  // expected) to rate/tap Next again once the next card is showing.
  const advancingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  const isSingleCard = cards.length <= 1;
  const isLastCard = cards.length > 0 && index === cards.length - 1;
  const showFinishEarly =
    loaded && cards.length > 0 && !isSingleCard && !isLastCard;

  useEffect(() => {
    let alive = true;
    // Consumed synchronously, before any await, so this exact mount is the one and only
    // consumer of whatever queue deck-detail handed off (see reviewQueueSession.ts's "consume
    // once" contract) — never re-read later in this effect or on a later re-render.
    const pendingCardIds = consumePendingReviewQueue(deckId);
    (async () => {
      if (!deckId) return;
      const activeScope = await AuthService.getActiveScope();
      const [d, data, scheduling] = await Promise.all([
        getDeckById(activeScope, deckId),
        getCards(activeScope, deckId),
        getCardSchedulingMap(activeScope, deckId),
      ]);
      // A scheduler-aware queue (deck-detail's "Study Due Cards") arrives already in the right
      // order — never re-shuffled. Plain "Study All Cards" (no queue) keeps its existing,
      // unchanged smartShuffle ordering. Either way, review.tsx itself never decides which cards
      // are due — it only resolves the given id list against the cards it actually has (see
      // resolveReviewQueueCards.ts).
      const queuedCards = resolveReviewQueueCards(data, pendingCardIds);
      const ordered = pendingCardIds ? queuedCards : smartShuffle(queuedCards);

      if (alive) {
        setScope(activeScope);
        setDeck(d);
        setCards(ordered);
        setIsDueSession(pendingCardIds !== null);
        setSchedulingMap(scheduling);
        setLoaded(true);
        setIndex(0);
        setFlipped(false);
        setStartedAt(Date.now());
        setCardShownAt(Date.now());
      }
    })();

    return () => {
      alive = false;
    };
  }, [deckId]);

  const current = cards[index];

  useEffect(() => {
    advancingRef.current = false;
    setCardShownAt(Date.now());
  }, [index]);

  // Speech must always track what's currently on screen — moving to a new card, or flipping the
  // current one, stops any in-flight speech rather than letting it keep reading stale content.
  // (Unmount/navigating away is handled separately, inside useSpeech itself.)
  useEffect(() => {
    stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, flipped]);

  const progressText = useMemo(() => {
    if (!loaded) return "";
    if (cards.length === 0) return "0 / 0";
    return `${Math.min(index + 1, cards.length)} / ${cards.length}`;
  }, [loaded, cards.length, index]);

  const isLast = isLastCard;

  const goBack = () => router.back();

  // Flipping to reveal the answer changes the FlashcardSurface's accessibilityLabel on the same
  // element the user just activated — VoiceOver/TalkBack don't reliably re-announce a changed
  // label on an already-focused control by themselves, so this makes the reveal explicit rather
  // than silent. Flipping back to the question is not announced — only the reveal direction is a
  // genuinely new disclosure worth calling out (see accessibility-foundation.md's "selective, not
  // noisy" announcement principle).
  const toggleFlip = () => {
    setFlipped((v) => {
      const next = !v;
      if (next) AccessibilityInfo.announceForAccessibility(t("review.cardBackLabel"));
      return next;
    });
  };

  const revealAnswer = () => {
    setFlipped(true);
    AccessibilityInfo.announceForAccessibility(t("review.cardBackLabel"));
  };

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

  // Once the answer is revealed, rating IS the "next" action (see docs/
  // spaced-repetition-foundation.md's "Review flow" section for why this replaces, rather than
  // supplements, the generic Next/Finish button at that point — the existing pre-flip behavior,
  // including skipping a card without flipping it, is otherwise unchanged).
  const onRate = async (cardRating: ReviewRating) => {
    if (!current || !scope) return;
    if (advancingRef.current) return;
    advancingRef.current = true;
    setSaving(true);

    const reviewedAt = new Date();
    const responseTimeMs = Math.max(0, Date.now() - cardShownAt);
    const result = applyCardReview({
      cardId: current.id,
      deckId,
      schedulingState: schedulingMap[current.id],
      rating: cardRating,
      reviewedAt,
      responseTimeMs,
    });

    if (result.status === "ok") {
      try {
        await upsertCardScheduling(scope, deckId, result.nextSchedulingState);
        await addReviewEvent(scope, deckId, result.reviewEvent);
        setSchedulingMap((prev) => ({ ...prev, [current.id]: result.nextSchedulingState }));
      } catch (error) {
        console.error("[review] failed to persist scheduling outcome:", error);
      }
    }

    setSaving(false);

    if (isLast) {
      finishSession(cards.length);
      return;
    }
    setFlipped(false);
    setIndex((prev) => prev + 1);
  };

  // Previewed outcomes for the four rating buttons, keyed by rating for lookup — recomputed
  // fresh each time the answer is revealed, never persisted (see
  // src/domain/scheduling/types.ts's `SchedulerPreviewEntry`).
  const ratingPreview = useMemo(() => {
    if (!current || !flipped) return null;
    const now = new Date();
    const state = resolveCardSchedulingState(current.id, now, schedulingMap[current.id], activeScheduler);
    const entries = activeScheduler.previewReview(state, now);
    return entries.reduce<Record<ReviewRating, (typeof entries)[number]>>((acc, entry) => {
      acc[entry.rating] = entry;
      return acc;
    }, {} as Record<ReviewRating, (typeof entries)[number]>);
  }, [current, flipped, schedulingMap]);

  const ratingButtonLabel = (nextDueAt: string, cardRating: ReviewRating) => {
    const interval = formatSchedulingIntervalPreview(nextDueAt, new Date());
    const intervalText =
      interval.unit === "minutes"
        ? plural("review.rating.inMinutes", interval.value, { count: interval.value })
        : plural("review.rating.inDays", interval.value, { count: interval.value });
    return `${t(RATING_LABEL_KEYS[cardRating] as any)} · ${intervalText}`;
  };

  // A longer, fully-worded form for screen readers specifically — "Again — review again in 1
  // minute" rather than the visible label's compact "Again · 1 min" (abbreviations like "min"
  // can read awkwardly through a screen reader). Still just one short phrase, not a paragraph.
  const ratingAccessibilityLabel = (nextDueAt: string, cardRating: ReviewRating) => {
    const interval = formatSchedulingIntervalPreview(nextDueAt, new Date());
    const intervalText =
      interval.unit === "minutes"
        ? plural("review.rating.inMinutesFull", interval.value, { count: interval.value })
        : plural("review.rating.inDays", interval.value, { count: interval.value });
    return `${t(RATING_LABEL_KEYS[cardRating] as any)} — ${t("review.rating.accessibleSuffix", { interval: intervalText })}`;
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
    // Deck-detail already refuses to start a due session with zero due cards (see
    // reviewQueueSession.ts) — reaching this with isDueSession true means every queued card
    // became unavailable (e.g. deleted) in the brief window between the queue being built and
    // this screen mounting. A rare race, not the ordinary "deck has no cards" case, so it gets
    // its own honest message instead of "add your first card."
    if (isDueSession) {
      return (
        <Screen>
          <StudyHeader title={deck?.title ?? t("review.fallbackTitle")} onClose={goBack} />
          <View style={styles.emptyFill}>
            <EmptyState icon="checkmark-circle-outline" title={t("review.dueSessionUnavailableTitle")} description={t("review.dueSessionUnavailableBody")}>
              <Button label={t("review.backToDeckButton")} variant="primary" fullWidth onPress={goBack} />
            </EmptyState>
          </View>
        </Screen>
      );
    }
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
        onPress={toggleFlip}
        hint={t("review.flipHint")}
      />

      {speechEnabled && (
        <View style={[styles.speakRow, { marginTop: -spacing.sm }]}>
          <SpeakButton
            isSpeaking={isSpeaking}
            onPress={() => (isSpeaking ? stop() : speak(flipped ? current.back : current.front))}
            playLabel={flipped ? t("review.speakAnswerLabel") : t("review.speakQuestionLabel")}
            stopLabel={t("review.stopSpeechLabel")}
          />
        </View>
      )}

      {!flipped ? (
        <>
          <Button label={t("review.showAnswerButton")} variant="secondary" fullWidth onPress={revealAnswer} />
          <Button
            label={isLast ? t("review.finishButton") : t("review.nextButton")}
            variant="primary"
            fullWidth
            onPress={onNextOrFinish}
          />
        </>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.label, text, { color: colors.textPrimary }]}>{t("review.rating.prompt")}</Text>
          <Text style={[typography.caption, text, { color: colors.textSecondary }]}>{t("review.rating.explanation")}</Text>
          {ratingPreview && (
            <>
              <View style={[styles.ratingRow, row, { gap: spacing.sm }]}>
                {(["again", "hard"] as const).map((r) => (
                  <View key={r} style={styles.ratingButton}>
                    <Button
                      label={ratingButtonLabel(ratingPreview[r].nextState.dueAt, r)}
                      accessibilityLabel={ratingAccessibilityLabel(ratingPreview[r].nextState.dueAt, r)}
                      variant={RATING_VARIANTS[r]}
                      size="sm"
                      fullWidth
                      disabled={saving}
                      onPress={() => onRate(r)}
                    />
                  </View>
                ))}
              </View>
              <View style={[styles.ratingRow, row, { gap: spacing.sm }]}>
                {(["good", "easy"] as const).map((r) => (
                  <View key={r} style={styles.ratingButton}>
                    <Button
                      label={ratingButtonLabel(ratingPreview[r].nextState.dueAt, r)}
                      accessibilityLabel={ratingAccessibilityLabel(ratingPreview[r].nextState.dueAt, r)}
                      variant={RATING_VARIANTS[r]}
                      size="sm"
                      fullWidth
                      disabled={saving}
                      onPress={() => onRate(r)}
                    />
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
      )}

      {showFinishEarly && (
        <Button label={t("review.finishEarlyButton")} variant="ghost" fullWidth disabled={saving} onPress={confirmFinishEarly} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  emptyFill: { flex: 1, justifyContent: "center" },
  speakRow: { flexDirection: "row", justifyContent: "flex-end" },
  ratingRow: { alignItems: "stretch" },
  ratingButton: { flex: 1 },
});
