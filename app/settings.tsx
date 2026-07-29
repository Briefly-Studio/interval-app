import { useFocusEffect } from "@react-navigation/native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthService } from "../src/auth/AuthService";
import { onWorkspaceChanged } from "../src/auth/authSignal";
import type { UserIdentity } from "../src/auth/identity";
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

function initialFor(identity: UserIdentity | null): string {
  const source = identity?.displayName;
  return source ? source[0].toUpperCase() : "•";
}

export default function SettingsScreen() {
  const router = useRouter();
  const { t, preference } = useTranslation();
  const [scope, setScope] = useState<WorkspaceScope>({ kind: "guest" });
  const [identity, setIdentity] = useState<UserIdentity | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const signedIn = scope.kind === "user";

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
      <IconButton name="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
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
              {identity?.displayName ?? "there"}
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
            subtitle={t("settings.comingSoon")}
            disabled
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
            subtitle={t("settings.syncExplanation")}
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
            subtitle={
              preference === "system" ? t("settings.languageOptions.system") : t("settings.languageOptions.english")
            }
            onPress={() => router.push({ pathname: "/language" as any })}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t("settings.sections.about")}</Text>
        <Card style={styles.aboutCard}>
          <Text style={typography.bodyMedium}>Interval</Text>
          <Text style={typography.caption}>{t("settings.version", { version: APP_VERSION })}</Text>
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
  aboutDescription: { marginTop: spacing.xs },
});
