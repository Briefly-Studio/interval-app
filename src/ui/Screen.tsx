import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useLayoutDirection } from "../i18n/direction";
import { useTheme } from "@/src/theme";

type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
};

// Shared screen chrome: themed background, standard content padding, and keyboard-avoidance
// for forms. Purely presentational — carries no navigation or data logic.
export function Screen({ children, scroll = false, contentStyle }: ScreenProps) {
  const { colors, spacing } = useTheme();
  const { direction } = useLayoutDirection();
  // `flex: 1` on this View is correct (and required) for the non-scroll case — it's what lets a
  // FlatList-containing screen fill remaining space. Inside a ScrollView it's the opposite of
  // correct: it constrains the content to the ScrollView's own (viewport-sized) available space
  // instead of letting it grow to its natural, possibly-taller-than-the-screen content height —
  // the exact bug that made longer forms (e.g. Add/Edit Source Details) unable to scroll to their
  // lower fields and Save button. Only applied when `scroll` is false.
  const content = (
    <View
      style={[
        styles.content,
        !scroll && styles.contentFill,
        { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
        contentStyle,
      ]}
    >
      {children}
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas, direction }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {scroll ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {content}
          </ScrollView>
        ) : (
          content
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: {},
  contentFill: { flex: 1 },
});
