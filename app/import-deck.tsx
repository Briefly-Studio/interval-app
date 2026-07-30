import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { importDeckFromJson } from "../src/domain/deckPortability";
import { useTranslation } from "../src/i18n";

const APP_BG = "#2FA4A3";

export default function ImportDeckScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [payload, setPayload] = useState("");

  const canImport = payload.trim().length > 0;

  const onPaste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      setPayload(text);
    } catch {
      Alert.alert(t("importDeckLegacy.clipboardUnavailableTitle"), t("importDeckLegacy.clipboardUnavailableBody"));
    }
  };

  const onImport = async () => {
    if (!canImport) {
      Alert.alert(t("importDeckLegacy.nothingToImportTitle"), t("importDeckLegacy.nothingToImportBody"));
      return;
    }

    try {
      const deckId = await importDeckFromJson(payload.trim());
      router.replace(`/deck/${deckId}`);
    } catch (error) {
      Alert.alert(
        t("importDeckLegacy.failedTitle"),
        error instanceof Error ? error.message : t("importDeckLegacy.failedGenericBody")
      );
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={styles.pill}>
          <Text style={styles.pillText}>{t("importDeckLegacy.backLabel")}</Text>
        </Pressable>

        <Pressable
          onPress={onImport}
          disabled={!canImport}
          style={[styles.primary, !canImport && { opacity: 0.5 }]}
        >
          <Text style={styles.primaryText}>{t("importDeckLegacy.importButton")}</Text>
        </Pressable>
      </View>

      <Text style={styles.title}>{t("importDeckLegacy.screenTitle")}</Text>

      <View style={styles.labelRow}>
        <Text style={styles.label}>{t("importDeckLegacy.deckJsonLabel")}</Text>
        <Pressable onPress={onPaste} style={styles.pasteBtn}>
          <Text style={styles.pasteBtnText}>{t("importDeckLegacy.pasteButton")}</Text>
        </Pressable>
      </View>
      <TextInput
        value={payload}
        onChangeText={setPayload}
        placeholder={t("importDeckLegacy.pastePlaceholder")}
        placeholderTextColor="rgba(255,255,255,0.65)"
        style={styles.input}
        multiline
        textAlignVertical="top"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: APP_BG,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  pillText: { color: "white", fontWeight: "700" },
  primary: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "#2247a3ff",
  },
  primaryText: { color: "white", fontWeight: "900" },
  title: { fontSize: 30, fontWeight: "900", color: "black", marginTop: 4 },
  label: { color: "white", fontWeight: "800", opacity: 0.9, marginTop: 6 },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pasteBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  pasteBtnText: { color: "white", fontWeight: "800", fontSize: 12 },
  input: {
    minHeight: 220,
    borderRadius: 16,
    padding: 14,
    color: "white",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
});
