import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/src/theme";

// Temporary placeholder brand mark for the sign-in screen — a simple monogram, not the final
// Interval logo. Intentionally isolated in its own file so replacing it later is a single,
// obvious swap rather than a hunt through screen markup.
export function BrandMark() {
  const { colors, radii } = useTheme();
  return (
    <View style={[styles.badge, { borderRadius: radii.md, backgroundColor: colors.accentSubtle }]}>
      <Text style={[styles.letter, { color: colors.accent }]}>In</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  letter: { fontSize: 20, fontWeight: "700" },
});
