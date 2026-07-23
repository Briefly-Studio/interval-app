import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, radii, shadows, spacing } from "./theme";

type CardProps = {
  children: ReactNode;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
};

// Shared surface: white fill, hairline border, and a barely-there shadow — depth comes mostly
// from tonal contrast against the tinted screen background, not the shadow itself.
export function Card({ children, padded = true, style }: CardProps) {
  return <View style={[styles.base, padded && styles.padded, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  padded: { padding: spacing.lg },
});
