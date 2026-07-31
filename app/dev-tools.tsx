import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { onWorkspaceChanged } from "../src/auth/authSignal";
import { SyncService } from "../src/cloud/sync/SyncService";
import { useTranslation } from "../src/i18n";
import { ForceResyncUnsyncedChangesError, forceFullResyncPrep, resetLocalData } from "../src/storage/devReset";
import type { WorkspaceScope } from "../src/storage/workspaceScope";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";
import { spacing, typography } from "../src/ui/theme";

export default function DevToolsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
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
      <Screen>
        <View style={styles.header}>
          <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
          <Text style={typography.title}>Developer tools</Text>
        </View>
        <Text style={typography.secondary}>This screen is only available in development.</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        <Text style={typography.title}>Developer tools</Text>
      </View>
      <Text style={typography.secondary}>For debugging only.</Text>

      <Card style={styles.toolCard}>
        <Text style={typography.subheading}>Force Resync</Text>
        <Text style={typography.secondary}>
          Re-pushes and re-pulls this account&apos;s data with the cloud. Available only when signed in.
        </Text>
        <Button
          label="Force Resync"
          variant="secondary"
          fullWidth
          disabled={isGuest}
          onPress={async () => {
            const activeScope = await AuthService.getActiveScope();
            if (activeScope.kind === "guest") {
              Alert.alert("Cloud resync is available only when signed in.");
              return;
            }
            try {
              await forceFullResyncPrep(activeScope);
            } catch (error) {
              if (error instanceof ForceResyncUnsyncedChangesError) {
                // Local data was deliberately left untouched — never wiped without a confirmed
                // sync first. See docs/sync-invariants.md invariant #14.
                Alert.alert(t("devTools.forceResyncRefusedTitle"), t("devTools.forceResyncRefusedBody"));
                return;
              }
              throw error;
            }
            await SyncService.syncOnce();
            Alert.alert("Force Resync complete");
          }}
        />
        {isGuest && (
          <Text style={typography.caption}>Cloud resync is available only when signed in.</Text>
        )}
      </Card>

      <Card style={styles.toolCard}>
        <Text style={typography.subheading}>Reset Local Data</Text>
        <Text style={typography.secondary}>
          Clears all locally stored decks, cards, and sessions for the current workspace.
        </Text>
        <Button
          label="Reset Local Data"
          variant="danger"
          fullWidth
          onPress={() => {
            Alert.alert(
              "Reset local data?",
              "This removes locally stored decks, cards, and sessions for the current workspace on this device. This cannot be undone.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Reset data",
                  style: "destructive",
                  onPress: async () => {
                    const activeScope = await AuthService.getActiveScope();
                    await resetLocalData(activeScope);
                    Alert.alert("Reset done");
                  },
                },
              ]
            );
          }}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  toolCard: { gap: spacing.sm },
});
