import { StyleSheet, Text, View } from "react-native";

import { colors, radii } from "./theme";

// Temporary placeholder brand mark for the sign-in screen — a simple monogram, not the final
// Interval logo. Intentionally isolated in its own file so replacing it later is a single,
// obvious swap rather than a hunt through screen markup.
export function BrandMark() {
  return (
    <View style={styles.badge}>
      <Text style={styles.letter}>In</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    backgroundColor: colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  letter: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.accentStrong,
  },
});
