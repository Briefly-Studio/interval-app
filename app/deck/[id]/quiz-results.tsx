import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthService } from "../../../src/auth/AuthService";
import { type SessionRecord, upgradeSession } from "../../../src/models/session";
import { addSession } from "../../../src/storage/sessions";

const APP_BG = "#2FA4A3";

const formatDuration = (startedAt: number, finishedAt: number) => {
  const diff = Math.max(0, finishedAt - startedAt);
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

export default function QuizResults() {
  const router = useRouter();
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
    <SafeAreaView style={styles.screen}>
      <Pressable onPress={() => navigateOnce(goBackToDeck)} disabled={navBusy} style={styles.pill}>
        <Text style={styles.pillText}>← Back</Text>
      </Pressable>

      <View style={styles.center}>
        <Text style={styles.title}>Quiz Complete</Text>

        {/* Main score */}
        <Text style={styles.big}>
          {correct} / {total}
        </Text>
        <Text style={styles.percent}>{percent}%</Text>

        {/* NEW: explicit breakdown */}
        <View style={styles.breakdownRow}>
          <View style={styles.breakdownPill}>
            <Text style={styles.breakdownLabel}>Right</Text>
            <Text style={styles.breakdownValue}>{correct}</Text>
          </View>

          <View style={styles.breakdownPill}>
            <Text style={styles.breakdownLabel}>Wrong</Text>
            <Text style={styles.breakdownValue}>{wrong}</Text>
          </View>
        </View>

        <Text style={styles.subtle}>Time: {durationText}</Text>

        <Pressable
          onPress={() => navigateOnce(() => router.replace(`/deck/${deckId}/quiz`))}
          disabled={navBusy}
          style={styles.primary}
        >
          <Text style={styles.primaryText}>Retry</Text>
        </Pressable>

        <Pressable
          onPress={() => navigateOnce(goBackToDeck)}
          disabled={navBusy}
          style={styles.secondary}
        >
          <Text style={styles.secondaryText}>Back to deck</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: APP_BG,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  pill: {
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  pillText: { color: "white", fontWeight: "700" },

  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 10 },

  title: { fontSize: 34, fontWeight: "900", color: "white" },
  big: { marginTop: 8, fontSize: 64, fontWeight: "900", color: "white" },
  percent: { marginTop: -4, fontSize: 22, fontWeight: "900", color: "white", opacity: 0.95 },

  breakdownRow: {
    marginTop: 8,
    flexDirection: "row",
    gap: 12,
  },
  breakdownPill: {
    minWidth: 120,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
  },
  breakdownLabel: { color: "white", opacity: 0.8, fontWeight: "900", fontSize: 12 },
  breakdownValue: { marginTop: 4, color: "white", fontWeight: "900", fontSize: 22 },

  subtle: { marginTop: 8, color: "white", opacity: 0.8, fontWeight: "700" },

  primary: {
    marginTop: 14,
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 14,
    backgroundColor: "#2247a3ff",
  },
  primaryText: { color: "white", fontWeight: "900", fontSize: 16 },

  secondary: {
    marginTop: 6,
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  secondaryText: { color: "white", fontWeight: "900", fontSize: 16 },
});
