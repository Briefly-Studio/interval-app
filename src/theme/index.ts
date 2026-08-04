import { Appearance } from "react-native";
import { useMemo, useSyncExternalStore } from "react";

import {
  getAppearancePreference,
  setAppearancePreference as persistAppearancePreference,
} from "./appearancePreference";
import { resolveAppearance } from "./resolveAppearance";
import { cardShadow, iconSizes, radii, spacing, THEME_TOKENS, touchTarget, typographySizes } from "./tokens";
import type {
  AppearanceMode,
  IconSizes,
  Radii,
  ResolvedTheme,
  Spacing,
  SystemScheme,
  ThemeTokens,
  TouchTarget,
} from "./types";

export type { AppearanceMode, ResolvedTheme, SystemScheme, ThemeTokens } from "./types";
export { isAppearanceMode, APPEARANCE_MODES } from "./types";
export { LIGHT_TOKENS, DARK_TOKENS, WARM_TOKENS, THEME_TOKENS, typographySizes } from "./tokens";
export { resolveAppearance } from "./resolveAppearance";
export { startupTreatmentFor, startupBridgeFor, type StartupTreatment, type StartupBridge } from "./startupTreatment";
// Re-exported so dev-only tooling (Theme Lab's diagnostics/test actions) can read the raw
// persisted value without importing a sub-path directly — @/src/theme stays the one canonical
// entrypoint for everything this module owns, persistence included.
export { getAppearancePreference } from "./appearancePreference";

// Exactly the contract this batch's report specifies — no extra fields. Diagnostic-only data
// (store revision, last-change reason) is tracked separately below and exposed through its own
// getter, so it can never be mistaken for part of the real production contract every consumer
// relies on.
export type AppearanceState = {
  selectedMode: AppearanceMode;
  systemScheme: SystemScheme;
  resolvedTheme: ResolvedTheme;
  isInitialized: boolean;
};

export type AppearanceChangeReason =
  | "module-init"
  | "initialization"
  | "initialization-backstop"
  | "storage-restore-superseded"
  | "os-appearance-changed"
  | `user-selected-${AppearanceMode}`;

const DEV = typeof __DEV__ !== "undefined" && __DEV__;

function devLog(...args: unknown[]) {
  if (!DEV) return;
  // Concise, removable, never logs secrets/user data — only mode/scheme enum values and counters.
  console.log("[appearance]", ...args);
}

// Appearance.getColorScheme() is typed to allow null/undefined ("unspecified") — normalized the
// same way resolveAppearance() always has, so a null/unspecified reading can never coincidentally
// resolve to Dark.
function normalizeSystemScheme(scheme: ReturnType<typeof Appearance.getColorScheme>): SystemScheme {
  return scheme === "dark" ? "dark" : "light";
}

function computeState(
  selectedMode: AppearanceMode,
  systemScheme: SystemScheme,
  isInitialized: boolean
): AppearanceState {
  return {
    selectedMode,
    systemScheme,
    resolvedTheme: resolveAppearance(selectedMode, systemScheme),
    isInitialized,
  };
}

// ============================================================================
// Canonical appearance store — the ONLY place in this app that reads React Native's Appearance
// module or calls AsyncStorage for the appearance preference. Every consumer (Theme Lab,
// Settings, production screens, app/_layout.tsx, BrandStartup, StatusBar) reads this exact same
// state through useAppearanceState()/useTheme() below, which are both built on
// useSyncExternalStore — React's own supported primitive for exactly this class of problem
// (external mutable state many components need to read reactively), chosen over the previous
// useState+useEffect subscription pattern per this batch's explicit instruction to prefer a
// proven-correct mechanism over a custom one. useSyncExternalStore guarantees every subscribed
// component reads a snapshot that is never torn or stale relative to the store, even under
// concurrent rendering — a guarantee a hand-rolled useState/useEffect pair cannot make.
//
// One immutable snapshot object per real change (never mutated in place — every setState() call
// below produces a brand-new object via computeState()), a stable module-level subscribe()
// function, and a stable getSnapshot() function (see useAppearanceState()).
let state: AppearanceState = computeState("system", normalizeSystemScheme(Appearance.getColorScheme()), false);

// Diagnostic-only — store revision and the human-readable reason for the most recent change.
// Not part of AppearanceState; exposed only for Theme Lab's development diagnostics panel.
let revision = 0;
let lastChangeReason: AppearanceChangeReason = "module-init";

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function setState(
  patch: Partial<Pick<AppearanceState, "selectedMode" | "systemScheme" | "isInitialized">>,
  reason: AppearanceChangeReason
) {
  const next = computeState(
    patch.selectedMode ?? state.selectedMode,
    patch.systemScheme ?? state.systemScheme,
    patch.isInitialized ?? state.isInitialized
  );
  // Skip the notify when nothing actually changed (e.g. an Appearance event firing with the same
  // scheme the store already has) — avoids redundant re-renders across every subscriber. Still
  // logged in dev, so a founder reading Metro logs can see the event was received and ignored,
  // not silently dropped.
  if (
    next.selectedMode === state.selectedMode &&
    next.systemScheme === state.systemScheme &&
    next.isInitialized === state.isInitialized
  ) {
    devLog("no-op:", reason, next);
    return;
  }
  state = next;
  revision += 1;
  lastChangeReason = reason;
  devLog(`rev ${revision} (${reason}):`, next);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): AppearanceState {
  return state;
}

