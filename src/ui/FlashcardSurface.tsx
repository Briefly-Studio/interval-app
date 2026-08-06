import { Pressable, StyleSheet, Text } from "react-native";

import { useTranslation } from "../i18n";
import { useTheme } from "@/src/theme";

type FlashcardSurfaceProps = {
  label: string;
  content: string;
  onPress?: () => void;
  hint?: string;
};

// The single flashcard surface shared by front/back state in Review. Tap toggles flip (same
// gesture as before); content wraps naturally for long front/back text. accessibilityLabel is
// built from a single localized template (review.cardContentLabel) rather than English glue text
// spliced around the already-translated `label` — the previous "${label} of card: ${content}"
// form meant Spanish users heard "Frente of card: ..." (a genuine mixed-language announcement).
export function FlashcardSurface({ label, content, onPress, hint }: FlashcardSurfaceProps) {
  const { t } = useTranslation();
  const { colors, radii, spacing, typography, shadow } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("review.cardContentLabel", { label, content })}
      accessibilityHint={hint}
      style={[
        styles.surface,
        { borderRadius: radii.lg, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.xl, ...shadow },
      ]}
    >
      <Text style={[typography.label, styles.label, { color: colors.textSecondary, marginBottom: spacing.sm }]}>{label}</Text>
      <Text style={[typography.title, styles.content, { color: colors.textPrimary }]}>{content}</Text>
      {hint ? (
        <Text style={[typography.caption, styles.hint, { color: colors.textSecondary, marginTop: spacing.lg }]}>{hint}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  surface: { flex: 1, borderWidth: 1, justifyContent: "center" },
  label: {},
  content: { fontSize: 24 },
  hint: {},
});
