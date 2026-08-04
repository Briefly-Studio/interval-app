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
import { useTheme } from "@/src/theme";

const formatDuration = (startedAt: number, finishedAt: number) => {
  const diff = Math.max(0, finishedAt - startedAt);
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

export default function ReviewResults() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const params = useLocalSearchParams();

  const pickParam = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const toNumber = (value: string | string[] | undefined, fallback = 0) => {
    const raw = pickParam(value);
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const deckId = pickParam(params.id) ?? "";
  const total = toNumber(params.total, 0);
  const startedAt = toNumber(params.startedAt, Date.now());
  const finishedAt = toNumber(params.finishedAt, Date.now());

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
        mode: "review",
        startedAt,
        finishedAt,
        total,
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
  }, [deckId, total, startedAt, finishedAt]);

  return (
    <Screen>
      <View style={[styles.center, { gap: spacing.lg }]}>
        <Text style={[typography.title, { color: colors.textPrimary }]}>{t("reviewResults.title")}</Text>

        <Card style={styles.summaryCard}>
          <View style={[styles.metricsRow, { gap: spacing.xxl }]}>
            <ResultMetric label={t("reviewResults.cardsReviewedLabel")} value={String(total)} />
            <ResultMetric label={t("reviewResults.timeLabel")} value={durationText} />
          </View>
        </Card>

        <Button
          label={t("reviewResults.reviewAgainButton")}
          variant="primary"
          fullWidth
          disabled={navBusy}
          onPress={() => navigateOnce(() => router.replace(`/deck/${deckId}/review`))}
        />
        <Button
          label={t("reviewResults.backToDeckButton")}
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
  center: { flex: 1, justifyContent: "center" },
  summaryCard: { alignItems: "center" },
  metricsRow: { flexDirection: "row" },
});
