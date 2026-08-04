import { Pressable, StyleSheet, Text } from "react-native";

import { useTheme } from "@/src/theme";

type FlashcardSurfaceProps = {
  label: string;
  content: string;
  onPress?: () => void;
  hint?: string;
};

// The single flashcard surface shared by front/back state in Review. Tap toggles flip (same
// gesture as before); content wraps naturally for long front/back text.
export function FlashcardSurface({ label, content, onPress, hint }: FlashcardSurfaceProps) {
  const { colors, radii, spacing, typography, shadow } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} of card: ${content}`}
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
