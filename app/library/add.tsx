import { useFocusEffect } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../src/auth/AuthService";
import { attachAndUploadSourceFile, isLibrarySourceStorageEnabled } from "../../src/cloud/librarySourceStorage";
import { EMPTY_SOURCE_FORM_VALUES, toSourcePatch, type SourceFormValues } from "../../src/domain/sourceFormValues";
import { detectSourceTypeFromFile, extensionFromFileName } from "../../src/domain/sourceTypeDetection";
import { useTranslation } from "../../src/i18n";
import { makeId } from "../../src/models/deck";
import type { LibrarySource } from "../../src/models/librarySource";
import type { SourceCollectionRecord } from "../../src/models/sourceCollection";
import { addLibrarySource } from "../../src/storage/librarySources";
import { getActiveSourceCollections } from "../../src/storage/sourceCollections";
import { logLibraryFileAttach } from "../../src/utils/libraryFileAttachLog";
import { useTheme } from "@/src/theme";
import { Button } from "../../src/ui/Button";
import { Card } from "../../src/ui/Card";
import { IconButton } from "../../src/ui/IconButton";
import { Screen } from "../../src/ui/Screen";
import { SourceDetailsFields } from "../../src/ui/SourceDetailsFields";

export default function AddLibrarySourceScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();

  const [values, setValues] = useState<SourceFormValues>(EMPTY_SOURCE_FORM_VALUES);
  const [titleTouched, setTitleTouched] = useState(false);
  const [collections, setCollections] = useState<SourceCollectionRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [pickedFile, setPickedFile] = useState<
    { uri: string; name: string; mimeType?: string; size?: number; extension?: string } | null
  >(null);
  // True once a picked file's type was confidently detected from its MIME type/extension (see
  // src/domain/sourceTypeDetection.ts) — locks the type chips so the declared sourceType can never
  // be manually set to contradict the actual attached file (the exact founder-QA-reported bug:
  // picking a .docx while leaving "PDF" selected). Stays false for a file whose type can't be
  // confidently detected, in which case manual selection remains the source of truth as before.
  const [typeLockedByFile, setTypeLockedByFile] = useState(false);
  const storageEnabled = isLibrarySourceStorageEnabled();

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const scope = await AuthService.getActiveScope();
        const cols = await getActiveSourceCollections(scope);
        if (alive) setCollections(cols);
      })();
      return () => {
        alive = false;
      };
    }, [])
  );

  const isValid = values.displayTitle.trim().length > 0;

  const onPickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    logLibraryFileAttach("add.tsx: picker result", {
      canceled: result.canceled,
      assetCount: result.canceled ? 0 : (result.assets?.length ?? 0),
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    logLibraryFileAttach("add.tsx: picker asset", {
      uriPresent: !!asset.uri,
      mimeTypePresent: !!asset.mimeType,
    });
    const extension = extensionFromFileName(asset.name);
    const detectedType = detectSourceTypeFromFile({ mimeType: asset.mimeType, extension });
    setPickedFile({ uri: asset.uri, name: asset.name ?? "", mimeType: asset.mimeType, size: asset.size, extension });
    setTypeLockedByFile(!!detectedType);
    setValues((prev) => ({
      ...prev,
      originalName: asset.name || prev.originalName,
      fileSizeMB:
        typeof asset.size === "number" ? String(Math.round((asset.size / (1024 * 1024)) * 100) / 100) : prev.fileSizeMB,
      sourceType: detectedType ?? prev.sourceType,
    }));
  };

  const onSave = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const source: LibrarySource = {
        id: makeId(),
        createdAt: now,
        processingStatus: "ready",
        lastUsedAt: undefined,
        ...toSourcePatch(values),
        mimeType: pickedFile?.mimeType,
        extension: pickedFile?.extension,
      };
      const scope = await AuthService.getActiveScope();
      await addLibrarySource(scope, source);
      logLibraryFileAttach("add.tsx: source metadata saved");
      if (storageEnabled && pickedFile) {
        logLibraryFileAttach("add.tsx: calling attachAndUploadSourceFile");
        // Awaited here: this only copies the file into Interval's own durable local directory
        // (fast, local disk, no network) — never the network upload attempt itself, which
        // attachAndUploadSourceFile still runs in the background without blocking on it. This
        // must be awaited so a failed durable copy can be surfaced to the user before navigating
        // away — see src/cloud/librarySourceStorage/index.ts's return-value contract. The source
        // metadata record above is never rolled back if this fails; only the attachment failed.
        const attached = await attachAndUploadSourceFile(scope, source.id, {
          uri: pickedFile.uri,
          mimeType: pickedFile.mimeType,
        });
        logLibraryFileAttach("add.tsx: attach result", { attached });
        if (!attached) {
          Alert.alert(t("librarySource.form.attachFailedTitle"), t("librarySource.form.attachFailedBody"));
        }
      }
      router.back();
    } catch (error) {
      // Never log title/tags/course/semester — only a diagnostic tag. Values stay in the form so
      // the user doesn't have to retype anything after a failed save.
      console.error("[library-add] failed to save source details");
      if (__DEV__) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        console.warn(`[LibraryFileAttach] add.tsx: onSave threw — ${detail}`);
      }
      Alert.alert(t("librarySource.form.saveFailedTitle"), t("librarySource.form.saveFailedBody"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.cancel")} onPress={() => router.back()} disabled={submitting} />
        <Text style={[typography.title, styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1} accessibilityRole="header">
          {t("librarySource.form.addScreenTitle")}
        </Text>
      </View>
      <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("librarySource.form.addIntro")}</Text>

      {storageEnabled ? (
        <Card style={[styles.attachCard, { gap: spacing.sm }]}>
          <Text style={[typography.subheading, { color: colors.textPrimary }]}>
            {t("librarySource.form.attachFileHeading")}
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t("librarySource.form.attachFileNote")}
          </Text>
          <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={1}>
            {pickedFile ? pickedFile.name : t("librarySource.form.noFileAttached")}
          </Text>
          <Button
            label={pickedFile ? t("librarySource.form.replaceFileButton") : t("librarySource.form.attachFileButton")}
            variant="secondary"
            fullWidth
            disabled={submitting}
            onPress={onPickFile}
          />
        </Card>
      ) : null}

      <SourceDetailsFields
        values={values}
        onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
        collections={collections}
        titleTouched={titleTouched}
        onTitleBlur={() => setTitleTouched(true)}
        editable={!submitting}
        sourceTypeLocked={typeLockedByFile}
      />

      <Button
        label={t("librarySource.form.saveButton")}
        variant="primary"
        fullWidth
        loading={submitting}
        disabled={!isValid}
        onPress={onSave}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  headerTitle: { flex: 1 },
  attachCard: {},
});
