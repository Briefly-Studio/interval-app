import Constants from "expo-constants";
import { Platform } from "react-native";

import { AuthService } from "../auth/AuthService";
import { getSyncState, type SyncState } from "../cloud/sync/syncState";
import { getI18nState } from "../i18n";
import type { WorkspaceScope } from "../storage/workspaceScope";

// A sanitized, support-ticket-friendly snapshot of "what is this install's state" — nothing more.
// STRICT allow-list: every field below is permitted for a bug report. Never add email, given/
// family name, nickname, Cognito sub, any token/JWT/claims, password, device id, sync cursor, API
// endpoint, AWS resource name, deck/card/session content, filenames, raw error messages, stack
// traces, or local file paths to this type — if a new field is ever needed here, it must be
// re-audited against that list first.
export type DiagnosticSummary = {
  appVersion: string;
  buildNumber?: string;
  platform: string;
  osVersion?: string;
  appLanguage: string;
  authState: "guest" | "authenticated";
  syncStatus: string;
  lastSuccessfulSyncAt?: string;
  pendingDirtyCount: number;
  diagnosticCode?: string;
};

/** Plain inputs for the pure builder below — deliberately not "read the globals yourself" so the
 * assembly logic can be unit-tested with fake values, no React/Expo/AsyncStorage required. */
export type DiagnosticSummaryInput = {
  appVersion: string;
  buildNumber?: string;
  platform: string;
  osVersion?: string | number;
  appLanguage: string;
  scopeKind: WorkspaceScope["kind"];
  syncState: SyncState;
};

/**
 * Pure. Assembles the summary field-by-field (never spreads a larger identity/auth/sync object)
 * so the allow-list above stays easy to audit at a glance.
 */
export function buildDiagnosticSummary(input: DiagnosticSummaryInput): DiagnosticSummary {
  return {
    appVersion: input.appVersion,
    buildNumber: input.buildNumber,
    platform: input.platform,
    osVersion: input.osVersion === undefined ? undefined : String(input.osVersion),
    appLanguage: input.appLanguage,
    authState: input.scopeKind === "user" ? "authenticated" : "guest",
    syncStatus: input.syncState.status,
    lastSuccessfulSyncAt: input.syncState.lastSuccessfulSyncAt,
    pendingDirtyCount: input.syncState.pendingDirtyCount,
    diagnosticCode: input.syncState.diagnosticCode,
  };
}

/** Pure. Plain-text, human-readable block suitable for pasting into an email or issue tracker. */
export function formatDiagnosticSummary(summary: DiagnosticSummary): string {
  const lines = [
    `App version: ${summary.appVersion}${summary.buildNumber ? ` (${summary.buildNumber})` : ""}`,
    `Platform: ${summary.platform}${summary.osVersion ? ` ${summary.osVersion}` : ""}`,
    `Language: ${summary.appLanguage}`,
    `Account: ${summary.authState}`,
    `Sync status: ${summary.syncStatus}`,
    `Last successful sync: ${summary.lastSuccessfulSyncAt ?? "never"}`,
    `Pending changes: ${summary.pendingDirtyCount}`,
  ];
  if (summary.diagnosticCode) {
    lines.push(`Diagnostic code: ${summary.diagnosticCode}`);
  }
  return lines.join("\n");
}

/**
 * Resolves a build number from whatever source is actually available, in priority order, and
 * omits the field entirely (undefined) when none is configured — never a placeholder that could
 * be mistaken for real data. app.json currently configures neither
 * expo.ios.buildNumber nor expo.android.versionCode (verified by reading the file), so today this
 * falls through to Constants.nativeBuildVersion (only present in a native build, not Expo Go) and
 * then to undefined.
 */
function resolveBuildNumber(): string | undefined {
  const iosBuildNumber = Constants.expoConfig?.ios?.buildNumber;
  if (iosBuildNumber) return iosBuildNumber;

  const androidVersionCode = Constants.expoConfig?.android?.versionCode;
  if (androidVersionCode !== undefined && androidVersionCode !== null) return String(androidVersionCode);

  const nativeBuildVersion = Constants.nativeBuildVersion;
  if (nativeBuildVersion) return nativeBuildVersion;

  return undefined;
}

/**
 * Thin wrapper: gathers the real app/device/account/sync values from their respective modules
 * (expo-constants, react-native's Platform, src/i18n, AuthService, syncState) and hands them to
 * the pure builder above. This is the only part of the file that touches globals — kept separate
 * so the coordinator can unit-test buildDiagnosticSummary/formatDiagnosticSummary in isolation.
 */
export async function gatherDiagnosticSummary(): Promise<DiagnosticSummary> {
  const scope = await AuthService.getActiveScope();
  return buildDiagnosticSummary({
    appVersion: Constants.expoConfig?.version ?? "—",
    buildNumber: resolveBuildNumber(),
    platform: Platform.OS,
    osVersion: Platform.Version,
    appLanguage: getI18nState().language,
    scopeKind: scope.kind,
    syncState: getSyncState(),
  });
}
