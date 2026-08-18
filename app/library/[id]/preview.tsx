import Pdf from "react-native-pdf";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import {
  openSourceOriginal,
  resolveSourceOriginal,
  type OpenSourceErrorReason,
  type OpenSourceStage,
} from "../../../src/cloud/librarySourceStorage/openSource";
import { prepareViewerInput } from "../../../src/domain/sourceViewer";
import { resolveSourcePreviewStrategy } from "../../../src/domain/sourcePreview";
import { useTranslation } from "../../../src/i18n";
import type { LibrarySourceRecord } from "../../../src/models/librarySource";
import { getLibrarySources } from "../../../src/storage/librarySources";
import { Button } from "../../../src/ui/Button";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";
import { useTheme } from "@/src/theme";

type PreviewStatus = "loading" | "ready" | "error";

function openFailedBodyKey(reason: OpenSourceErrorReason): string {
  switch (reason) {
    case "offline-no-local":
      return "librarySource.detail.openFailedOfflineBody";
    case "access-denied":
      return "librarySource.detail.openFailedAccessDeniedBody";
    case "not-found":
      return "librarySource.detail.openFailedNotFoundBody";
    case "download-failed":
      return "librarySource.detail.openFailedDownloadBody";
    case "unsupported-viewer":
      return "librarySource.detail.openFailedUnsupportedBody";
    case "handoff-failed":
      return "librarySource.detail.openFailedHandoffBody";
    case "unavailable":
    default:
      return "librarySource.detail.openFailedGenericBody";
  }
}

export default function LibrarySourcePreviewScreen() {
  const router = useRouter();
  const { t, plural } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const params = useLocalSearchParams();
  const idParam = params.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? idParam[0] : "";

  const [source, setSource] = useState<LibrarySourceRecord | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [status, setStatus] = useState<PreviewStatus>("loading");
  const [stage, setStage] = useState<Exclude<OpenSourceStage, "opening">>("resolving");
  const [openingOriginal, setOpeningOriginal] = useState(false);
  const [pageLabel, setPageLabel] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace({ pathname: "/library/[id]" as any, params: { id } });
  }, [id, router]);

  const load = useCallback(async () => {
    if (!id) {
      setStatus("error");
      return;
    }

    setStatus("loading");
    setStage("resolving");
    setPageLabel(null);

    const scope = await AuthService.getActiveScope();
    const sources = await getLibrarySources(scope);
    const found = sources.find((item) => item.id === id) ?? null;
    setSource(found);

    if (!found || resolveSourcePreviewStrategy(found).kind !== "embedded-pdf") {
      setStatus("error");
      return;
    }

    const resolved = await resolveSourceOriginal(found, setStage);
    if (resolved.status === "error") {
      setStatus("error");
      return;
    }

    const input = await prepareViewerInput(resolved.uri, found);
    setPreviewUri(input.uri);
    setStatus("ready");
  }, [id]);

  useEffect(() => {
    let alive = true;
    load().catch(() => {
      if (alive) setStatus("error");
    });
    return () => {
      alive = false;
    };
  }, [load]);

  const onOpenOriginal = async () => {
    if (!source || openingOriginal) return;
    setOpeningOriginal(true);
    try {
      const outcome = await openSourceOriginal(source);
      if (outcome.status === "error") {
        Alert.alert(t("librarySource.detail.openFailedTitle"), t(openFailedBodyKey(outcome.reason) as any));
      }
    } finally {
      setOpeningOriginal(false);
    }
  };

  const loadingText =
    stage === "downloading" ? t("librarySource.preview.downloading") : t("librarySource.preview.loading");

  return (
    <Screen>
      <View style={[styles.container, { gap: spacing.md }]}>
        <View style={[styles.header, { gap: spacing.sm }]}>
          <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={goBack} />
          <View style={styles.headerText}>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("librarySource.preview.title")}</Text>
            <Text style={[typography.title, { color: colors.textPrimary }]} numberOfLines={1} accessibilityRole="header">
              {source?.displayTitle ?? t("librarySource.detail.loading")}
            </Text>
          </View>
        </View>

        <View style={[styles.viewer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {status === "loading" ? (
            <View style={styles.centered}>
              <Text style={[typography.secondary, { color: colors.textSecondary }]}>{loadingText}</Text>
            </View>
          ) : status === "ready" && previewUri ? (
            <Pdf
              source={{ uri: previewUri, cache: false }}
              style={styles.pdf}
              trustAllCerts={false}
              onLoadComplete={(numberOfPages) => {
                setPageLabel(plural("librarySource.preview.pageCount", numberOfPages));
              }}
              onPageChanged={(page, numberOfPages) => {
                setPageLabel(t("librarySource.preview.pageProgress", { page, count: numberOfPages }));
              }}
              onError={() => {
                setStatus("error");
              }}
            />
          ) : (
            <View style={[styles.centered, { gap: spacing.sm }]}>
              <Text style={[typography.subheading, { color: colors.textPrimary }]}>{t("librarySource.preview.errorTitle")}</Text>
              <Text style={[typography.secondary, styles.errorText, { color: colors.textSecondary }]}>
                {t("librarySource.preview.errorBody")}
              </Text>
              <Button label={t("librarySource.preview.retryButton")} variant="secondary" onPress={load} />
            </View>
          )}
        </View>

        <View style={[styles.footer, { gap: spacing.sm }]}>
          {pageLabel ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{pageLabel}</Text> : <View />}
          {source ? (
            <Button
              label={t("librarySource.detail.openOriginalButton")}
              variant="secondary"
              loading={openingOriginal}
              disabled={openingOriginal}
              onPress={onOpenOriginal}
            />
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center" },
  headerText: { flex: 1 },
  viewer: { flex: 1, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderRadius: 8 },
  pdf: { flex: 1, width: "100%", height: "100%" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { textAlign: "center" },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
