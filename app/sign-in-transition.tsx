import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from "react-native";

import type { UserIdentity } from "../src/auth/identity";
import { defaultSignInTransitionDeps, runSignInTransition } from "../src/auth/signInTransition";
import {
  getTransitionReadyMessage,
  getTransitionRestoringMessage,
} from "../src/content/transitionMessages";
import { useTranslation } from "../src/i18n";
import { useTheme } from "@/src/theme";
import { Screen } from "../src/ui/Screen";

export default function SignInTransitionScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const [phase, setPhase] = useState<"restoring" | "ready">("restoring");
  const [readyMessage, setReadyMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduceMotion) => {
        if (cancelled) return;
        Animated.timing(opacity, {
          toValue: 1,
          duration: reduceMotion ? 0 : 220,
          useNativeDriver: true,
        }).start();
      });

    return () => {
      cancelled = true;
    };
  }, [opacity]);

  useEffect(() => {
    let cancelled = false;

    runSignInTransition({
      ...defaultSignInTransitionDeps,
      onPhaseChange: (nextPhase, identity: UserIdentity | null) => {
        if (cancelled) return;
        // Prefers nickname over given_name (never falls further to email prefix/"there" here —
        // a warm welcome message should stay silent-on-name rather than show an email prefix).
        setReadyMessage(getTransitionReadyMessage(t, identity?.nickname || identity?.givenName));
        setPhase(nextPhase);
      },
      navigate: () => {
        if (cancelled) return;
        // dismissAll() (not replace) collapses back to the Home instance that has been at the
        // root of the stack since launch, instead of stacking a second Home on top of it — see
        // src/auth/signInTransition.ts and app/sign-in.tsx for the same fix applied uniformly.
        router.dismissAll();
      },
    });

    return () => {
      cancelled = true;
    };
  }, [router, t]);

  return (
    <Screen>
      <View style={styles.center}>
        <Animated.View style={{ opacity }}>
          <Text style={[typography.heading, { color: colors.textPrimary }]}>
            {phase === "restoring" ? getTransitionRestoringMessage(t) : readyMessage ?? t("auth.workspaceReady")}
          </Text>
        </Animated.View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
