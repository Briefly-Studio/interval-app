import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import { formatDuration, formatTimestamp } from "../../../src/domain/sessionFormat";
import { useTranslation } from "../../../src/i18n";
import type { Deck } from "../../../src/models/deck";
import type { StudySession } from "../../../src/models/session";
import { getDeckById } from "../../../src/storage/decks";
import { deleteSessionsForDeck, getSessionsForDeck } from "../../../src/storage/sessions";
import { Button } from "../../../src/ui/Button";
import { EmptyState } from "../../../src/ui/EmptyState";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";
import { SessionCard } from "../../../src/ui/SessionCard";
import { useTheme } from "@/src/theme";

export default function DeckHistoryScreen() {
  const router = useRouter();
  const { t, plural, language } = useTranslation();
  const { colors, spacing, typography } = useTheme();
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
      t("history.clearConfirmTitle"),
      t("history.clearConfirmBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("history.clearButton"),
          style: "destructive",
          onPress: async () => {
            try {
              const scope = await AuthService.getActiveScope();
              await deleteSessionsForDeck(scope, deckId);
              setSessions([]);
            } catch {
              Alert.alert(t("history.clearFailedTitle"), t("history.clearFailedBody"));
            }
          },
        },
      ]
    );
  };

  const isEmpty = loaded && sessions.length === 0;

  return (
    <Screen>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        <Text style={[typography.title, { color: colors.textPrimary }]} accessibilityRole="header">{t("history.screenTitle")}</Text>
        <Button
          label={t("history.clearButton")}
          variant="danger"
          size="sm"
          disabled={sessions.length === 0}
          onPress={confirmClear}
        />
      </View>
      <Text style={[typography.secondary, { color: colors.textSecondary }]}>
        {deck?.title ? `${deck.title} • ` : ""}
        {loaded ? plural("history.sessionsCount", sessions.length) : t("history.loading")}
      </Text>

      {isEmpty ? (
        <View style={styles.emptyFill}>
          <EmptyState
            icon="time-outline"
            title={t("history.emptyTitle")}
            description={t("history.emptyDescription")}
          >
            <Button
              label={t("history.startReviewing")}
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
          contentContainerStyle={[styles.list, { gap: spacing.sm, paddingBottom: spacing.xl }]}
          renderItem={({ item }) => {
            const parts = [
              item.mode === "quiz" ? t("history.sessionModeQuiz") : t("history.sessionModeReview"),
              item.mode === "quiz" && typeof item.percent === "number" ? `${item.percent}%` : null,
              plural("history.cardsCount", item.total),
            ].filter(Boolean) as string[];

            return (
              <SessionCard
                title={parts.join(" • ")}
                subtitle={`${formatTimestamp(item.finishedAt, language)} • ${formatDuration(item.startedAt, item.finishedAt, t)}`}
              />
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  emptyFill: { flex: 1, justifyContent: "center" },
  flex1: { flex: 1 },
  list: {},
});
