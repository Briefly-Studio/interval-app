import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import { useTranslation } from "../../../src/i18n";
import { type SessionRecord, upgradeSession } from "../../../src/models/session";
import { addSession } from "../../../src/storage/sessions";
import { Button } from "../../../src/ui/Button";
import { Card } from "../../../src/ui/Card";
import { ResultMetric } from "../../../src/ui/ResultMetric";
import { Screen } from "../../../src/ui/Screen";
import { colors, spacing, typography } from "../../../src/ui/theme";

const formatDuration = (startedAt: number, finishedAt: number) => {
  const diff = Math.max(0, finishedAt - startedAt);
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

export default function QuizResults() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams();

  const pickParam = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const toNumber = (value: string | string[] | undefined, fallback = 0) => {
    const raw = pickParam(value);
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const deckId = pickParam(params.id) ?? "";
  const correct = toNumber(params.correct, 0);
  const total = toNumber(params.total, 0);
  const startedAt = toNumber(params.startedAt, Date.now());
  const finishedAt = toNumber(params.finishedAt, Date.now());

  const wrong = Math.max(0, total - correct);

  const percent = useMemo(() => {
    if (total <= 0) return 0;
    return Math.round((correct / total) * 100);
  }, [correct, total]);

  const durationText = useMemo(
    () => formatDuration(startedAt, finishedAt),
    [startedAt, finishedAt]
  );

  const sessionLogged = useRef(false);
  const navLock = useRef(false);
  const [navBusy, setNavBusy] = useState(false);

  const navigateOnce = (action: () => void) => {
    if (navLock.current || navBusy) return;
    navLock.current = true;
    setNavBusy(true);
    action();
  };

  const goBackToDeck = () => {
    if (router.canGoBack && router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(`/deck/${deckId}`);
  };

  useEffect(() => {
    if (sessionLogged.current) return;
    if (!deckId) return;

    sessionLogged.current = true;

    const now = new Date().toISOString();
    const session: SessionRecord = {
      ...upgradeSession({
        id: String(Date.now()),
        deckId,
        mode: "quiz",
        startedAt,
        finishedAt,
        total,
        percent,
      }),
      rev: 1,
      updatedAt: now,
      dirty: true,
    };

    (async () => {
      try {
        const scope = await AuthService.getActiveScope();
        await addSession(scope, session);
      } catch {
        // ignore recording errors
      }
    })();
  }, [deckId, total, percent, startedAt, finishedAt]);

  return (
    <Screen>
      <View style={styles.center}>
        <Text style={typography.title}>{t("quizResults.title")}</Text>
        <Text style={styles.bigScore}>
          {correct} / {total}
        </Text>
        <Text style={styles.percent}>{percent}%</Text>

        <Card style={styles.summaryCard}>
          <View style={styles.metricsRow}>
            <ResultMetric label={t("quizResults.correctLabel")} value={String(correct)} />
            <ResultMetric label={t("quizResults.incorrectLabel")} value={String(wrong)} />
            <ResultMetric label={t("quizResults.timeLabel")} value={durationText} />
          </View>
        </Card>

        <Button
          label={t("quizResults.retryButton")}
          variant="primary"
          fullWidth
          disabled={navBusy}
          onPress={() => navigateOnce(() => router.replace(`/deck/${deckId}/quiz`))}
        />
        <Button
          label={t("quizResults.backToDeckButton")}
          variant="secondary"
          fullWidth
          disabled={navBusy}
          onPress={() => navigateOnce(goBackToDeck)}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", gap: spacing.md },
  bigScore: { fontSize: 48, fontWeight: "700", color: colors.textPrimary },
  percent: { fontSize: 18, fontWeight: "600", color: colors.textSecondary, marginBottom: spacing.sm },
  summaryCard: { alignItems: "center" },
  metricsRow: { flexDirection: "row", gap: spacing.xl },
});
