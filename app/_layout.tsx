import * as Linking from "expo-linking";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { onWorkspaceChanged } from "../src/auth/authSignal";
import { SyncService } from "../src/cloud/sync/SyncService";
import { handleIncomingFile } from "../src/domain/openFileHandler";


const APP_BG = "#2FA4A3";

export default function Layout() {

  const router = useRouter();
  const [importing, setImporting] = useState(false);
  const didSyncRef = useRef(false);

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
    SyncService.syncOnce().catch((e) => console.error("SYNC FAILED", e));
  }, [importing]);

  // Sign-in and account switches must trigger a fresh sync of the newly active workspace,
  // not just the one-shot sync above that only fires on cold launch. Guest transitions are
  // safe to pass through unconditionally — SyncService itself no-ops without a cloud identity.
  useEffect(() => {
    const unsub = onWorkspaceChanged((scope) => {
      if (scope.kind === "user") {
        SyncService.syncOnce().catch((e) => console.error("SYNC FAILED", e));
      }
    });
    return unsub;
  }, []);

  return (
    <View style={styles.container}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: APP_BG,
          },
        }}
      />
      {importing && (
        <View style={styles.importOverlay}>
          <Text style={styles.importText}>Importing deck…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: APP_BG },
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
