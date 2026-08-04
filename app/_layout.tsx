import * as Linking from "expo-linking";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { onWorkspaceChanged } from "../src/auth/authSignal";
import { getSyncDiagnosticCode } from "../src/cloud/sync/http";
import { SyncService } from "../src/cloud/sync/SyncService";
import { getSyncState } from "../src/cloud/sync/syncState";
import { initSyncState } from "../src/cloud/sync/useSyncState";
import { handleIncomingFile } from "../src/domain/openFileHandler";
import { initI18n } from "../src/i18n";
import { initTheme, useTheme } from "@/src/theme";
import { BrandStartup } from "../src/ui/BrandStartup";

// Held here (module scope, not inside the component) so it runs as early as possible — before
// the native splash would otherwise auto-hide on its own default timing. Failure is expected and
// safe to ignore (e.g. Fast Refresh calling this again after the splash already hid).
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function Layout() {
  const router = useRouter();
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

  // The native splash is hidden only from BrandStartup's onReady callback (fired from that
  // layer's own onLayout, with a bounded fallback) — never from a bare mount effect. A previous
  // cut called SplashScreen.hideAsync() as soon as this component's own render committed, which
  // is a JS-side signal only; it does not guarantee the native UI thread has actually painted
  // BrandStartup's background + mark before the bridge call to hide the native splash resolves.
  // That gap was the root cause of an earlier white-flash bug: dismissing the native splash could
  // briefly reveal the native root view's own default background before BrandStartup's first
  // real frame had painted. onLayout is a native-confirmed signal that BrandStartup's view
  // genuinely has real, laid-out bounds, so hiding the native splash there cannot expose that
  // gap. This intentionally does not wait on i18n, sync, or auth — see BrandStartup.tsx and this
  // batch's handoff notes for why tying startup branding to network/auth readiness is out of
  // scope here. BrandStartup owns its own full motion sequence and timing (including the
  // reduced-motion variant and stuck-overlay backstops).
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
        const newDeckId = await handleIncomingFile(fileUri);
        router.replace(`/deck/${newDeckId}`);
      } catch (error) {
        Alert.alert(
          "Import failed",
          error instanceof Error ? error.message : "This file is not a valid Interval deck."
        );
      } finally {
        setImporting(false);
      }
    },
    [router]
  );

  // Fire-and-forget: English (the only supported language so far) is already the correct
  // in-memory default before this resolves, so there is nothing to gate startup on — this just
  // reconciles the stored preference for the Settings/Language UI.
  useEffect(() => {
    initI18n();
  }, []);

  // One-time startup wiring for the real sync-state model (NetInfo subscription + workspace-
  // switch reset) — same fire-and-forget, call-once pattern as initI18n() above. See
  // src/cloud/sync/useSyncState.ts for what this actually sets up.
  useEffect(() => {
    initSyncState();
  }, []);

  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      handleUrl(url);
    });
    const sub = Linking.addEventListener("url", ({ url }) => {
      handleUrl(url);
    });
    return () => sub.remove();
  }, [handleUrl]);

  useEffect(() => {
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
          <Text style={styles.importText}>Importing deck…</Text>
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
