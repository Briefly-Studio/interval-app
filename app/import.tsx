import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { importDeckFromJson } from "../src/domain/deckPortability";
import { useTranslation } from "../src/i18n";
import { Button } from "../src/ui/Button";
import { Card } from "../src/ui/Card";
import { IconButton } from "../src/ui/IconButton";
import { Screen } from "../src/ui/Screen";
import { useTheme } from "@/src/theme";

export default function ImportDeckScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, iconSizes, spacing, typography } = useTheme();
  const [selectedFile, setSelectedFile] = useState<{ name: string; uri: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  const canImport = !!selectedFile && !busy;

  const onChooseFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    setSelectedFile({ name: asset.name ?? "deck.interval", uri: asset.uri });
  };

  const onImport = async () => {
    if (!canImport) return;
    const file = selectedFile;
    if (!file) return;
    try {
      setBusy(true);
      const raw = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const cleaned = raw.replace(/^\uFEFF/, "").trim();
      const parsed = JSON.parse(cleaned);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !("version" in parsed) ||
        !("deck" in parsed) ||
        !("cards" in parsed) ||
        !Array.isArray((parsed as { cards?: unknown }).cards)
      ) {
        throw new Error(t("importDeck.invalidFileError"));
      }

      const newDeckId = await importDeckFromJson(cleaned, t);
      Alert.alert(t("importDeck.importedTitle"), t("importDeck.importedBody"));
      router.replace(`/deck/${newDeckId}`);
    } catch (error) {
      // deckPortability's own errors are already friendly, user-facing strings — logging just
      // the message (not the full Error/stack) keeps this out of "diagnostic leakage" territory.
      console.log("[import] failed:", error instanceof Error ? error.message : "unknown error");
      Alert.alert(
        t("importDeck.failedTitle"),
        error instanceof Error ? error.message : t("importDeck.failedGenericBody")
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton
          name="chevron-back"
          accessibilityLabel={t("common.back")}
          onPress={() => router.back()}
          disabled={busy}
        />
        <Text style={[typography.title, { color: colors.textPrimary }]} accessibilityRole="header">{t("importDeck.screenTitle")}</Text>
      </View>
      <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("importDeck.subtitle")}</Text>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("importDeck.legacyNote")}</Text>

      <Card style={[styles.fileCard, { gap: spacing.md }]}>
        <View style={[styles.fileRow, { gap: spacing.sm }]}>
          <Ionicons
            name={selectedFile ? "document-text-outline" : "cloud-upload-outline"}
            size={iconSizes.lg}
            color={colors.accent}
          />
          <View style={styles.flex1}>
            <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={1}>
              {selectedFile ? selectedFile.name : t("importDeck.noFileSelected")}
            </Text>
            {selectedFile ? (
              <Text style={[typography.caption, { color: colors.success, marginTop: 2 }]}>
                {t("importDeck.readyToImport")}
              </Text>
            ) : null}
          </View>
        </View>
        <Button
          label={selectedFile ? t("importDeck.chooseDifferentFileButton") : t("importDeck.chooseFileButton")}
          variant="secondary"
          fullWidth
          onPress={onChooseFile}
          disabled={busy}
        />
      </Card>

      <Button
        label={t("importDeck.submitButton")}
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
