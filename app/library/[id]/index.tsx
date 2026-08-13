import * as DocumentPicker from "expo-document-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import {
  attachAndUploadSourceFile,
  isLibrarySourceStorageEnabled,
  isSourceFileAvailableOnThisDevice,
  retryUploadSourceFile,
  verifyCloudSourceAccessible,
} from "../../../src/cloud/librarySourceStorage";
import {
  openSourceOriginal,
  type OpenSourceErrorReason,
  type OpenSourceStage,
} from "../../../src/cloud/librarySourceStorage/openSource";
import { formatAudioDuration, formatFileSize } from "../../../src/domain/librarySourceFormat";
import { SOURCE_TYPE_LABEL_KEYS, STATUS_LABEL_KEYS } from "../../../src/domain/librarySourceLabels";
import { useTranslation } from "../../../src/i18n";
import type { LibrarySourceRecord } from "../../../src/models/librarySource";
import type { SourceCollectionRecord } from "../../../src/models/sourceCollection";
import { archiveLibrarySource, getLibrarySources, restoreLibrarySource, softDeleteLibrarySource } from "../../../src/storage/librarySources";
import { getActiveSourceCollections } from "../../../src/storage/sourceCollections";
import { logLibraryFileAttach } from "../../../src/utils/libraryFileAttachLog";
import { useTheme } from "@/src/theme";
import { Button } from "../../../src/ui/Button";
import { Card } from "../../../src/ui/Card";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";

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

function DetailRow({ label, value }: { label: string; value: string }) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View style={{ gap: spacing.xs / 2 }}>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{value}</Text>
    </View>
  );
}