/** Synchronous snapshot of the current canonical state — for non-React call sites (e.g. a fresh
 * re-check right before an irreversible decision, like dismissing the native splash). */
export function getAppearanceState(): AppearanceState {
  return state;
}

/** Diagnostic-only — Theme Lab's debug panel. Not part of the production AppearanceState contract. */
export function getAppearanceDebugInfo(): { revision: number; lastChangeReason: AppearanceChangeReason } {
  return { revision, lastChangeReason };
}

// Subscribed exactly once, ever — this module is only ever evaluated once per JS process, so
// there is no risk of duplicate listeners and nothing to clean up: this listener is meant to live
// for the app's entire process lifetime, the same way the persisted-mode pub/sub below does.
Appearance.addChangeListener(({ colorScheme }) => {
  devLog("OS appearance event:", colorScheme);
  setState({ systemScheme: normalizeSystemScheme(colorScheme) }, "os-appearance-changed");
});

// ---- Persisted selectedMode ----

let initPromise: Promise<void> | null = null;
// Incremented on every explicit user selection. initTheme()'s async completion compares this
// against the value it captured when it started — if a user selection happened in between, the
// (now-stale) persisted read is not allowed to overwrite it. See setAppearanceMode() and
// initTheme() below.
let mutationCount = 0;

// Bounded safety net — getAppearancePreference() itself never throws and normally resolves in a
// few ms (a single AsyncStorage read), so this exists purely to guard against a pathological
// AsyncStorage hang, not an expected error path.
const INIT_BACKSTOP_MS = 800;

/**
 * Resolves the persisted appearance preference and marks canonical state as initialized. Safe to
 * call more than once — concurrent or repeated calls (e.g. Fast Refresh remounting
 * app/_layout.tsx) all share the same in-flight promise rather than issuing redundant AsyncStorage
 * reads or racing each other to set state.
 */
export function initTheme(): Promise<void> {
  if (initPromise) return initPromise;
  devLog("initialization start");

  const mutationCountAtStart = mutationCount;

  const persisted = getAppearancePreference().then((selectedMode) => {
    devLog("stored selectedMode read:", selectedMode);
    // Re-query the live OS scheme here, right before finalizing initialization, rather than
    // trusting only the value this module captured at import time or whatever an Appearance event
    // may or may not have delivered in between.
    const systemScheme = normalizeSystemScheme(Appearance.getColorScheme());
    devLog("OS scheme read:", systemScheme);

    if (mutationCount !== mutationCountAtStart) {
      // The user made an explicit selection while this AsyncStorage read was still in flight —
      // their choice wins. Still refresh systemScheme and isInitialized (both independent of the
      // mode race), just not selectedMode.
      setState({ systemScheme, isInitialized: true }, "storage-restore-superseded");
      return;
    }
    setState({ selectedMode, systemScheme, isInitialized: true }, "initialization");
  });

  initPromise = new Promise<void>((resolve) => {
    const backstop = setTimeout(() => {
      // Explicit, safe fallback: resolve to System (using whatever systemScheme the module-level
      // Appearance listener above already knows) rather than leaving the native splash up
      // forever on a pathological AsyncStorage hang. This does not abandon the real read above —
      // `persisted` keeps running in the background, and if it eventually completes, its own
      // setState call still fires (subject to the same mutation-count guard) and self-corrects
      // the app to the user's actual saved preference, even though initPromise already resolved.
      if (mutationCount === mutationCountAtStart) {
        devLog("initialization backstop fired — falling back to system");
        setState({ selectedMode: "system", isInitialized: true }, "initialization-backstop");
      } else {
        devLog("initialization backstop fired — user already selected a mode, marking initialized only");
        setState({ isInitialized: true }, "initialization-backstop");
      }
      resolve();
    }, INIT_BACKSTOP_MS);

    persisted.finally(() => {
      clearTimeout(backstop);
      resolve();
    });
  });

  return initPromise;
}

export async function setAppearanceMode(next: AppearanceMode): Promise<void> {
  mutationCount += 1;
  devLog("user selected:", next);
  setState({ selectedMode: next }, `user-selected-${next}`);
  await persistAppearancePreference(next);
}

export type UseThemeResult = {
  selectedMode: AppearanceMode;
  systemScheme: SystemScheme;
  resolvedTheme: ResolvedTheme;
  isInitialized: boolean;
  colors: ThemeTokens;
  spacing: Spacing;
  radii: Radii;
  iconSizes: IconSizes;
  touchTarget: TouchTarget;
  typography: typeof typographySizes;
  shadow: object;
  setAppearanceMode: typeof setAppearanceMode;
};

/** Canonical React subscription — every hook in this file (and every component) that needs live
 * appearance state ultimately goes through this one useSyncExternalStore call. subscribe and
 * getSnapshot are both stable module-level functions (not recreated per render), as
 * useSyncExternalStore requires for correctness. */
export function useAppearanceState(): AppearanceState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useTheme(): UseThemeResult {
  const { selectedMode, systemScheme, resolvedTheme, isInitialized } = useAppearanceState();
  const tokens = THEME_TOKENS[resolvedTheme];

  return useMemo(
    () => ({
      selectedMode,
      systemScheme,
      resolvedTheme,
      isInitialized,
      colors: tokens,
      spacing,
      radii,
      iconSizes,
      touchTarget,
      typography: typographySizes,
      shadow: cardShadow(tokens.shadowColor),
      setAppearanceMode,
    }),
    [selectedMode, systemScheme, resolvedTheme, isInitialized, tokens]
  );
}
