// Theme Lab — top-level screen. Dev-only visual exploration; see app/theme-lab.tsx for the
// route-level isDevToolsEnabled() gate (src/config/devToolsCapability.ts). Nothing on this
// screen reads or writes AsyncStorage, touches account
// data, or calls AWS — every value shown is a static mock, and switching studies only changes
// local React state for the duration this screen is open.

import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  getAppearanceDebugInfo,
  getAppearancePreference,
  getAppearanceState,
  setAppearanceMode,
  startupTreatmentFor,
  useAppearanceState,
  type AppearanceMode,
} from "@/src/theme";
import { InterfaceStudy } from "./InterfaceStudy";
import { AccentColorFutureConcept, ThemePickerConcept, type AppearanceOption } from "./ThemePicker";
import { DARK_THEME, LIGHT_THEME, THEME_META, THEMES, WARM_THEME, type ThemeId } from "./tokens";

// The four buttons in "Production controls" below call this — a real ThemeId/"system" study
// selection maps 1:1 onto AppearanceMode, so no separate mapping table is needed.
function toAppearanceMode(study: ThemeId | "system"): AppearanceMode {
  return study;
}

const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

const STUDY_TABS: { id: ThemeId; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "warm", label: "Warm" },
];

export function ThemeLabScreen() {
  // Canonical appearance state (src/theme/index.ts) — the SAME store production, Settings, and
  // app/_layout.tsx/BrandStartup all read. This screen previously called useColorScheme()
  // independently for its own "system" comparison note — a second, unrelated subscription that
  // could never be PROVEN to agree with production's own reading, even though both happened to be
  // reactive once mounted. That split-source-of-truth pattern is exactly what this batch's report
  // identifies as the underlying architectural risk behind the confirmed founder bug (Theme Lab
  // showed Light; a subsequent cold launch's startup treatment still chose Dark) — reading through
  // this one shared hook instead makes that class of disagreement structurally impossible, not
  // just coincidentally avoided.
  const appearance = useAppearanceState();
  // PREVIEW-ONLY local state — this is exactly the state a founder can easily mistake for
  // production, which is what caused the earlier confusion (Theme Lab visibly changing while the
  // real app stayed Dark). Neither of these ever calls setAppearanceMode() or touches
  // AsyncStorage; they only change what THIS screen renders below. See "Production controls"
  // further down for the real, canonical action.
  const [activeStudy, setActiveStudy] = useState<ThemeId | "system">("light");
  const [pickerSelection, setPickerSelection] = useState<AppearanceOption>("light");
  const [applyBusy, setApplyBusy] = useState<AppearanceMode | null>(null);

  const resolvedSystemTheme: ThemeId = appearance.systemScheme === "dark" ? "dark" : "light";
  const displayedTheme = activeStudy === "system" ? resolvedSystemTheme : activeStudy;
  const tokens = THEMES[displayedTheme];
  const meta = THEME_META[displayedTheme];

  const applyToProduction = async (mode: AppearanceMode) => {
    if (applyBusy) return;
    setApplyBusy(mode);
    try {
      await setAppearanceMode(mode);
    } finally {
      setApplyBusy(null);
    }
  };

  const printCanonicalState = () => {
    const snapshot = getAppearanceState();
    const debug = getAppearanceDebugInfo();
    // Logged to Metro (the primary, fully-detailed record) and also surfaced in a brief on-device
    // Alert, so this is usable both with and without a connected debugger/log viewer.
    console.log("[theme-lab] canonical state:", snapshot, debug);
    Alert.alert(
      "Printed canonical state",
      `${JSON.stringify(snapshot)}\nrev ${debug.revision} (${debug.lastChangeReason})\nSee Metro logs for the full object.`
    );
  };

  const printPersistedPreference = async () => {
    const stored = await getAppearancePreference();
    console.log("[theme-lab] persisted selectedMode:", stored);
    Alert.alert("Persisted selectedMode", stored);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.rootContent}>
      <View style={styles.introBlock}>
        <Text style={styles.labTitle}>Theme Lab</Text>
        <Text style={styles.labSubtitle}>
          Visual exploration only — development build, not shipped to users. Nothing below the
          &quot;Production controls&quot; section ever saves, syncs, or touches real account data.
        </Text>
      </View>

      {/* Development-only diagnostics — read directly from the canonical appearance store, not
          recomputed or duplicated here, so this can never drift from what production actually
          uses. Restrained: plain monospace key/value rows, no separate visual language from the
          rest of this screen. Environment-gated at the route level (app/theme-lab.tsx's
          isDevToolsEnabled() check, src/config/devToolsCapability.ts) already, so this never
          ships to Staging or Production regardless. */}
      <View style={styles.diagnosticsBlock}>
        <Text style={styles.diagnosticsTitle}>Production appearance state (live, canonical)</Text>
        <DiagnosticRow label="selectedMode" value={appearance.selectedMode} />
        <DiagnosticRow label="systemScheme" value={appearance.systemScheme} />
        <DiagnosticRow label="resolvedTheme" value={appearance.resolvedTheme} />
        <DiagnosticRow label="isInitialized" value={String(appearance.isInitialized)} />
        <DiagnosticRow label="startupTreatment" value={startupTreatmentFor(appearance.resolvedTheme)} />
        <DiagnosticRow label="storeRevision" value={String(getAppearanceDebugInfo().revision)} />
        <DiagnosticRow label="lastChangeReason" value={getAppearanceDebugInfo().lastChangeReason} />
        <View style={styles.diagnosticsDivider} />
        <DiagnosticRow label="preview mode (this screen only)" value={activeStudy} />
      </View>

      {/* Instant switcher — PREVIEW ONLY. Renamed and re-bannered from the original "Instant
          switcher" specifically because founder testing proved the previous, more neutral label
          read as if it controlled the real app. It does not: it only changes activeStudy above,
          which only affects what this screen itself renders. */}
      <View style={styles.previewBanner}>
        <Text style={styles.previewBannerText}>PREVIEW ONLY — does not change the production app</Text>
      </View>
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
            <Text style={styles.systemNoteStrong}>{appearance.systemScheme === "dark" ? "Dark" : "Light"}</Text>. System
            preview resolves to that theme automatically — it is a behavior, not a fifth palette.
            Warm is always a manual choice; it does not resolve from the OS setting.
          </Text>
        </View>
      )}

      <Pressable
        onPress={() => applyToProduction(toAppearanceMode(activeStudy))}
        disabled={applyBusy !== null}
        accessibilityRole="button"
        style={styles.applyBar}
      >
        <Text style={styles.applyBarText}>
          {applyBusy === toAppearanceMode(activeStudy)
            ? "Applying…"
            : `Apply "${activeStudy === "system" ? "System" : STUDY_TABS.find((t) => t.id === activeStudy)?.label}" to production app →`}
        </Text>
      </Pressable>

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

      {/* Real, canonical production controls — the ONLY controls on this whole screen that call
          the real setAppearanceMode(). Exists so the founder (or anyone) can prove the pipeline
          end-to-end without leaving Theme Lab: tap a button here, and the actual running app
          (visible immediately behind/after this screen) must change. If it doesn't, that is a
          real, reproducible bug report, not a guess about what Theme Lab's preview controls do. */}
      <View style={styles.productionSection}>
        <Text style={styles.metaSectionTitle}>Production controls (dev-only)</Text>
        <Text style={styles.productionSectionBody}>
          These buttons call the real setAppearanceMode() — the same function Settings → Appearance
          uses. Unlike everything above, they DO change the production app.
        </Text>
        <View style={styles.productionButtonRow}>
          {(["system", "light", "dark", "warm"] as const).map((mode) => (
            <Pressable
              key={mode}
              onPress={() => applyToProduction(mode)}
              disabled={applyBusy !== null}
              accessibilityRole="button"
              accessibilityState={{ selected: appearance.selectedMode === mode, disabled: applyBusy !== null }}
              style={[styles.productionButton, appearance.selectedMode === mode && styles.productionButtonActive]}
            >
              <Text
                style={[styles.productionButtonText, appearance.selectedMode === mode && styles.productionButtonTextActive]}
              >
                {applyBusy === mode ? "Applying…" : `Apply ${mode}`}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.productionButtonRow}>
          <Pressable onPress={printCanonicalState} accessibilityRole="button" style={styles.utilityButton}>
            <Text style={styles.utilityButtonText}>Print canonical state</Text>
          </Pressable>
          <Pressable onPress={printPersistedPreference} accessibilityRole="button" style={styles.utilityButton}>
            <Text style={styles.utilityButtonText}>Print persisted preference</Text>
          </Pressable>
        </View>
      </View>

      {/* Theme picker concept for a POSSIBLE future redesign of the Settings → Appearance screen —
          a different visual layout than the one actually shipped (app/appearance.tsx). Selecting
          an option here changes ONLY pickerSelection above; it is not wired to setAppearanceMode
          and never will be without a deliberate redesign decision, since its whole purpose is to
          preview an alternative that isn't live yet. */}
      <View style={styles.pickerSection}>
        <View style={styles.previewBanner}>
          <Text style={styles.previewBannerText}>
            DESIGN CONCEPT ONLY — not the real Settings screen, does not affect production. The
            real screen is Settings → Appearance (app/appearance.tsx).
          </Text>
        </View>
        <Text style={styles.metaSectionTitle}>Settings → Appearance (redesign concept)</Text>
        <ThemePickerConcept selected={pickerSelection} onSelect={setPickerSelection} />
        <AccentColorFutureConcept />
      </View>
    </ScrollView>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.diagnosticsRow}>
      <Text style={styles.diagnosticsLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.diagnosticsValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
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
  diagnosticsBlock: {
    backgroundColor: "#101418",
    borderRadius: 10,
    padding: spacing.sm,
    gap: 2,
  },
  diagnosticsTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: "#8FE0D8",
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  diagnosticsRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  diagnosticsLabel: { fontSize: 11, color: "#9AA5AD", fontFamily: "Courier" },
  diagnosticsValue: { fontSize: 11, color: "#FAFAF8", fontFamily: "Courier", fontWeight: "700" },
  diagnosticsDivider: { height: 1, backgroundColor: "#2A3138", marginVertical: 4 },
  labTitle: { fontSize: 26, fontWeight: "700", color: "#1B2430" },
  labSubtitle: { fontSize: 13, color: "#5B6572", lineHeight: 18 },
  previewBanner: {
    backgroundColor: "#3A1F1E",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
  previewBannerText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#E67C73",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  applyBar: {
    backgroundColor: "#1D7B7A",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  applyBarText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
  productionSection: {
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: "#1D7B7A",
    borderRadius: 14,
    padding: spacing.md,
    backgroundColor: "#FFFFFF",
  },
  productionSectionBody: { fontSize: 12.5, color: "#5B6572", lineHeight: 17 },
  productionButtonRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  productionButton: {
    flexGrow: 1,
    minWidth: 90,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "#1D7B7A",
    paddingVertical: 10,
    alignItems: "center",
  },
  productionButtonActive: { backgroundColor: "#1D7B7A" },
  productionButtonText: { fontSize: 13, fontWeight: "700", color: "#1D7B7A" },
  productionButtonTextActive: { color: "#FFFFFF" },
  utilityButton: {
    flexGrow: 1,
    minWidth: 90,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E1E4E8",
    paddingVertical: 8,
    alignItems: "center",
  },
  utilityButtonText: { fontSize: 12, fontWeight: "600", color: "#5B6572" },
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