export default function LibrarySourceDetailScreen() {
  const router = useRouter();
  const { t, language } = useTranslation();
  const { colors, spacing, typography } = useTheme();

  const params = useLocalSearchParams();
  const idParam = params.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? idParam[0] : "";

  const [source, setSource] = useState<LibrarySourceRecord | null>(null);
  const [collections, setCollections] = useState<SourceCollectionRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [hasLocalFile, setHasLocalFile] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [openStage, setOpenStage] = useState<OpenSourceStage | null>(null);
  const storageEnabled = isLibrarySourceStorageEnabled();

  const load = useCallback(async () => {
    if (!id) return;
    const scope = await AuthService.getActiveScope();
    // hasLocalFile reflects real on-disk presence of Interval's own durable copy (see
    // src/storage/librarySourceFileStorage.ts), not merely a record in the local file map — this
    // is what lets Retry/Attach correctly detect a persisted copy that has since disappeared.
    const [all, cols, hasFile] = await Promise.all([
      getLibrarySources(scope),
      getActiveSourceCollections(scope),
      isSourceFileAvailableOnThisDevice(id),
    ]);
    setSource(all.find((s) => s.id === id) ?? null);
    setCollections(cols);
    setHasLocalFile(hasFile);
    setLoaded(true);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!alive) return;
        await load();
      })();
      return () => {
        alive = false;
      };
    }, [load])
  );

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/library");
  };

  const onArchive = async () => {
    if (!source || mutating) return;
    setMutating(true);
    try {
      const scope = await AuthService.getActiveScope();
      await archiveLibrarySource(scope, source.id);
      await load();
    } catch {
      Alert.alert(t("librarySource.detail.actionFailedTitle"), t("librarySource.detail.actionFailedBody"));
    } finally {
      setMutating(false);
    }
  };

  const onRestore = async () => {
    if (!source || mutating) return;
    setMutating(true);
    try {
      const scope = await AuthService.getActiveScope();
      await restoreLibrarySource(scope, source.id);
      await load();
    } catch {
      Alert.alert(t("librarySource.detail.actionFailedTitle"), t("librarySource.detail.actionFailedBody"));
    } finally {
      setMutating(false);
    }
  };

  const onAttachFile = async () => {
    if (!source || fileBusy) return;
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    logLibraryFileAttach("detail.tsx: picker result", {
      canceled: result.canceled,
      assetCount: result.canceled ? 0 : (result.assets?.length ?? 0),
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    logLibraryFileAttach("detail.tsx: picker asset", {
      uriPresent: !!asset.uri,
      mimeTypePresent: !!asset.mimeType,
    });
    setFileBusy(true);
    try {
      const scope = await AuthService.getActiveScope();
      logLibraryFileAttach("detail.tsx: calling attachAndUploadSourceFile");
      const attached = await attachAndUploadSourceFile(scope, source.id, { uri: asset.uri, mimeType: asset.mimeType });
      logLibraryFileAttach("detail.tsx: attach result", { attached });
      if (!attached) {
        Alert.alert(t("librarySource.detail.actionFailedTitle"), t("librarySource.detail.actionFailedBody"));
      }
      await load();
    } catch (error) {
      if (__DEV__) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        console.warn(`[LibraryFileAttach] detail.tsx: onAttachFile threw — ${detail}`);
      }
      Alert.alert(t("librarySource.detail.actionFailedTitle"), t("librarySource.detail.actionFailedBody"));
    } finally {
      setFileBusy(false);
    }
  };

  const onRetryUpload = async () => {
    if (!source || fileBusy) return;
    setFileBusy(true);
    try {
      const scope = await AuthService.getActiveScope();
      logLibraryFileAttach("detail.tsx: calling retryUploadSourceFile");
      const retried = await retryUploadSourceFile(scope, source.id);
      logLibraryFileAttach("detail.tsx: retry result", { retried });
      await load();
    } catch (error) {
      if (__DEV__) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        console.warn(`[LibraryFileAttach] detail.tsx: onRetryUpload threw — ${detail}`);
      }
      Alert.alert(t("librarySource.detail.actionFailedTitle"), t("librarySource.detail.actionFailedBody"));
    } finally {
      setFileBusy(false);
    }
  };

  const onVerifyCloudAccess = async () => {
    if (!source || fileBusy) return;
    setFileBusy(true);
    try {
      const ok = await verifyCloudSourceAccessible(source.id);
      if (ok) {
        Alert.alert(t("librarySource.detail.originalFileVerifiedTitle"), t("librarySource.detail.originalFileVerifiedBody"));
      } else {
        Alert.alert(
          t("librarySource.detail.originalFileVerifyFailedTitle"),
          t("librarySource.detail.originalFileVerifyFailedBody")
        );
      }
    } finally {
      setFileBusy(false);
    }
  };

  const onOpenOriginal = async () => {
    if (!source || fileBusy) return;
    setFileBusy(true);
    setOpenStage("resolving");
    try {
      const outcome = await openSourceOriginal(source, setOpenStage);
      if (outcome.status === "error") {
        Alert.alert(t("librarySource.detail.openFailedTitle"), t(openFailedBodyKey(outcome.reason) as any));
      }
      // A cloud fallback download may have just made a local copy durable — refresh hasLocalFile
      // so the rest of this screen (Verify button visibility, future Retry/Open state) reflects it.
      await load();
    } finally {
      setOpenStage(null);
      setFileBusy(false);
    }
  };

  const confirmDelete = () => {
    if (!source || mutating) return;
    Alert.alert(t("librarySource.detail.deleteTitle"), t("librarySource.detail.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("librarySource.detail.deleteAction"),
        style: "destructive",
        onPress: async () => {
          setMutating(true);
          try {
            const scope = await AuthService.getActiveScope();
            await softDeleteLibrarySource(scope, source.id);
            goBack();
          } catch {
            Alert.alert(t("librarySource.detail.actionFailedTitle"), t("librarySource.detail.actionFailedBody"));
          } finally {
            setMutating(false);
          }
        },
      },
    ]);
  };

  if (!loaded) {
    return (
      <Screen>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("librarySource.detail.loading")}</Text>
      </Screen>
    );
  }

  if (!source) {
    return (
      <Screen>
        <View style={[styles.header, { gap: spacing.sm }]}>
          <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={goBack} />
        </View>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("librarySource.detail.notFound")}</Text>
      </Screen>
    );
  }

  const collectionNames = source.collectionIds
    .map((cid) => collections.find((c) => c.id === cid)?.name)
    .filter((name): name is string => !!name);

  const sizeLabel = formatFileSize(source.fileSize);
  const durationLabel = formatAudioDuration(source.audioDuration);

  // IMPORTANT PRODUCT RULE: openability is independent of upload state — a source with a local
  // copy but cloudUploadState "pending"/"failed" must still be openable on this device. Never
  // gate this on cloudUploadState === "uploaded" alone (see
  // docs/library-and-source-architecture.md's "Source open/preview" section).
  const canOpenOriginal = hasLocalFile || source.cloudUploadState === "uploaded";
  const openButtonLabel =
    fileBusy && openStage === "downloading"
      ? t("librarySource.detail.downloadingOriginal")
      : fileBusy && openStage
        ? t("librarySource.detail.preparingSource")
        : t("librarySource.detail.openOriginalButton");

  return (
    <Screen scroll>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={goBack} />
        <Text style={[typography.title, styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1} accessibilityRole="header">
          {source.displayTitle}
        </Text>
      </View>

      {source.archivedAt ? (
        <Text style={[typography.caption, styles.stateBadge, { color: colors.accent }]}>{t(STATUS_LABEL_KEYS.archived)}</Text>
      ) : source.processingStatus === "needsReview" ? (
        <Text style={[typography.caption, styles.stateBadge, { color: colors.accent }]}>{t(STATUS_LABEL_KEYS.needsReview)}</Text>
      ) : null}

      <Card style={[styles.detailCard, { gap: spacing.md }]}>
        <DetailRow label={t("librarySource.detail.fullTitleLabel")} value={source.displayTitle} />
        <DetailRow label={t("librarySource.detail.typeLabel")} value={t(SOURCE_TYPE_LABEL_KEYS[source.sourceType])} />
        {source.originalName ? <DetailRow label={t("librarySource.detail.originalNameLabel")} value={source.originalName} /> : null}
        {sizeLabel ? <DetailRow label={t("librarySource.detail.sizeLabel")} value={sizeLabel} /> : null}
        <DetailRow label={t("librarySource.detail.addedLabel")} value={new Date(source.createdAt).toLocaleDateString(language)} />
        {source.lastUsedAt ? (
          <DetailRow label={t("librarySource.detail.lastUsedLabel")} value={new Date(source.lastUsedAt).toLocaleDateString(language)} />
        ) : null}
        {collectionNames.length > 0 ? (
          <DetailRow label={t("librarySource.detail.collectionsLabel")} value={collectionNames.join(", ")} />
        ) : null}
        {source.tags.length > 0 ? <DetailRow label={t("librarySource.detail.tagsLabel")} value={source.tags.join(", ")} /> : null}
        {source.course ? <DetailRow label={t("librarySource.detail.courseLabel")} value={source.course} /> : null}
        {source.semester ? <DetailRow label={t("librarySource.detail.semesterLabel")} value={source.semester} /> : null}
        {source.sourceLanguage ? <DetailRow label={t("librarySource.detail.languageLabel")} value={source.sourceLanguage} /> : null}
        {source.pageCount ? <DetailRow label={t("librarySource.detail.pageCountLabel")} value={String(source.pageCount)} /> : null}
        {source.slideCount ? <DetailRow label={t("librarySource.detail.slideCountLabel")} value={String(source.slideCount)} /> : null}
        {source.sheetCount ? <DetailRow label={t("librarySource.detail.sheetCountLabel")} value={String(source.sheetCount)} /> : null}
        {durationLabel ? <DetailRow label={t("librarySource.detail.durationLabel")} value={durationLabel} /> : null}
      </Card>

      {!source.cloudUploadState ? (
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("librarySource.detail.localOnlyNote")}</Text>
      ) : null}

      {storageEnabled ? (
        <Card style={[styles.detailCard, { gap: spacing.sm }]}>
          <Text style={[typography.subheading, { color: colors.textPrimary }]}>
            {t("librarySource.detail.originalFileHeading")}
          </Text>

          {canOpenOriginal ? (
            <Button
              label={openButtonLabel}
              variant="primary"
              fullWidth
              loading={fileBusy && !!openStage}
              disabled={fileBusy && !openStage}
              onPress={onOpenOriginal}
            />
          ) : null}

          {!source.cloudUploadState ? (
            <>
              <Text style={[typography.secondary, { color: colors.textSecondary }]}>
                {t("librarySource.detail.originalFileNotAttached")}
              </Text>
              <Button
                label={t("librarySource.detail.originalFileAttachButton")}
                variant="secondary"
                fullWidth
                loading={fileBusy}
                onPress={onAttachFile}
              />
            </>
          ) : null}

          {source.cloudUploadState === "pending" ? (
            <Text style={[typography.secondary, { color: colors.textSecondary }]}>
              {t("librarySource.detail.originalFilePending")}
            </Text>
          ) : null}

          {source.cloudUploadState === "uploaded" ? (
            <>
              <Text style={[typography.secondary, { color: colors.success }]}>
                {t("librarySource.detail.originalFileUploaded")}
              </Text>
              {!hasLocalFile ? (
                <Button
                  label={t("librarySource.detail.originalFileVerifyButton")}
                  variant="secondary"
                  fullWidth
                  loading={fileBusy}
                  onPress={onVerifyCloudAccess}
                />
              ) : null}
            </>
          ) : null}

          {source.cloudUploadState === "failed" ? (
            <>
              <Text style={[typography.secondary, { color: colors.textSecondary }]}>
                {t("librarySource.detail.originalFileFailed")}
              </Text>
              {hasLocalFile ? (
                <Button
                  label={t("librarySource.detail.originalFileRetryButton")}
                  variant="secondary"
                  fullWidth
                  loading={fileBusy}
                  onPress={onRetryUpload}
                />
              ) : (
                <>
                  <Text style={[typography.caption, { color: colors.textSecondary }]}>
                    {t("librarySource.detail.originalFileUnavailableOnDevice")}
                  </Text>
                  <Button
                    label={t("librarySource.detail.originalFileAttachButton")}
                    variant="secondary"
                    fullWidth
                    loading={fileBusy}
                    onPress={onAttachFile}
                  />
                </>
              )}
            </>
          ) : null}
        </Card>
      ) : null}

      <Text style={[typography.subheading, { color: colors.textPrimary }]}>{t("librarySource.detail.actionsHeading")}</Text>
      <View style={[styles.actions, { gap: spacing.sm }]}>
        <Button
          label={t("librarySource.detail.editAction")}
          variant="secondary"
          fullWidth
          disabled={mutating}
          onPress={() => router.push({ pathname: "/library/[id]/edit" as any, params: { id: source.id } })}
        />
        <Button
          label={t("librarySource.detail.assignCollectionAction")}
          variant="secondary"
          fullWidth
          disabled={mutating}
          onPress={() => router.push({ pathname: "/library/[id]/collections" as any, params: { id: source.id } })}
        />
        {source.archivedAt ? (
          <Button label={t("librarySource.detail.restoreAction")} variant="secondary" fullWidth loading={mutating} onPress={onRestore} />
        ) : (
          <Button label={t("librarySource.detail.archiveAction")} variant="secondary" fullWidth loading={mutating} onPress={onArchive} />
        )}
        <Button label={t("librarySource.detail.deleteAction")} variant="danger" fullWidth disabled={mutating} onPress={confirmDelete} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  headerTitle: { flex: 1 },
  stateBadge: { fontWeight: "700" },
  detailCard: {},
  actions: {},
});
