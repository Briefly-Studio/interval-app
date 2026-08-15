import { useFocusEffect } from "@react-navigation/native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { onWorkspaceChanged } from "../src/auth/authSignal";
import type { UserIdentity } from "../src/auth/identity";
import { formatSyncTime } from "../src/cloud/sync/formatSyncTime";
import { SYNC_STATUS_KEYS } from "../src/cloud/sync/syncStatusCopy";
import { useSyncState } from "../src/cloud/sync/useSyncState";
import { useTranslation } from "../src/i18n";
import { LOCALE_REGISTRY } from "../src/i18n/localeRegistry";
import type { WorkspaceScope } from "../src/storage/workspaceScope";
import { useTheme } from "@/src/theme";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { EmptyState } from "../src/ui/EmptyState";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";
import { SettingsRow } from "../src/ui/SettingsRow";

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
  const { colors, radii, spacing, typography, selectedMode: appearanceMode } = useTheme();
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
  // currently in effect. Any specific locale shows its own native name (its endonym — see
  // src/i18n/localeRegistry.ts) — this generalizes to any future enabled locale without this
  // screen ever needing another special case.
  const languageSubtitle = useMemo(() => {
    if (preference === "system") return t("settings.languageOptions.system");
    return LOCALE_REGISTRY[preference].nativeName;
  }, [preference, t]);

  const appearanceSubtitle = useMemo(() => {
    switch (appearanceMode) {
      case "system":
        return t("settings.appearanceOptions.system");
      case "light":
        return t("settings.appearanceOptions.light");
      case "dark":
        return t("settings.appearanceOptions.dark");
      case "warm":
        return t("settings.appearanceOptions.warm");
    }
  }, [appearanceMode, t]);

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
    } catch (error) {
      console.error("[settings] sign out failed:", error);
      Alert.alert(t("settings.signOutFailedTitle"), t("settings.signOutFailedBody"));
    } finally {
      setSigningOut(false);
    }
  };

  const header = (
    <View style={[styles.header, { gap: spacing.sm }]}>
      <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
      <Text style={[typography.title, { color: colors.textPrimary }]} accessibilityRole="header">{t("settings.title")}</Text>
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

      <View style={[styles.section, { gap: spacing.sm }]}>
        <Text style={[typography.label, { color: colors.textSecondary }]}>{t("settings.sections.profile")}</Text>
        <Card style={[styles.profileCard, { gap: spacing.md }]}>
          <View style={[styles.avatar, { borderRadius: radii.pill, backgroundColor: colors.accentSubtle }]}>
            <Text style={[styles.avatarText, { color: colors.accent }]}>{initialFor(identity)}</Text>
          </View>
          <View style={styles.profileText}>
            <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={1}>
              {identity?.displayName ?? t("settings.fallbackName")}
            </Text>
            {identity?.fullName && identity.fullName !== identity.displayName ? (
              <Text style={[typography.secondary, { color: colors.textSecondary }]} numberOfLines={1}>
                {identity.fullName}
              </Text>
            ) : null}
            {identity?.email ? (
              <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={1}>
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

      <View style={[styles.section, { gap: spacing.sm }]}>
        <Text style={[typography.label, { color: colors.textSecondary }]}>{t("settings.sections.account")}</Text>
        <Card style={styles.rowGroup}>
          <SettingsRow
            label={t("settings.changePassword")}
            onPress={() => router.push({ pathname: "/change-password" as any })}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <SettingsRow
            label={t("settings.requestAccountDeletion")}
            destructive
            onPress={() => router.push({ pathname: "/delete-account" as any })}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <SettingsRow label={t("settings.signOut")} destructive loading={signingOut} onPress={onSignOut} />
        </Card>
      </View>

      <View style={[styles.section, { gap: spacing.sm }]}>
        <Text style={[typography.label, { color: colors.textSecondary }]}>{t("settings.sections.appearance")}</Text>
        <Card style={styles.rowGroup}>
          <SettingsRow
            label={t("settings.appearance")}
            subtitle={appearanceSubtitle}
            onPress={() => router.push({ pathname: "/appearance" as any })}
          />
        </Card>
      </View>

      <View style={[styles.section, { gap: spacing.sm }]}>
        <Text style={[typography.label, { color: colors.textSecondary }]}>{t("settings.sections.accessibility")}</Text>
        <Card style={styles.rowGroup}>
          <SettingsRow
            label={t("settings.accessibility")}
            onPress={() => router.push({ pathname: "/accessibility-settings" as any })}
          />
        </Card>
      </View>

      <View style={[styles.section, { gap: spacing.sm }]}>
        <Text style={[typography.label, { color: colors.textSecondary }]}>{t("settings.sections.library")}</Text>
        <Card style={styles.rowGroup}>
          <SettingsRow
            label={t("settings.openLibrary")}
            onPress={() => router.push({ pathname: "/library" as any })}
          />
        </Card>
      </View>

      <View style={[styles.section, { gap: spacing.sm }]}>
        <Text style={[typography.label, { color: colors.textSecondary }]}>{t("settings.sections.data")}</Text>
        <Card style={styles.rowGroup}>
          <SettingsRow
            label={t("settings.sync")}
            subtitle={syncSubtitle}
            onPress={() => router.push({ pathname: "/sync-status" as any })}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <SettingsRow
            label={t("settings.recentlyDeleted")}
            onPress={() => router.push({ pathname: "/recently-deleted" as any })}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <SettingsRow label={t("settings.importDeck")} onPress={() => router.push("/import")} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <SettingsRow
            label={t("settings.language")}
            subtitle={languageSubtitle}
            onPress={() => router.push({ pathname: "/language" as any })}
          />
        </Card>
      </View>

      <View style={[styles.section, { gap: spacing.sm }]}>
        <Text style={[typography.label, { color: colors.textSecondary }]}>{t("settings.sections.support")}</Text>
        <Card style={styles.rowGroup}>
          <SettingsRow
            label={t("settings.helpFeedback")}
            onPress={() => router.push({ pathname: "/help-feedback" as any })}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <SettingsRow
            label={t("settings.betaNotice")}
            onPress={() => router.push({ pathname: "/beta-notice" as any })}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <SettingsRow
            label={t("settings.privacyNotice")}
            onPress={() => router.push({ pathname: "/privacy-notice" as any })}
          />
        </Card>
      </View>

      <View style={[styles.section, { gap: spacing.sm }]}>
        <Text style={[typography.label, { color: colors.textSecondary }]}>{t("settings.sections.about")}</Text>
        <Card style={[styles.aboutCard, { gap: spacing.xs }]}>
          <View style={[styles.aboutTitleRow, { gap: spacing.xs }]}>
            <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>Interval</Text>
            <View style={[styles.betaBadge, { borderRadius: radii.pill, backgroundColor: colors.accentSubtle }]}>
              <Text style={[styles.betaBadgeText, { color: colors.accent }]}>{t("settings.betaLabel")}</Text>
            </View>
          </View>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("settings.version", { version: APP_VERSION })}</Text>
          {APP_BUILD ? (
            <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("settings.buildLabel", { build: APP_BUILD })}</Text>
          ) : null}
          <Text style={[typography.secondary, styles.aboutDescription, { color: colors.textSecondary, marginTop: spacing.xs }]}>
            {t("settings.aboutDescription")}
          </Text>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  emptyFill: { flex: 1, justifyContent: "center" },

  section: {},

  profileCard: { flexDirection: "row", alignItems: "center" },
  avatar: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 22, fontWeight: "700" },
  profileText: { flex: 1, gap: 2 },

  rowGroup: {},
  divider: { height: 1 },

  aboutCard: {},
  aboutTitleRow: { flexDirection: "row", alignItems: "center" },
  betaBadge: { paddingHorizontal: 4, paddingVertical: 2 },
  betaBadgeText: { fontSize: 11, fontWeight: "700" },
  aboutDescription: {},
});
