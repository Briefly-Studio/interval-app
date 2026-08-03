// Theme Lab — self-contained preview primitives.
//
// These deliberately mirror the visual language of the real src/ui/ components (Button, Card,
// ProgressBar, IconButton) but take a `tokens: ThemeTokens` prop instead of importing the fixed
// production theme.ts — production's shared components have zero indirection for color (they
// import colors/spacing/etc. directly), so they cannot render more than one palette. Rebuilding
// small preview-only equivalents here is what keeps this lab fully isolated: nothing in
// src/ui/ is imported, changed, or at risk from this exploration.

import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import type { ThemeTokens } from "./tokens";

const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
const radii = { sm: 8, md: 12, lg: 16, pill: 999 };
export const touchTargetMin = 44;

export function PreviewCard({
  tokens,
  children,
  elevated = false,
  style,
}: {
  tokens: ThemeTokens;
  children: ReactNode;
  elevated?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: elevated ? tokens.surfaceElevated : tokens.surface,
          borderColor: tokens.border,
          shadowColor: tokens.shadowColor,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

type PreviewButtonVariant = "primary" | "secondary" | "danger";

export function PreviewButton({
  tokens,
  label,
  variant = "primary",
  disabled = false,
  selected = false,
  onPress,
}: {
  tokens: ThemeTokens;
  label: string;
  variant?: PreviewButtonVariant;
  disabled?: boolean;
  selected?: boolean;
  onPress?: () => void;
}) {
  const bg =
    variant === "primary"
      ? tokens.accent
      : variant === "danger"
        ? tokens.danger
        : tokens.surface;
  const textColor =
    variant === "primary" ? tokens.onAccent : variant === "danger" ? tokens.onAccent : tokens.textPrimary;
  const borderColor = variant === "secondary" ? tokens.border : "transparent";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      style={[
        styles.button,
        { backgroundColor: bg, borderColor, borderWidth: variant === "secondary" ? 1 : 0 },
        disabled && styles.disabledOpacity,
        selected && { borderWidth: 2, borderColor: tokens.textPrimary },
      ]}
    >
      <Text style={[styles.buttonLabel, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

export function PreviewProgressBar({ tokens, progress }: { tokens: ThemeTokens; progress: number }) {
  const pct = Math.min(1, Math.max(0, progress));
  return (
    <View
      style={[styles.progressTrack, { backgroundColor: tokens.surfaceMuted }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
    >
      <View style={[styles.progressFill, { width: `${pct * 100}%`, backgroundColor: tokens.accent }]} />
    </View>
  );
}

type ChipTone = "neutral" | "success" | "warning" | "danger" | "accent";

export function PreviewChip({
  tokens,
  label,
  tone = "neutral",
  selected = false,
  onPress,
}: {
  tokens: ThemeTokens;
  label: string;
  tone?: ChipTone;
  selected?: boolean;
  onPress?: () => void;
}) {
  const toneMap: Record<ChipTone, { bg: string; fg: string; border: string }> = {
    neutral: { bg: tokens.surfaceMuted, fg: tokens.textSecondary, border: tokens.border },
    success: { bg: tokens.successSurface, fg: tokens.success, border: tokens.successSurface },
    warning: { bg: tokens.warningSurface, fg: tokens.warning, border: tokens.warningSurface },
    danger: { bg: tokens.dangerSurface, fg: tokens.danger, border: tokens.dangerSurface },
    accent: { bg: tokens.accentSubtle, fg: tokens.accent, border: tokens.accentSubtle },
  };
  const t = toneMap[tone];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={label}
      accessibilityState={onPress ? { selected } : undefined}
      style={[
        styles.chip,
        { backgroundColor: t.bg, borderColor: selected ? tokens.textPrimary : t.border },
        selected && { borderWidth: 1.5 },
      ]}
    >
      {selected && <Ionicons name="checkmark" size={13} color={t.fg} style={{ marginRight: 3 }} />}
      <Text style={[styles.chipLabel, { color: t.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function PreviewDivider({ tokens }: { tokens: ThemeTokens }) {
  return <View style={[styles.divider, { backgroundColor: tokens.border }]} />;
}

export function PreviewBadge({
  tokens,
  label,
  tone,
}: {
  tokens: ThemeTokens;
  label: string;
  tone: "success" | "warning" | "danger";
}) {
  const map = {
    success: { bg: tokens.successSurface, fg: tokens.success, icon: "checkmark-circle" as const },
    warning: { bg: tokens.warningSurface, fg: tokens.warning, icon: "alert-circle" as const },
    danger: { bg: tokens.dangerSurface, fg: tokens.danger, icon: "close-circle" as const },
  };
  const m = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: m.bg }]}>
      <Ionicons name={m.icon} size={14} color={m.fg} />
      <Text style={[styles.badgeLabel, { color: m.fg }]}>{label}</Text>
    </View>
  );
}

export function PreviewTextInput({
  tokens,
  placeholder,
  focused = false,
}: {
  tokens: ThemeTokens;
  placeholder: string;
  focused?: boolean;
}) {
  return (
    <View
      style={[
        styles.input,
        {
          backgroundColor: tokens.surface,
          borderColor: focused ? tokens.accent : tokens.border,
          borderWidth: focused ? 2 : 1,
        },
      ]}
    >
      <Ionicons name="search" size={16} color={tokens.textMuted} />
      <Text style={[styles.inputText, { color: tokens.textMuted }]}>{placeholder}</Text>
    </View>
  );
}

export function PreviewTabBar({
  tokens,
  activeIndex,
}: {
  tokens: ThemeTokens;
  activeIndex: number;
}) {
  const tabs: { icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
    { icon: "home", label: "Home" },
    { icon: "school", label: "Study" },
    { icon: "settings", label: "Settings" },
  ];
  return (
    <View style={[styles.tabBar, { backgroundColor: tokens.surfaceElevated, borderTopColor: tokens.border }]}>
      {tabs.map((tab, i) => {
        const active = i === activeIndex;
        return (
          <View key={tab.label} style={styles.tabItem} accessibilityState={{ selected: active }}>
            <Ionicons name={tab.icon} size={20} color={active ? tokens.accent : tokens.textMuted} />
            <Text style={[styles.tabLabel, { color: active ? tokens.accent : tokens.textMuted }]}>{tab.label}</Text>
            {active && <View style={[styles.tabIndicator, { backgroundColor: tokens.accent }]} />}
          </View>
        );
      })}
    </View>
  );
}

export function PreviewModal({ tokens, title, body }: { tokens: ThemeTokens; title: string; body: string }) {
  return (
    <View style={[styles.modalScrim, { backgroundColor: tokens.overlay }]}>
      <View style={[styles.modalCard, { backgroundColor: tokens.surfaceElevated, shadowColor: tokens.shadowColor }]}>
        <Text style={[styles.modalTitle, { color: tokens.textPrimary }]}>{title}</Text>
        <Text style={[styles.modalBody, { color: tokens.textSecondary }]}>{body}</Text>
        <View style={styles.modalActions}>
          <PreviewButton tokens={tokens} label="Cancel" variant="secondary" />
          <PreviewButton tokens={tokens} label="Confirm" variant="primary" />
        </View>
      </View>
    </View>
  );
}

export function PreviewEmptyState({ tokens, message }: { tokens: ThemeTokens; message: string }) {
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIconWrap, { backgroundColor: tokens.accentSubtle }]}>
        <Ionicons name="albums-outline" size={22} color={tokens.accent} />
      </View>
      <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.lg,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  button: {
    minHeight: touchTargetMin,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  buttonLabel: { fontSize: 15, fontWeight: "600" },
  disabledOpacity: { opacity: 0.45 },
  progressTrack: { height: 6, borderRadius: radii.pill, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: radii.pill },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  chipLabel: { fontSize: 13, fontWeight: "600" },
  divider: { height: StyleSheet.hairlineWidth * 2, width: "100%" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  badgeLabel: { fontSize: 12, fontWeight: "600" },
  input: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: touchTargetMin,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  inputText: { fontSize: 14 },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderRadius: radii.md,
  },
  tabItem: { flex: 1, alignItems: "center", gap: 2 },
  tabLabel: { fontSize: 11, fontWeight: "600" },
  tabIndicator: { position: "absolute", top: -8, width: 18, height: 2, borderRadius: 1 },
  modalScrim: {
    borderRadius: radii.lg,
    padding: spacing.xl,
    alignItems: "center",
  },
  modalCard: {
    width: "100%",
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  modalTitle: { fontSize: 17, fontWeight: "700" },
  modalBody: { fontSize: 13, lineHeight: 18 },
  modalActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  emptyState: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg },
  emptyIconWrap: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: { fontSize: 13, textAlign: "center" },
});
