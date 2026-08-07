import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import { useTranslation } from "../../../src/i18n";
import { makeId } from "../../../src/models/deck";
import type { SourceCollection } from "../../../src/models/sourceCollection";
import { addSourceCollection, getActiveSourceCollections } from "../../../src/storage/sourceCollections";
import { useTheme } from "@/src/theme";
import { Button } from "../../../src/ui/Button";
import { Card } from "../../../src/ui/Card";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";
import { TextField } from "../../../src/ui/TextField";

const MAX_NAME_LENGTH = 60;

export default function CreateSourceCollectionScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [duplicateError, setDuplicateError] = useState(false);

  const trimmedName = useMemo(() => name.trim(), [name]);
  const isValid = trimmedName.length > 0 && trimmedName.length <= MAX_NAME_LENGTH;

  const error = touched && !trimmedName
    ? t("sourceCollections.form.nameRequiredError")
    : touched && trimmedName.length > MAX_NAME_LENGTH
      ? t("sourceCollections.form.nameTooLongError")
      : duplicateError
        ? t("sourceCollections.form.nameDuplicateError")
        : undefined;

  const onCreate = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    setDuplicateError(false);
    try {
      const scope = await AuthService.getActiveScope();
      const existing = await getActiveSourceCollections(scope);
      const isDuplicate = existing.some((c) => c.name.trim().toLowerCase() === trimmedName.toLowerCase());
      if (isDuplicate) {
        setDuplicateError(true);
        setSubmitting(false);
        return;
      }
      const collection: SourceCollection = { id: makeId(), name: trimmedName, createdAt: new Date().toISOString() };
      await addSourceCollection(scope, collection);
      router.back();
    } catch {
      console.error("[collection-create] failed to save collection");
      Alert.alert(t("sourceCollections.form.saveFailedTitle"), t("sourceCollections.form.saveFailedBody"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.cancel")} onPress={() => router.back()} disabled={submitting} />
        <Text style={[typography.title, styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1} accessibilityRole="header">
          {t("sourceCollections.form.createScreenTitle")}
        </Text>
      </View>
      <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("sourceCollections.form.createSubtitle")}</Text>

      <Card>
        <TextField
          label={t("sourceCollections.form.nameLabel")}
          value={name}
          onChangeText={(text) => {
            setName(text);
            setDuplicateError(false);
          }}
          onBlur={() => setTouched(true)}
          error={error}
          placeholder={t("sourceCollections.form.namePlaceholder")}
          autoFocus
          editable={!submitting}
        />
      </Card>

      <Button label={t("sourceCollections.form.saveButton")} variant="primary" fullWidth loading={submitting} disabled={!isValid} onPress={onCreate} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  headerTitle: { flex: 1 },
});
