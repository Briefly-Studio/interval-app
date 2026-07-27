import { Pressable, StyleSheet, Text } from "react-native";

import { colors, radii, shadows, spacing, typography } from "./theme";

type FlashcardSurfaceProps = {
  label: string;
  content: string;
  onPress?: () => void;
  hint?: string;
};

// The single flashcard surface shared by front/back state in Review. Tap toggles flip (same
// gesture as before); content wraps naturally for long front/back text.
export function FlashcardSurface({ label, content, onPress, hint }: FlashcardSurfaceProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} of card: ${content}`}
      accessibilityHint={hint}
      style={styles.surface}
    >
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.content}>{content}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  surface: {
    flex: 1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    justifyContent: "center",
    ...shadows.card,
  },
  label: { ...typography.label, marginBottom: spacing.sm },
  content: { ...typography.title, fontSize: 24 },
  hint: { ...typography.caption, marginTop: spacing.lg },
});
