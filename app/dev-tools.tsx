import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthService } from "../src/auth/AuthService";
import { onWorkspaceChanged } from "../src/auth/authSignal";
import { SyncService } from "../src/cloud/sync/SyncService";
import { forceFullResyncPrep, resetLocalData } from "../src/storage/devReset";
import type { WorkspaceScope } from "../src/storage/workspaceScope";

const APP_BG = "#2FA4A3";

export default function DevToolsScreen() {
  const router = useRouter();
  const [scope, setScope] = useState<WorkspaceScope>({ kind: "guest" });
  const isGuest = scope.kind === "guest";

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const activeScope = await AuthService.getActiveScope();
        if (alive) setScope(activeScope);
      })();
      return () => {
        alive = false;
      };
    }, [])
  );

  useEffect(() => onWorkspaceChanged(setScope), []);

  if (!__DEV__) {
    return (
      <SafeAreaView style={styles.screen}>
        <Pressable onPress={() => router.back()} style={styles.pill}>
          <Text style={styles.pillText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Dev Tools</Text>
        <Text style={styles.subtle}>This screen is only available in development.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={styles.pill}>
          <Text style={styles.pillText}>← Back</Text>
        </Pressable>
      </View>

      <Text style={styles.title}>Dev Tools</Text>
      <Text style={styles.subtle}>Use for debugging only</Text>

      <Pressable
        onPress={async () => {
          const activeScope = await AuthService.getActiveScope();
          if (activeScope.kind === "guest") {
            Alert.alert("Cloud resync is available only when signed in.");
            return;
          }
          await forceFullResyncPrep(activeScope);
          await SyncService.syncOnce();
          Alert.alert("Force Resync complete");
        }}
        disabled={isGuest}
        style={[styles.secondaryBtn, isGuest && styles.secondaryBtnDisabled]}
      >
        <Text style={styles.secondaryText}>Force Resync</Text>
      </Pressable>
      {isGuest && (
        <Text style={styles.subtle}>Cloud resync is available only when signed in.</Text>
      )}

      <Pressable
        onPress={async () => {
          const scope = await AuthService.getActiveScope();
          await resetLocalData(scope);
          Alert.alert("Reset done");
        }}
        style={styles.secondaryBtn}
      >
        <Text style={styles.secondaryText}>Reset Local Data</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: APP_BG,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  pillText: { color: "white", fontWeight: "700" },
  title: { fontSize: 30, fontWeight: "900", color: "white", marginTop: 4 },
  subtle: { color: "white", opacity: 0.85 },
  secondaryBtn: {
    marginTop: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
  },
  secondaryBtnDisabled: {
    opacity: 0.4,
  },
  secondaryText: { color: "white", fontWeight: "900", fontSize: 16 },
});
