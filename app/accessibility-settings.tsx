import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import {
  SPEECH_RATES,
  setReduceMotionOverride,
  setSpeechEnabled,
  setSpeechRate,
  useAccessibilityPreferences,
  type SpeechRate,
} from "../src/accessibility/accessibilityPreferences";
import { useTranslation } from "../src/i18n";
import { useTheme } from "@/src/theme";
import { Card } from "../src/ui/Card";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";

const SPEECH_RATE_LABEL_KEYS: Record<SpeechRate, "accessibilitySettings.speechRateSlower" | "accessibilitySettings.speechRateStandard" | "accessibilitySettings.speechRateFaster"> = {
  slower: "accessibilitySettings.speechRateSlower",
  standard: "accessibilitySettings.speechRateStandard",
  faster: "accessibilitySettings.speechRateFaster",
};

export default function AccessibilitySettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radii, spacing, touchTarget, typography } = useTheme();
  const { speechEnabled, speechRate, reduceMotionOverride } = useAccessibilityPreferences();

  return (
    <Screen scroll>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        <Text style={[typography.title, { color: colors.textPrimary }]} accessibilityRole="header">
          {t("accessibilitySettings.screenTitle")}
        </Text>
      </View>

      <View style={[styles.section, { gap: spacing.sm }]}>
        <Text style={[typography.label, { color: colors.textSecondary }]}>
          {t("accessibilitySettings.speechSectionTitle")}
        </Text>
        <Card style={{ gap: spacing.md }}>
          <View style={[styles.toggleRow, { gap: spacing.md, minHeight: touchTarget.min }]}>
            <View style={styles.toggleText}>
              <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>
                {t("accessibilitySettings.speechEnabledLabel")}
              </Text>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>
                {t("accessibilitySettings.speechEnabledDescription")}
              </Text>
            </View>
            <Switch
              value={speechEnabled}
              onValueChange={(value) => setSpeechEnabled(value)}
              trackColor={{ true: colors.accent }}
              accessibilityLabel={t("accessibilitySettings.speechEnabledLabel")}
              accessibilityRole="switch"
              accessibilityState={{ checked: speechEnabled }}
            />
          </View>

          {speechEnabled && (
            <View style={[styles.rateSection, { gap: spacing.xs, borderTopColor: colors.border, paddingTop: spacing.md }]}>
              <Text style={[typography.label, { color: colors.textSecondary }]}>
                {t("accessibilitySettings.speechRateLabel")}
              </Text>
              <View
                style={[styles.rateRow, { borderRadius: radii.md, borderColor: colors.border }]}
                accessibilityRole="radiogroup"
              >
                {SPEECH_RATES.map((rate) => {
                  const isActive = speechRate === rate;
                  const label = t(SPEECH_RATE_LABEL_KEYS[rate]);
                  return (
                    <Pressable
                      key={rate}
                      onPress={() => setSpeechRate(rate)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isActive }}
                      accessibilityLabel={label}
                      style={[
                        styles.rateSegment,
                        { minHeight: touchTarget.min, backgroundColor: isActive ? colors.accentSubtle : colors.surface },
                      ]}
                    >
                      <Text
                        style={[
                          typography.bodyMedium,
                          { color: isActive ? colors.accent : colors.textSecondary },
                          isActive && styles.rateLabelActive,
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        </Card>
      </View>

      <View style={[styles.section, { gap: spacing.sm }]}>
        <Text style={[typography.label, { color: colors.textSecondary }]}>
          {t("accessibilitySettings.sensorySectionTitle")}
        </Text>
        <Card style={{ gap: spacing.md }}>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t("accessibilitySettings.reduceMotionSystemNote")}
          </Text>
          <View style={[styles.toggleRow, { gap: spacing.md, minHeight: touchTarget.min }]}>
            <View style={styles.toggleText}>
              <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>
                {t("accessibilitySettings.reduceMotionOverrideLabel")}
              </Text>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>
                {t("accessibilitySettings.reduceMotionOverrideDescription")}
              </Text>
            </View>
            <Switch
              value={reduceMotionOverride}
              onValueChange={(value) => setReduceMotionOverride(value)}
              trackColor={{ true: colors.accent }}
              accessibilityLabel={t("accessibilitySettings.reduceMotionOverrideLabel")}
              accessibilityRole="switch"
              accessibilityState={{ checked: reduceMotionOverride }}
            />
          </View>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  section: {},
  toggleRow: { flexDirection: "row", alignItems: "center" },
  toggleText: { flex: 1, gap: 2 },
  rateSection: { borderTopWidth: 1 },
  rateRow: { flexDirection: "row", borderWidth: 1, overflow: "hidden" },
  rateSegment: { flex: 1, alignItems: "center", justifyContent: "center" },
  rateLabelActive: { fontWeight: "700" },
});
