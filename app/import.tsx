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
import { colors, iconSizes, spacing, typography } from "../src/ui/theme";

export default function ImportDeckScreen() {
  const router = useRouter();
  const { t } = useTranslation();
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
    setSelectedFile({ name: asset.name ?? "deck.briefly", uri: asset.uri });
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

      const newDeckId = await importDeckFromJson(cleaned);
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
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          accessibilityLabel={t("common.back")}
          onPress={() => router.back()}
          disabled={busy}
        />
        <Text style={typography.title}>{t("importDeck.screenTitle")}</Text>
      </View>
      <Text style={typography.secondary}>{t("importDeck.subtitle")}</Text>

      <Card style={styles.fileCard}>
        <View style={styles.fileRow}>
          <Ionicons
            name={selectedFile ? "document-text-outline" : "cloud-upload-outline"}
            size={iconSizes.lg}
            color={colors.accentStrong}
          />
          <View style={styles.flex1}>
            <Text style={typography.bodyMedium} numberOfLines={1}>
              {selectedFile ? selectedFile.name : t("importDeck.noFileSelected")}
            </Text>
            {selectedFile ? <Text style={styles.readyText}>{t("importDeck.readyToImport")}</Text> : null}
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
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  fileCard: { gap: spacing.md },
  fileRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  flex1: { flex: 1 },
  readyText: { ...typography.caption, color: colors.success, marginTop: 2 },
});
