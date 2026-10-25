import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../src/auth/AuthService";
import { parseDelimitedFlashcards } from "../../src/domain/import/csvTsvParser";
import { setImportDraftSession } from "../../src/domain/import/importDraftSession";
import { MAX_IMPORT_FILE_BYTES } from "../../src/domain/import/importLimits";
import { useTranslation } from "../../src/i18n";
import { Button } from "../../src/ui/Button";
import { Card } from "../../src/ui/Card";
import { IconButton } from "../../src/ui/IconButton";
import { Screen } from "../../src/ui/Screen";
import { useTheme } from "@/src/theme";

// Step 1 of the format-neutral import flow: Select file → Parse → (navigate to) Preview →
// Confirm → Save. This screen only picks and parses — it never writes anything (see
// docs/flashcard-import.md). A distinct screen/entry point from the existing `/import`
// (Interval's own .interval/.briefly JSON export format, src/domain/deckPortability.ts) — that
// importer is untouched by this feature.

function parseFailureCopyKey(code: string): string {
  switch (code) {
    case "empty-file":
      return "importFlashcards.errors.emptyFile";
    case "no-readable-rows":
      return "importFlashcards.errors.noReadableRows";
    default:
      return "importFlashcards.errors.generic";
  }
}

export default function ImportFlashcardsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, iconSizes, spacing, typography } = useTheme();
  const [selectedFile, setSelectedFile] = useState<{ name: string; uri: string; size?: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const canImport = !!selectedFile && !busy;

  const onChooseFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setSelectedFile({ name: asset.name ?? "import.csv", uri: asset.uri, size: asset.size });
  };

  const onImport = async () => {
    if (!canImport || !selectedFile) return;

    if (typeof selectedFile.size === "number" && selectedFile.size > MAX_IMPORT_FILE_BYTES) {
      Alert.alert(t("importFlashcards.failedTitle"), t("importFlashcards.errors.fileTooLarge"));
      return;
    }

    try {
      setBusy(true);
      const raw = await FileSystem.readAsStringAsync(selectedFile.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const result = parseDelimitedFlashcards(raw, { fileName: selectedFile.name });
      if (result.status === "failed") {
        Alert.alert(t("importFlashcards.failedTitle"), t(parseFailureCopyKey(result.failure.code) as any));
        return;
      }
      if (result.draft.cards.length === 0) {
        Alert.alert(t("importFlashcards.failedTitle"), t("importFlashcards.errors.noUsableCards"));
        return;
      }

      const scope = await AuthService.getActiveScope();
      setImportDraftSession(scope, result.draft);
      router.push({ pathname: "/import-flashcards/preview" as any });
    } catch (error) {
      console.log("[import-flashcards] failed to read file:", error instanceof Error ? error.message : "unknown error");
      Alert.alert(t("importFlashcards.failedTitle"), t("importFlashcards.errors.fileReadFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} disabled={busy} />
        <Text style={[typography.title, { color: colors.textPrimary }]} accessibilityRole="header">
          {t("importFlashcards.screenTitle")}
        </Text>
      </View>
      <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("importFlashcards.subtitle")}</Text>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("importFlashcards.formatNote")}</Text>

      <Card style={[styles.fileCard, { gap: spacing.md }]}>
        <View style={[styles.fileRow, { gap: spacing.sm }]}>
          <Ionicons
            name={selectedFile ? "document-text-outline" : "cloud-upload-outline"}
            size={iconSizes.lg}
            color={colors.accent}
          />
          <View style={styles.flex1}>
            <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={1}>
              {selectedFile ? selectedFile.name : t("importFlashcards.noFileSelected")}
            </Text>
            {selectedFile ? (
              <Text style={[typography.caption, { color: colors.success, marginTop: 2 }]}>
                {t("importFlashcards.readyToImport")}
              </Text>
            ) : null}
          </View>
        </View>
        <Button
          label={selectedFile ? t("importFlashcards.chooseDifferentFileButton") : t("importFlashcards.chooseFileButton")}
          variant="secondary"
          fullWidth
          onPress={onChooseFile}
          disabled={busy}
        />
      </Card>

      <Button
        label={t("importFlashcards.submitButton")}
        variant="primary"
        fullWidth
        loading={busy}
        disabled={!canImport}
        onPress={onImport}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  fileCard: {},
  fileRow: { flexDirection: "row", alignItems: "center" },
  flex1: { flex: 1 },
});
