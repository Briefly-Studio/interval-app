// Theme Lab — top-level screen. Dev-only visual exploration; see app/theme-lab.tsx for the
// route-level __DEV__ gate. Nothing on this screen reads or writes AsyncStorage, touches account
// data, or calls AWS — every value shown is a static mock, and switching studies only changes
// local React state for the duration this screen is open.

import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from "react-native";

import { InterfaceStudy } from "./InterfaceStudy";
import { AccentColorFutureConcept, ThemePickerConcept, type AppearanceOption } from "./ThemePicker";
import { DARK_THEME, LIGHT_THEME, THEME_META, THEMES, WARM_THEME, type ThemeId } from "./tokens";

const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

const STUDY_TABS: { id: ThemeId; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "warm", label: "Warm" },
];

export function ThemeLabScreen() {
  const systemScheme = useColorScheme(); // "light" | "dark" | null — real OS signal, read-only
  const [activeStudy, setActiveStudy] = useState<ThemeId | "system">("light");
  const [pickerSelection, setPickerSelection] = useState<AppearanceOption>("light");

  const resolvedSystemTheme: ThemeId = systemScheme === "dark" ? "dark" : "light";
  const displayedTheme = activeStudy === "system" ? resolvedSystemTheme : activeStudy;
  const tokens = THEMES[displayedTheme];
  const meta = THEME_META[displayedTheme];

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.rootContent}>
      <View style={styles.introBlock}>
        <Text style={styles.labTitle}>Theme Lab</Text>
        <Text style={styles.labSubtitle}>
          Visual exploration only — development build, not shipped to users. Nothing here is
          saved, synced, or connected to real account data.
        </Text>
      </View>

      {/* Instant switcher */}
      <View style={styles.switcher}>
        {STUDY_TABS.map((tab) => (
          <SwitcherTab
            key={tab.id}
            label={tab.label}
            active={activeStudy === tab.id}
            onPress={() => setActiveStudy(tab.id)}
          />
        ))}
        <SwitcherTab label="System" active={activeStudy === "system"} onPress={() => setActiveStudy("system")} />
      </View>

      {activeStudy === "system" && (
        <View style={styles.systemNote}>
          <Text style={styles.systemNoteText}>
            This device&apos;s system appearance is currently{" "}
            <Text style={styles.systemNoteStrong}>{systemScheme === "dark" ? "Dark" : "Light"}</Text>. System
            preview resolves to that theme automatically — it is a behavior, not a fifth palette.
            Warm is always a manual choice; it does not resolve from the OS setting.
          </Text>
        </View>
      )}

      {/* Main study for the selected theme */}
      <View style={styles.studyFrame}>
        <InterfaceStudy tokens={tokens} />
      </View>

      {/* Token details for the currently selected theme */}
      <View style={styles.metaSection}>
        <Text style={styles.metaSectionTitle}>{tokens.label} — rationale &amp; notes</Text>
        <MetaList heading="Visual rationale" items={meta.rationale} />
        <MetaList heading="Contrast notes (calculated)" items={meta.contrastNotes} />
        <MetaList heading="Brand-consistency notes" items={meta.brandConsistencyNotes} />
        <MetaList heading="Components needing special treatment" items={meta.specialTreatmentNotes} />
        <TokenSwatchTable tokens={tokens} />
      </View>

      {/* Side-by-side comparison, all three, vertically stacked and scrollable */}
      <View style={styles.compareSection}>
        <Text style={styles.metaSectionTitle}>Compare all three</Text>
        <Text style={styles.comparePrompt}>Screenshot this section to compare Light, Dark, and Warm together.</Text>
        {[LIGHT_THEME, DARK_THEME, WARM_THEME].map((t) => (
          <View key={t.id} style={styles.compareItem}>
            <Text style={styles.compareLabel}>{t.label}</Text>
            <InterfaceStudy tokens={t} />
          </View>
        ))}
      </View>

      {/* Theme picker concept for a future Settings → Appearance screen */}
      <View style={styles.pickerSection}>
        <Text style={styles.metaSectionTitle}>Settings → Appearance (concept)</Text>
        <ThemePickerConcept selected={pickerSelection} onSelect={setPickerSelection} />
        <AccentColorFutureConcept />
      </View>
    </ScrollView>
  );
}

function SwitcherTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.switcherTab, active && styles.switcherTabActive]}
    >
      <Text style={[styles.switcherTabLabel, active && styles.switcherTabLabelActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function MetaList({ heading, items }: { heading: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.metaList}>
      <Text style={styles.metaListHeading}>{heading}</Text>
      {items.map((item, i) => (
        <Text key={i} style={styles.metaListItem}>
          {"• "}
          {item}
        </Text>
      ))}
    </View>
  );
}

const TOKEN_ROWS: { key: keyof typeof LIGHT_THEME; label: string }[] = [
  { key: "canvas", label: "canvas" },
  { key: "surface", label: "surface" },
  { key: "surfaceElevated", label: "surfaceElevated" },
  { key: "surfaceMuted", label: "surfaceMuted" },
  { key: "textPrimary", label: "textPrimary" },
  { key: "textSecondary", label: "textSecondary" },
  { key: "textMuted", label: "textMuted" },
  { key: "border", label: "border" },
  { key: "borderStrong", label: "borderStrong" },
  { key: "accent", label: "accent" },
  { key: "accentPressed", label: "accentPressed" },
  { key: "accentSubtle", label: "accentSubtle" },
  { key: "onAccent", label: "onAccent" },
  { key: "success", label: "success" },
  { key: "successSurface", label: "successSurface" },
  { key: "warning", label: "warning" },
  { key: "warningSurface", label: "warningSurface" },
  { key: "danger", label: "danger" },
  { key: "dangerSurface", label: "dangerSurface" },
  { key: "disabled", label: "disabled" },
];

function TokenSwatchTable({ tokens }: { tokens: (typeof THEMES)[ThemeId] }) {
  return (
    <View style={styles.tokenTable}>
      <Text style={styles.metaListHeading}>Token values</Text>
      {TOKEN_ROWS.map((row) => (
        <View key={row.key} style={styles.tokenRow}>
          <View style={[styles.tokenSwatch, { backgroundColor: String(tokens[row.key]), borderColor: tokens.border }]} />
          <Text style={styles.tokenName} numberOfLines={1}>
            {row.label}
          </Text>
          <Text style={styles.tokenValue} numberOfLines={1}>
            {String(tokens[row.key])}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, width: "100%", backgroundColor: "#F7F8FA" },
  rootContent: {
    width: "100%",
    maxWidth: "100%",
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  introBlock: { gap: 4 },
  labTitle: { fontSize: 26, fontWeight: "700", color: "#1B2430" },
  labSubtitle: { fontSize: 13, color: "#5B6572", lineHeight: 18 },
  switcher: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E1E4E8",
    padding: 4,
    gap: 4,
  },
  switcherTab: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
  },
  switcherTabActive: { backgroundColor: "#1D7B7A" },
  switcherTabLabel: { fontSize: 14, fontWeight: "600", color: "#5B6572" },
  switcherTabLabelActive: { color: "#FFFFFF" },
  systemNote: { backgroundColor: "#E3F3F2", borderRadius: 10, padding: spacing.md },
  systemNoteText: { fontSize: 13, color: "#1B2430", lineHeight: 18 },
  systemNoteStrong: { fontWeight: "700" },
  studyFrame: { borderRadius: 20, overflow: "hidden" },
  metaSection: { gap: spacing.sm },
  metaSectionTitle: { fontSize: 17, fontWeight: "700", color: "#1B2430" },
  metaList: { gap: 2, marginBottom: spacing.xs },
  metaListHeading: { fontSize: 13, fontWeight: "700", color: "#1B2430", marginTop: spacing.xs },
  metaListItem: { fontSize: 12.5, color: "#5B6572", lineHeight: 17 },
  tokenTable: { marginTop: spacing.xs, gap: 4 },
  tokenRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 2 },
  tokenSwatch: { width: 20, height: 20, borderRadius: 5, borderWidth: 1 },
  tokenName: { fontSize: 12, fontWeight: "600", color: "#1B2430", width: 110 },
  tokenValue: { fontSize: 11, color: "#5B6572", fontFamily: "Courier" },
  compareSection: { gap: spacing.md },
  comparePrompt: { fontSize: 12, color: "#5B6572" },
  compareItem: { gap: spacing.xs },
  compareLabel: { fontSize: 14, fontWeight: "700", color: "#1B2430" },
  pickerSection: { gap: spacing.md },
});
