import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";

import { formatSyncTime } from "../src/cloud/sync/formatSyncTime";
import type { SyncStatus } from "../src/cloud/sync/syncState";
import { SYNC_STATUS_KEYS } from "../src/cloud/sync/syncStatusCopy";
import { useSyncState } from "../src/cloud/sync/useSyncState";
import { useTranslation } from "../src/i18n";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";
import { colors, spacing, typography } from "../src/ui/theme";

// Status is never conveyed by color alone — every status renders an icon + text pairing.
// "offline" is deliberately neutral/muted rather than danger-colored: it's expected, normal
// behavior for an offline-first app, not an error condition.
const STATUS_META: Record<SyncStatus, { icon: ComponentProps<typeof Ionicons>["name"]; color: string }> = {
  unknown: { icon: "time-outline", color: colors.textSecondary },
  syncing: { icon: "sync-outline", color: colors.textSecondary },
  synced: { icon: "checkmark-circle-outline", color: colors.success },
  offline: { icon: "cloud-offline-outline", color: colors.textSecondary },
  needsAttention: { icon: "alert-circle-outline", color: colors.danger },
};

// Retry is only meaningful when a sync is not already running. It's shown for "needsAttention"
// (a real, actionable failure) and also for "offline" — per the product spec, connectivity
// itself can't be forced, but a user who believes they're back online should still be able to
// nudge a check rather than wait for the passive reconnect listener; this is a deliberate,
// single user-initiated action, never a loop.
const RETRYABLE: ReadonlySet<SyncStatus> = new Set(["needsAttention", "offline"]);

export default function SyncStatusScreen() {
  const router = useRouter();
  const { t, plural } = useTranslation();
  const syncState = useSyncState();
  const meta = STATUS_META[syncState.status];
  const canRetry = RETRYABLE.has(syncState.status) && syncState.status !== "syncing";

  return (
    <Screen scroll>
      <View style={styles.header}>
        <IconButton name="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <Text style={typography.title}>{t("sync.screenTitle")}</Text>
      </View>

      <Card style={styles.statusCard}>
        <View style={styles.statusRow} accessibilityLiveRegion="polite">
          <Ionicons name={meta.icon} size={28} color={meta.color} />
          <Text style={[styles.statusText, { color: meta.color }]}>
            {t(SYNC_STATUS_KEYS[syncState.status])}
          </Text>
        </View>

        <View style={styles.detailRows}>
          <Text style={typography.secondary}>
            {syncState.lastSuccessfulSyncAt
              ? t("sync.detail.lastSynced", {
                  time: formatSyncTime(syncState.lastSuccessfulSyncAt),
                })
              : t("sync.detail.neverSynced")}
          </Text>
          <Text style={typography.secondary}>
            {syncState.pendingDirtyCount > 0
              ? plural("sync.detail.pendingCount", syncState.pendingDirtyCount)
              : t("sync.detail.noPendingChanges")}
          </Text>
        </View>

        {canRetry ? (
          <Button
            label={t("sync.retry")}
            variant="secondary"
            fullWidth
            onPress={syncState.retrySync}
          />
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statusCard: { gap: spacing.md },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statusText: { fontSize: 18, fontWeight: "600" },
  detailRows: { gap: spacing.xs },
});
