import * as Linking from "expo-linking";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Platform, StyleSheet, Text, View } from "react-native";

import { initAccessibilityPreferences } from "../src/accessibility/accessibilityPreferences";
import { onWorkspaceChanged } from "../src/auth/authSignal";
import { getSyncDiagnosticCode } from "../src/cloud/sync/http";
import { SyncService } from "../src/cloud/sync/SyncService";
import { getSyncState } from "../src/cloud/sync/syncState";
import { initSyncState } from "../src/cloud/sync/useSyncState";
import { handleIncomingFile } from "../src/domain/openFileHandler";
import { initI18n, useTranslation } from "../src/i18n";
import { initTheme, useTheme } from "@/src/theme";
import { BrandStartup } from "../src/ui/BrandStartup";
import { EmptyState } from "../src/ui/EmptyState";
import { Screen } from "../src/ui/Screen";

// Interval V3 beta is iOS-first (Android buildable/core-flow compatible; full authenticated web
// support is explicitly out of scope — see docs/platform-scope.md). expo-secure-store's web
// target has no real implementation (see src/storage/secureStore.ts), so rather than let web
// silently degrade into an unauthenticated, never-tested-on-web experience, the entire app is
// gated behind a single honest "not available on web yet" screen below, before any route ever
// mounts. src/storage/secureStore.ts is still platform-safe independently of this gate (defense
// in depth), but this is what actually keeps web users from wandering into an experience nobody
// has verified.
const IS_WEB = Platform.OS === "web";

