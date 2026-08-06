import { StyleSheet, Text, View } from "react-native";

import { useTranslation } from "../i18n";
import { IconButton } from "./IconButton";
import { useTheme } from "@/src/theme";

type StudyHeaderProps = {
  title: string;
  progressLabel?: string;
  onClose: () => void;
  closeLabel?: string;
};

// Shared header for Review and Quiz — close/back control, deck title, and an optional compact
// progress label ("3 / 20") derived from real state by the caller. Purely presentational.
// closeLabel remains an optional override (API unchanged) — when omitted, it now defaults to the
// localized common.close string instead of a hardcoded English literal.
export function StudyHeader({ title, progressLabel, onClose, closeLabel }: StudyHeaderProps) {
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  return (
    <View style={[styles.row, { gap: spacing.sm }]}>
      <IconButton name="close" accessibilityLabel={closeLabel ?? t("common.close")} onPress={onClose} />
      <Text
        style={[typography.subheading, styles.title, { color: colors.textPrimary }]}
        numberOfLines={1}
        accessibilityRole="header"
      >
        {title}
      </Text>
      {progressLabel ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{progressLabel}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  title: { flex: 1 },
});
