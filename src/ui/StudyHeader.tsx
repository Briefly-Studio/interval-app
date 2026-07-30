import { StyleSheet, Text, View } from "react-native";

import { useTranslation } from "../i18n";
import { IconButton } from "./IconButton";
import { spacing, typography } from "./theme";

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
  return (
    <View style={styles.row}>
      <IconButton name="close" accessibilityLabel={closeLabel ?? t("common.close")} onPress={onClose} />
      <Text style={[typography.subheading, styles.title]} numberOfLines={1}>
        {title}
      </Text>
      {progressLabel ? <Text style={typography.caption}>{progressLabel}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { flex: 1 },
});