// Held here (module scope, not inside the component) so it runs as early as possible — before
// the native splash would otherwise auto-hide on its own default timing. Failure is expected and
// safe to ignore (e.g. Fast Refresh calling this again after the splash already hid).
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function Layout() {
  const router = useRouter();
  const { t } = useTranslation();
  // isInitialized comes straight from the canonical appearance store (src/theme/index.ts) — not
  // a locally-duplicated readiness flag. It only becomes true once BOTH the persisted
  // selectedMode has been read AND a fresh systemScheme has been confirmed (with an explicit,
  // safe, self-healing System fallback if AsyncStorage hangs — see initTheme()'s own doc comment).
  // BrandStartup is gated on this exact flag below, and derives its OWN treatment from this same
  // canonical resolvedTheme internally, rather than receiving one computed here and handed down
  // as a prop — see this batch's report, Phase B/E, for why a value frozen at the moment a parent
  // decides to mount a child is exactly the kind of staleness that produced the confirmed bug.
  const { colors, resolvedTheme, isInitialized } = useTheme();
  const [importing, setImporting] = useState(false);
  const [showBrandStartup, setShowBrandStartup] = useState(true);
  const didSyncRef = useRef(false);

  useEffect(() => {
    initTheme();
  }, []);

  // The native splash is hidden only from BrandStartup's onReady callback — never from a bare
  // mount effect. A previous cut called SplashScreen.hideAsync() as soon as this component's own
  // render committed, a JS-side signal only that doesn't guarantee the native UI thread has
  // actually painted anything yet; a later cut trusted onLayout alone, which confirms the Yoga
  // layout pass completed but not that the compositor has actually painted that (already-opaque)
  // frame to the screen — layout-computed and paint-committed are two different pipeline stages.
  // BrandStartup now waits for onLayout AND two subsequent requestAnimationFrame ticks before
  // firing onReady, closing that gap deterministically (frame-synchronized, not a magic delay) —
  // see BrandStartup.tsx's handleLayout/handleLayoutConfirmed and this batch's report for the
  // full trace of the founder-observed decks-screen blink this closes. This intentionally does
  // not wait on i18n, sync, or auth — see BrandStartup.tsx and this batch's handoff notes for why
  // tying startup branding to network/auth readiness is out of scope here. BrandStartup owns its
  // own full motion sequence and timing (including the reduced-motion variant and stuck-overlay
  // backstops).
  const hideNativeSplash = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  const extractFileUri = (url: string): string | null => {
    const decoded = decodeURIComponent(url);
    if (decoded.startsWith("file://")) return decoded;
    const fileMatch = decoded.match(/file:\/\/[^ ]+/);
    if (fileMatch) return fileMatch[0];
    if (decoded.startsWith("Interval://")) {
      const path = decoded.replace(/^Interval:\/\//, "");
      if (path.startsWith("file://")) return path;
      if (path.startsWith("/")) return `file://${path}`;
    }
    return null;
  };

  const handleUrl = useCallback(
    async (url: string | null) => {
      if (!url) return;
      const fileUri = extractFileUri(url);
      if (!fileUri) return;
      setImporting(true);
      try {
        const newDeckId = await handleIncomingFile(fileUri, t);
        router.replace(`/deck/${newDeckId}`);
      } catch (error) {
        Alert.alert(
          t("importDeck.failedTitle"),
          error instanceof Error ? error.message : t("importDeck.errors.invalidDeckFile")
        );
      } finally {
        setImporting(false);
      }
    },
    [router, t]
  );

  // Fire-and-forget: English is already the correct in-memory default before this resolves (see
  // src/i18n/index.ts), so there is nothing to gate startup on — this just reconciles the stored
  // preference (which may resolve to Spanish or any other enabled locale) for the Settings/
  // Language UI and every t()/plural() call made before this completes.
  useEffect(() => {
    initI18n();
  }, []);

  // One-time startup wiring for the real sync-state model (NetInfo subscription + workspace-
  // switch reset) — same fire-and-forget, call-once pattern as initI18n() above. See
  // src/cloud/sync/useSyncState.ts for what this actually sets up.
  useEffect(() => {
    initSyncState();
  }, []);

  // Same fire-and-forget, call-once pattern — the in-memory defaults (speech on, standard rate,
  // no motion override) are already correct before this resolves, so nothing needs to gate on it.
  useEffect(() => {
    initAccessibilityPreferences();
  }, []);

  // File-open (deep-link) handling is a native-only concept (file:// URIs from the OS's "Open
  // with Interval" flow) — meaningless on web, and skipped there rather than left to silently
  // no-op through handleUrl's own guards, since web never renders anything that would care.
  useEffect(() => {
    if (IS_WEB) return;
    Linking.getInitialURL().then((url) => {
      handleUrl(url);
    });
    const sub = Linking.addEventListener("url", ({ url }) => {
      handleUrl(url);
    });
    return () => sub.remove();
  }, [handleUrl]);

  // Sync is never attempted on web this beta — the entire app is gated behind the web-unsupported
  // screen below before a user could ever reach a signed-in, syncable state, so there is nothing
  // productive for these effects to do. Guarded explicitly (rather than relying solely on the
  // render-level gate) so this stays correct even if the gate is ever bypassed for testing.
  useEffect(() => {
    if (IS_WEB) return;
    if (importing) return;
    if (didSyncRef.current) return;
    didSyncRef.current = true;
    SyncService.syncOnce().catch((e) => {
      // Ordinary offline failures are already reflected in the centralized sync state and
      // must never surface a visible error notification here — only genuinely actionable
      // (needsAttention) failures do.
      if (getSyncState().status === "needsAttention") {
        console.error("SYNC FAILED:", getSyncDiagnosticCode(e));
      }
    });
  }, [importing]);

  // Sign-in and account switches must trigger a fresh sync of the newly active workspace,
  // not just the one-shot sync above that only fires on cold launch. Guest transitions are
  // safe to pass through unconditionally — SyncService itself no-ops without a cloud identity.
  useEffect(() => {
    if (IS_WEB) return;
    const unsub = onWorkspaceChanged((scope) => {
      if (scope.kind === "user") {
        SyncService.syncOnce().catch((e) => {
          // Ordinary offline failures are already reflected in the centralized sync state and
          // must never surface a visible error notification here — only genuinely actionable
          // (needsAttention) failures do.
          if (getSyncState().status === "needsAttention") {
            console.error("SYNC FAILED:", getSyncDiagnosticCode(e));
          }
        });
      }
    });
    return unsub;
  }, []);

  // On native, the splash is hidden only from BrandStartup's onReady callback (see the comment
  // above hideNativeSplash). BrandStartup is never mounted on web (see the render below), so
  // nothing else would ever call hideNativeSplash there — this is web's only trigger for it, and
  // fires as soon as the same isInitialized signal BrandStartup itself waits for is ready.
  useEffect(() => {
    if (!IS_WEB || !isInitialized) return;
    hideNativeSplash();
  }, [isInitialized, hideNativeSplash]);

  // Web gate: no Stack, no routes, no BrandStartup, no auth/sync — just an honest, themed,
  // localized message once the theme is ready (isInitialized), and nothing (the browser's own
  // static page shell) before that brief window closes. See docs/platform-scope.md for the V3
  // beta platform-support decision this implements.
  if (IS_WEB) {
    return (
      <View style={[styles.container, { backgroundColor: colors.canvas }]}>
        <StatusBar style={resolvedTheme === "dark" ? "light" : "dark"} />
        {isInitialized && (
          <Screen>
            <View style={styles.webUnsupportedFill}>
              <EmptyState
                icon="desktop-outline"
                title={t("webUnsupported.title")}
                description={t("webUnsupported.description")}
              />
            </View>
          </Screen>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.canvas }]}>
      {/* Status-bar icon style must match the resolved theme, not just the OS setting — a user
          with an explicit Dark/Warm choice that differs from system appearance still needs
          correctly-colored icons, so this reads resolvedTheme (already system-resolved when the
          mode is "system"), never "auto" (which would only ever look at the OS, ignoring an
          explicit override). Dark theme's canvas is dark -> light icons; Light/Warm canvases are
          light -> dark icons. Rendered above BrandStartup in the tree but painted by the OS as a
          logically separate layer either way — see BrandStartup.tsx for how its own startup-time
          treatment is kept deliberately in sync with this exact same resolvedTheme so the two
          never visibly disagree. */}
      <StatusBar style={resolvedTheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: colors.canvas,
          },
        }}
      >
        {/* The transition is a brief, auto-advancing screen with no manual escape hatch by
            design (it never traps — see runSignInTransition's bounded timeout) — disabling the
            swipe gesture here specifically avoids an accidental early interrupt mid-transition.
            No other screen has its gesture behavior touched. */}
        <Stack.Screen name="sign-in-transition" options={{ gestureEnabled: false }} />
      </Stack>
      {importing && (
        <View style={styles.importOverlay}>
          <Text style={styles.importText}>{t("importDeck.importingOverlay")}</Text>
        </View>
      )}
      {/* Gated on the canonical store's isInitialized, not just showBrandStartup — BrandStartup
          must never mount before the persisted appearance preference (and a fresh systemScheme
          read) are both confirmed, or it would have to guess a treatment and risk a wrong-theme
          flash. The native splash (see app.json, fixed teal — cannot read AsyncStorage before JS
          starts) stays up for this entire gap, since hideNativeSplash is only ever called from
          within BrandStartup itself. See this batch's report, Phase A/D, for the full analysis. */}
      {isInitialized && showBrandStartup && (
        <BrandStartup onReady={hideNativeSplash} onFinished={() => setShowBrandStartup(false)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webUnsupportedFill: { flex: 1, justifyContent: "center" },
  importOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  importText: { color: "white", fontWeight: "900", fontSize: 18 },
});
