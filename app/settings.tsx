import { useFocusEffect } from "@react-navigation/native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { onWorkspaceChanged } from "../src/auth/authSignal";
import type { UserIdentity } from "../src/auth/identity";
import { formatSyncTime } from "../src/cloud/sync/formatSyncTime";
import { SYNC_STATUS_KEYS } from "../src/cloud/sync/syncStatusCopy";
import { useSyncState } from "../src/cloud/sync/useSyncState";
import { useTranslation } from "../src/i18n";
import type { WorkspaceScope } from "../src/storage/workspaceScope";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { EmptyState } from "../src/ui/EmptyState";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";
import { SettingsRow } from "../src/ui/SettingsRow";
import { colors, radii, spacing, typography } from "../src/ui/theme";

const APP_VERSION = Constants.expoConfig?.version ?? "—";

function resolveBuildNumber(): string | undefined {
  const iosBuildNumber = Constants.expoConfig?.ios?.buildNumber;
  if (iosBuildNumber) return iosBuildNumber;

  const androidVersionCode = Constants.expoConfig?.android?.versionCode;
  if (androidVersionCode !== undefined && androidVersionCode !== null) return String(androidVersionCode);

  const nativeBuildVersion = Constants.nativeBuildVersion;
  if (nativeBuildVersion) return nativeBuildVersion;

  return undefined;
}

const APP_BUILD = resolveBuildNumber();

function initialFor(identity: UserIdentity | null): string {
  const source = identity?.displayName;
  return source ? source[0].toUpperCase() : "•";
}

