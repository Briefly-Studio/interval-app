import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { onWorkspaceChanged } from "../src/auth/authSignal";
import { SyncService } from "../src/cloud/sync/SyncService";
import { resetDevLibraryFixtures, seedDevLibraryFixtures } from "../src/domain/librarySeed";
import { useTranslation } from "../src/i18n";
import { ForceResyncUnsyncedChangesError, forceFullResyncPrep, resetLocalData } from "../src/storage/devReset";
import type { WorkspaceScope } from "../src/storage/workspaceScope";
import { useTheme } from "@/src/theme";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";

export default function DevToolsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();
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
        <View style={[styles.header, { gap: spacing.sm }]}>
          <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
          <Text style={[typography.title, { color: colors.textPrimary }]} accessibilityRole="header">Developer tools</Text>
        </View>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>
          This screen is only available in development.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        <Text style={[typography.title, { color: colors.textPrimary }]} accessibilityRole="header">Developer tools</Text>
      </View>
      <Text style={[typography.secondary, { color: colors.textSecondary }]}>For debugging only.</Text>

      <Card style={[styles.toolCard, { gap: spacing.sm }]}>
        <Text style={[typography.subheading, { color: colors.textPrimary }]}>Force Resync</Text>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>
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
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            Cloud resync is available only when signed in.
          </Text>
        )}
      </Card>

      <Card style={[styles.toolCard, { gap: spacing.sm }]}>
        <Text style={[typography.subheading, { color: colors.textPrimary }]}>Reset Local Data</Text>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>
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

      <Card style={[styles.toolCard, { gap: spacing.sm }]}>
        <Text style={[typography.subheading, { color: colors.textPrimary }]}>Library Fixtures</Text>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>
          Adds generic sample Library sources and collections for the current workspace, for testing
          sorting/filtering/collections/empty states. Development build only — no real files are ever
          created; this only writes local metadata.
        </Text>
        <Button
          label="Add Sample Library Data"
          variant="secondary"
          fullWidth
          onPress={async () => {
            const activeScope = await AuthService.getActiveScope();
            await seedDevLibraryFixtures(activeScope);
            Alert.alert("Sample Library data added");
          }}
        />
        <Button
          label="Reset Library Data"
          variant="danger"
          fullWidth
          onPress={() => {
            Alert.alert(
              "Reset Library data?",
              "This removes locally stored Library sources and collections for the current workspace on this device. Decks, cards, sessions, and your account are not affected. This cannot be undone.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Reset Library data",
                  style: "destructive",
                  onPress: async () => {
                    const activeScope = await AuthService.getActiveScope();
                    await resetDevLibraryFixtures(activeScope);
                    Alert.alert("Library data reset");
                  },
                },
              ]
            );
          }}
        />
      </Card>

      <Card style={[styles.toolCard, { gap: spacing.sm }]}>
        <Text style={[typography.subheading, { color: colors.textPrimary }]}>Theme Lab</Text>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>
          Visual-only exploration of Light/Dark/Warm appearance concepts. Development build only —
          not connected to real data, storage, or account settings.
        </Text>
        <Button
          label="Open Theme Lab"
          variant="secondary"
          fullWidth
          onPress={() => router.push({ pathname: "/theme-lab" as any })}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  toolCard: {},
});
