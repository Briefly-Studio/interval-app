import Pdf from "react-native-pdf";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import {
  openSourceOriginal,
  resolveSourceOriginal,
  type OpenSourceErrorReason,
  type OpenSourceStage,
} from "../../../src/cloud/librarySourceStorage/openSource";
import { prepareViewerInput } from "../../../src/domain/sourceViewer";
import { chunkTextPreviewContent, inspectTextPreviewFile } from "../../../src/domain/sourcePreviewText";
import { resolveSourcePreviewStrategy, type SourcePreviewStrategy } from "../../../src/domain/sourcePreview";
import { useTranslation } from "../../../src/i18n";
import type { LibrarySourceRecord } from "../../../src/models/librarySource";
import { getLibrarySources } from "../../../src/storage/librarySources";
import { Button } from "../../../src/ui/Button";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";
import { useTheme } from "@/src/theme";

type EmbeddedPreviewKind = Extract<SourcePreviewStrategy["kind"], "embedded-pdf" | "embedded-image" | "embedded-text">;
type PreviewStatus = "loading" | "ready" | "error" | "too-large";

function logSourcePreview(stage: string, detail?: Record<string, unknown>): void {
  if (!__DEV__) return;
  if (detail && Object.keys(detail).length > 0) {
    console.log(`[LibrarySourcePreview] ${stage}`, detail);
  } else {
    console.log(`[LibrarySourcePreview] ${stage}`);
  }
}

function safeErrorDetail(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function uriScheme(uri: string): string {
  const match = uri.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  return match ? `${match[1]}://` : "unknown";
}

function inspectLocalPreviewFile(uri: string): { exists: boolean; size?: number } {
  try {
    const file = new File(uri);
    return file.exists ? { exists: true, size: file.size } : { exists: false };
  } catch (error) {
    logSourcePreview("file inspect failed", { error: safeErrorDetail(error) });
    return { exists: false };
  }
}

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
  const [previewKind, setPreviewKind] = useState<EmbeddedPreviewKind | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
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
    setPreviewUri(null);
    setPreviewKind(null);
    setTextContent(null);

    const scope = await AuthService.getActiveScope();
    const sources = await getLibrarySources(scope);
    const found = sources.find((item) => item.id === id) ?? null;
    setSource(found);

    const strategy = found ? resolveSourcePreviewStrategy(found) : { kind: "unsupported" as const };
    if (
      !found ||
      (strategy.kind !== "embedded-pdf" && strategy.kind !== "embedded-image" && strategy.kind !== "embedded-text")
    ) {
      setStatus("error");
      return;
    }

    const resolved = await resolveSourceOriginal(found, setStage);
    if (resolved.status === "error") {
      setStatus("error");
      return;
    }

    const input = await prepareViewerInput(resolved.uri, found);
    const file = inspectLocalPreviewFile(input.uri);
    logSourcePreview("prepared input", {
      sourceType: found.sourceType,
      strategy: strategy.kind,
      uriScheme: uriScheme(input.uri),
      usedStagedCopy: input.usedStagedCopy,
      extension: input.extension,
      exists: file.exists,
      size: file.size,
    });
    if (!input.usedStagedCopy || !input.extension || !file.exists || file.size === undefined) {
      setStatus("error");
      return;
    }
    if (strategy.kind !== "embedded-text" && file.size <= 0) {
      setStatus("error");
      return;
    }
    if (strategy.kind === "embedded-text") {
      const textInspection = inspectTextPreviewFile(file);
      if (textInspection.status === "missing") {
        setStatus("error");
        return;
      }
      if (textInspection.status === "too-large") {
        setStatus("too-large");
        return;
      }
      try {
        const text = await FileSystem.readAsStringAsync(input.uri, { encoding: FileSystem.EncodingType.UTF8 });
        setTextContent(text);
      } catch (error) {
        logSourcePreview("text read failed", { error: safeErrorDetail(error) });
        setStatus("error");
        return;
      }
    }
    setPreviewUri(input.uri);
    setPreviewKind(strategy.kind);
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
            previewKind === "embedded-pdf" ? (
              <Pdf
                source={{ uri: previewUri, cache: false }}
                style={styles.pdf}
                trustAllCerts={false}
                onLoadComplete={(numberOfPages) => {
                  logSourcePreview("pdf load complete", { pages: numberOfPages });
                  setPageLabel(plural("librarySource.preview.pageCount", numberOfPages));
                }}
                onPageChanged={(page, numberOfPages) => {
                  logSourcePreview("pdf page changed", { page, pages: numberOfPages });
                  setPageLabel(t("librarySource.preview.pageProgress", { page, count: numberOfPages }));
                }}
                onError={(error) => {
                  logSourcePreview("pdf render error", { error: safeErrorDetail(error) });
                  setStatus("error");
                }}
              />
            ) : previewKind === "embedded-image" ? (
              <Image
                source={{ uri: previewUri }}
                style={styles.image}
                contentFit="contain"
                transition={120}
                onLoad={() => {
                  logSourcePreview("image load complete", { uriScheme: uriScheme(previewUri) });
                }}
                onError={(error) => {
                  logSourcePreview("image render error", { error: safeErrorDetail(error) });
                  setStatus("error");
                }}
              />
            ) : (
              <ScrollView style={styles.textScroll} contentContainerStyle={[styles.textContent, { padding: spacing.md }]}>
                {textContent ? (
                  chunkTextPreviewContent(textContent).map((chunk, index) => (
                    <Text key={index} style={[typography.body, styles.previewText, { color: colors.textPrimary }]}>
                      {chunk}
                    </Text>
                  ))
                ) : (
                  <Text style={[typography.secondary, styles.emptyText, { color: colors.textSecondary }]}>
                    {t("librarySource.preview.emptyTextBody")}
                  </Text>
                )}
              </ScrollView>
            )
          ) : (
            <View style={[styles.centered, { gap: spacing.sm }]}>
              <Text style={[typography.subheading, { color: colors.textPrimary }]}>
                {status === "too-large" ? t("librarySource.preview.tooLargeTitle") : t("librarySource.preview.errorTitle")}
              </Text>
              <Text style={[typography.secondary, styles.errorText, { color: colors.textSecondary }]}>
                {status === "too-large" ? t("librarySource.preview.tooLargeBody") : t("librarySource.preview.errorBody")}
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
  image: { flex: 1, width: "100%", height: "100%" },
  textScroll: { flex: 1 },
  textContent: { flexGrow: 1 },
  previewText: { lineHeight: 23 },
  emptyText: { flex: 1, textAlign: "center", textAlignVertical: "center" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { textAlign: "center" },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