export default function SettingsScreen() {
  const router = useRouter();
  const { t, plural, preference } = useTranslation();
  const [scope, setScope] = useState<WorkspaceScope>({ kind: "guest" });
  const [identity, setIdentity] = useState<UserIdentity | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const syncState = useSyncState();
  const signedIn = scope.kind === "user";

  // Plain, nontechnical subtitle: status text, optionally plus a last-synced time and a pending-
  // changes count — never an endpoint, cursor, device id, or raw diagnostic code. The pending-
  // count fragment intentionally shows regardless of status (including mid-"syncing") since it
  // answers a different question ("is there unsaved work waiting?") than the status word does.
  const syncSubtitle = useMemo(() => {
    const parts = [t(SYNC_STATUS_KEYS[syncState.status])];
    if (syncState.status === "synced" && syncState.lastSuccessfulSyncAt) {
      const ago = formatSyncTime(syncState.lastSuccessfulSyncAt);
      const relativeTime =
        ago.unit === "justNow" ? t("sync.relativeTime.justNow") : plural(`sync.relativeTime.${ago.unit}`, ago.count);
      parts.push(t("sync.detail.lastSynced", { time: relativeTime }));
    }
    if (syncState.pendingDirtyCount > 0) {
      parts.push(plural("sync.detail.pendingCount", syncState.pendingDirtyCount));
    }
    return parts.join(" · ");
  }, [syncState, t, plural]);

  // "system" shows the plain "System default" label rather than the resolved language, matching
  // the product requirement that this row reflects the user's *preference*, not the language
  // currently in effect.
  const languageSubtitle = useMemo(() => {
    if (preference === "system") return t("settings.languageOptions.system");
    if (preference === "es") return t("settings.languageOptions.espanol");
    return t("settings.languageOptions.english");
  }, [preference, t]);

  const refresh = useCallback(async () => {
    const activeScope = await AuthService.getActiveScope();
    setScope(activeScope);
    setIdentity(activeScope.kind === "user" ? await AuthService.getActiveIdentity() : null);
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!alive) return;
        await refresh();
      })();
      return () => {
        alive = false;
      };
    }, [refresh])
  );

  useEffect(
    () =>
      onWorkspaceChanged((newScope) => {
        setScope(newScope);
        if (newScope.kind === "user") {
          AuthService.getActiveIdentity().then(setIdentity);
        } else {
          setIdentity(null);
        }
      }),
    []
  );

  const onSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await AuthService.signOut();
      router.back();
    } finally {
      setSigningOut(false);
    }
  };

  const header = (
    <View style={styles.header}>
      <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
      <Text style={typography.title}>{t("settings.title")}</Text>
    </View>
  );

  // Settings is only ever reached from Home's authenticated account button, so this path is
  // defensive (e.g. a token expiring while this screen happens to be open) rather than a normal
  // route — never show a fabricated profile for a guest.
  if (loaded && !signedIn) {
    return (
      <Screen>
        {header}
        <View style={styles.emptyFill}>
          <EmptyState
            icon="person-circle-outline"
            title={t("settings.notSignedInTitle")}
            description={t("settings.notSignedInDescription")}
          >
            <Button label={t("settings.signIn")} variant="primary" fullWidth onPress={() => router.push("/sign-in")} />
          </EmptyState>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      {header}

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t("settings.sections.profile")}</Text>
        <Card style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initialFor(identity)}</Text>
          </View>
          <View style={styles.profileText}>
            <Text style={typography.bodyMedium} numberOfLines={1}>
              {identity?.displayName ?? t("settings.fallbackName")}
            </Text>
            {identity?.fullName && identity.fullName !== identity.displayName ? (
              <Text style={typography.secondary} numberOfLines={1}>
                {identity.fullName}
              </Text>
            ) : null}
            {identity?.email ? (
              <Text style={typography.caption} numberOfLines={1}>
                {identity.email}
              </Text>
            ) : null}
          </View>
        </Card>
        <Card>
          <SettingsRow
            label={t("settings.editProfile")}
            onPress={() => router.push({ pathname: "/edit-profile" as any })}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t("settings.sections.account")}</Text>
        <Card style={styles.rowGroup}>
          <SettingsRow
            label={t("settings.changePassword")}
            onPress={() => router.push({ pathname: "/change-password" as any })}
          />
          <View style={styles.divider} />
          <SettingsRow
            label={t("settings.requestAccountDeletion")}
            destructive
            onPress={() => router.push({ pathname: "/delete-account" as any })}
          />
          <View style={styles.divider} />
          <SettingsRow label={t("settings.signOut")} destructive loading={signingOut} onPress={onSignOut} />
        </Card>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t("settings.sections.data")}</Text>
        <Card style={styles.rowGroup}>
          <SettingsRow
            label={t("settings.sync")}
            subtitle={syncSubtitle}
            onPress={() => router.push({ pathname: "/sync-status" as any })}
          />
          <View style={styles.divider} />
          <SettingsRow
            label={t("settings.recentlyDeleted")}
            onPress={() => router.push({ pathname: "/recently-deleted" as any })}
          />
          <View style={styles.divider} />
          <SettingsRow label={t("settings.importDeck")} onPress={() => router.push("/import")} />
          <View style={styles.divider} />
          <SettingsRow
            label={t("settings.language")}
            subtitle={languageSubtitle}
            onPress={() => router.push({ pathname: "/language" as any })}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t("settings.sections.support")}</Text>
        <Card style={styles.rowGroup}>
          <SettingsRow
            label={t("settings.helpFeedback")}
            onPress={() => router.push({ pathname: "/help-feedback" as any })}
          />
          <View style={styles.divider} />
          <SettingsRow
            label={t("settings.betaNotice")}
            onPress={() => router.push({ pathname: "/beta-notice" as any })}
          />
          <View style={styles.divider} />
          <SettingsRow
            label={t("settings.privacyNotice")}
            onPress={() => router.push({ pathname: "/privacy-notice" as any })}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t("settings.sections.about")}</Text>
        <Card style={styles.aboutCard}>
          <View style={styles.aboutTitleRow}>
            <Text style={typography.bodyMedium}>Interval</Text>
            <View style={styles.betaBadge}>
              <Text style={styles.betaBadgeText}>{t("settings.betaLabel")}</Text>
            </View>
          </View>
          <Text style={typography.caption}>{t("settings.version", { version: APP_VERSION })}</Text>
          {APP_BUILD ? (
            <Text style={typography.caption}>{t("settings.buildLabel", { build: APP_BUILD })}</Text>
          ) : null}
          <Text style={[typography.secondary, styles.aboutDescription]}>{t("settings.aboutDescription")}</Text>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  emptyFill: { flex: 1, justifyContent: "center" },

  section: { gap: spacing.sm },
  sectionLabel: { ...typography.label },

  profileCard: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 22, fontWeight: "700", color: colors.accentStrong },
  profileText: { flex: 1, gap: 2 },

  rowGroup: { gap: 0 },
  divider: { height: 1, backgroundColor: colors.border },

  aboutCard: { gap: spacing.xs },
  aboutTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  betaBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.accentMuted,
  },
  betaBadgeText: { fontSize: 11, fontWeight: "700", color: colors.accentStrong },
  aboutDescription: { marginTop: spacing.xs },
});
