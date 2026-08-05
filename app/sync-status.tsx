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
import { useTheme, type ThemeTokens } from "@/src/theme";

// Status is never conveyed by color alone — every status renders an icon + text pairing.
// "offline" is deliberately neutral/muted rather than danger-colored: it's expected, normal
// behavior for an offline-first app, not an error condition.
// Built from live theme colors inside the component body (not at module scope) — colors must
// stay reactive to the resolved theme, matching the same fix applied to app/index.tsx's
// SYNC_STATUS_META.
function statusMetaFor(
  colors: ThemeTokens
): Record<SyncStatus, { icon: ComponentProps<typeof Ionicons>["name"]; color: string }> {
  return {
    unknown: { icon: "time-outline", color: colors.textSecondary },
    syncing: { icon: "sync-outline", color: colors.textSecondary },
    synced: { icon: "checkmark-circle-outline", color: colors.success },
    syncedWithWarnings: { icon: "alert-circle-outline", color: colors.warning },
    offline: { icon: "cloud-offline-outline", color: colors.textSecondary },
    needsAttention: { icon: "alert-circle-outline", color: colors.danger },
  };
}

// Retry is only meaningful when a sync is not already running. It's shown for "needsAttention"
// (a real, actionable failure) and also for "offline" — per the product spec, connectivity
// itself can't be forced, but a user who believes they're back online should still be able to
// nudge a check rather than wait for the passive reconnect listener; this is a deliberate,
// single user-initiated action, never a loop.
const RETRYABLE: ReadonlySet<SyncStatus> = new Set(["needsAttention", "offline"]);

export default function SyncStatusScreen() {
  const router = useRouter();
  const { t, plural } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const syncState = useSyncState();
  const meta = statusMetaFor(colors)[syncState.status];
  const canRetry = RETRYABLE.has(syncState.status) && syncState.status !== "syncing";

  return (
    <Screen scroll>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        <Text style={[typography.title, { color: colors.textPrimary }]}>{t("sync.screenTitle")}</Text>
      </View>

      <Card style={[styles.statusCard, { gap: spacing.md }]}>
        <View style={[styles.statusRow, { gap: spacing.sm }]} accessibilityLiveRegion="polite">
          <Ionicons name={meta.icon} size={28} color={meta.color} />
          <Text style={[styles.statusText, { color: meta.color }]}>
            {t(SYNC_STATUS_KEYS[syncState.status])}
          </Text>
        </View>

        <View style={[styles.detailRows, { gap: spacing.xs }]}>
          <Text style={[typography.secondary, { color: colors.textSecondary }]}>
            {syncState.lastSuccessfulSyncAt
              ? t("sync.detail.lastSynced", {
                  time: (() => {
                    const ago = formatSyncTime(syncState.lastSuccessfulSyncAt);
                    return ago.unit === "justNow"
                      ? t("sync.relativeTime.justNow")
                      : plural(`sync.relativeTime.${ago.unit}`, ago.count);
                  })(),
                })
              : t("sync.detail.neverSynced")}
          </Text>
          <Text style={[typography.secondary, { color: colors.textSecondary }]}>
            {syncState.pendingDirtyCount > 0
              ? plural("sync.detail.pendingCount", syncState.pendingDirtyCount)
              : t("sync.detail.noPendingChanges")}
          </Text>
          {syncState.status === "syncedWithWarnings" && syncState.skippedPullRecordCount ? (
            <Text style={[typography.secondary, { color: colors.warning }]}>
              {plural("sync.detail.skippedPullRecords", syncState.skippedPullRecordCount)}
            </Text>
          ) : null}
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

      {/* A restrained, always-visible informational note — not an alert, not colored as a
          warning — about the current beta's rev-only conflict model. See
          docs/sync-invariants.md's "no conflict UI for concurrent multi-device edits" section
          for the full detail behind this one calm sentence. */}
      <Text style={[typography.secondary, { color: colors.textMuted, marginTop: spacing.lg }]}>
        {t("sync.conflictNote")}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  statusCard: {},
  statusRow: { flexDirection: "row", alignItems: "center" },
  statusText: { fontSize: 18, fontWeight: "600" },
  detailRows: {},
});
