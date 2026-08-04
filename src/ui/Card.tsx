import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "@/src/theme";

type CardProps = {
  children: ReactNode;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
};

// Shared surface: themed fill, hairline border, and a barely-there shadow — depth comes mostly
// from tonal contrast against the canvas, not the shadow itself.
export function Card({ children, padded = true, style }: CardProps) {
  const { colors, radii, spacing, shadow } = useTheme();
  return (
    <View
      style={[
        styles.base,
        { backgroundColor: colors.surface, borderRadius: radii.lg, borderColor: colors.border, ...shadow },
        padded && { padding: spacing.lg },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { borderWidth: 1 },
});
