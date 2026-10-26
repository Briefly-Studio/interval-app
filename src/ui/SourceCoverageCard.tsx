import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { deriveSourceCoverageDisplayState, type SourceCoverage } from "../domain/sourceCoverage";
import { useTranslation } from "../i18n";
import { useLayoutDirection } from "../i18n/direction";
import { useTheme } from "@/src/theme";
import { Card } from "./Card";
import { ProgressBar } from "./ProgressBar";

/** Aggregate saved-card coverage only. Keep actions separate so future source-scope work can
 * add an action below the summary without coupling this component to generation/navigation. */
export function SourceCoverageCard({ coverage, loading }: { coverage: SourceCoverage | null; loading: boolean }) {
  const { t, plural } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const { direction, row, text } = useLayoutDirection();
  const state = coverage ? deriveSourceCoverageDisplayState(coverage) : null;
  const summary = state && state.kind !== "no-content"
    ? plural("sourceCoverage.summary", state.totalChunkCount, { covered: state.coveredChunkCount, total: state.totalChunkCount })
    : "";
  const percent = state && state.kind !== "no-content" ? t("sourceCoverage.percentLabel", { percent: state.percent }) : "";

  return (
    <Card style={{ gap: spacing.sm }}>
      <Text accessibilityRole="header" style={[typography.subheading, text, { color: colors.textPrimary }]}>
        {t("sourceCoverage.heading")}
      </Text>
      <View style={[styles.content, { gap: spacing.sm }]}>
        {loading ? (
          <View style={[row, { alignItems: "center", gap: spacing.sm }]} accessibilityState={{ busy: true }}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[typography.secondary, text, styles.flexible, { color: colors.textSecondary }]}>
              {t("sourceCoverage.loading")}
            </Text>
          </View>
        ) : !state || state.kind === "no-content" ? (
          <Text style={[typography.secondary, text, { color: colors.textSecondary }]}>
            {t(state ? "sourceCoverage.noContent" : "sourceCoverage.unavailable")}
          </Text>
        ) : (
          <>
            <Text style={[typography.bodyMedium, text, { color: colors.textPrimary }]}>
              {state.kind === "no-cards"
                ? t("sourceCoverage.noCardsYet")
                : state.kind === "full"
                  ? plural("sourceCoverage.fullyCovered", state.totalChunkCount)
                  : summary}
            </Text>
            <Text style={[typography.title, text, { color: colors.textPrimary }]}>{percent}</Text>
            <ProgressBar
              current={state.coveredChunkCount}
              total={state.totalChunkCount}
              direction={direction}
              accessibilityLabel={t("sourceCoverage.heading")}
              accessibilityValueText={`${summary}. ${percent}`}
            />
            {state.kind !== "full" ? (
              <Text style={[typography.secondary, text, { color: colors.textSecondary }]}>
                {state.kind === "no-cards"
                  ? plural("sourceCoverage.available", state.totalChunkCount)
                  : plural("sourceCoverage.remaining", state.uncoveredChunkCount)}
              </Text>
            ) : null}
          </>
        )}
      </View>
      <Text style={[typography.caption, text, { color: colors.textSecondary }]}>{t("sourceCoverage.explanation")}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { minHeight: 120 },
  flexible: { flex: 1 },
});
