import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemeLabScreen } from "../src/devTools/themeLab/ThemeLabScreen";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";
import { spacing, typography } from "../src/ui/theme";

// Development-only route, following the same __DEV__ gate already used by app/dev-tools.tsx.
// Reached from Developer tools → Theme Lab, not from any ordinary user-facing navigation. Renders
// a fully isolated, self-contained visual exploration (src/devTools/themeLab/) — no production
// screen, component, or token file is imported, changed, or affected by this route existing.
export default function ThemeLabRoute() {
  const router = useRouter();

  if (!__DEV__) {
    return (
      <Screen>
        <View style={styles.header}>
          <IconButton name="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
          <Text style={typography.title}>Theme Lab</Text>
        </View>
        <Text style={typography.secondary}>This screen is only available in development.</Text>
      </Screen>
    );
  }

  return (
    // SafeAreaView (not the shared Screen component) so the safe-area top inset pushes this
    // screen's own back-arrow/title header below the status bar / Dynamic Island — Screen's own
    // content wrapper adds its own horizontal padding + gap around all of its children, which
    // would stack with ThemeLabScreen's already-padded internal ScrollView and shift the visual
    // layout the founder already reviewed. `edges={["top"]}` only, since the reported defect was
    // specifically the top overlap — bottom-edge spacing is already handled inside
    // ThemeLabScreen's own ScrollView content padding and wasn't part of the reported issue.
    <SafeAreaView style={styles.flex} edges={["top"]}>
      <View style={styles.header}>
        <IconButton name="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <Text style={typography.title}>Theme Lab</Text>
      </View>
      <ThemeLabScreen />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#F7F8FA" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
});
