import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../src/auth/AuthService";
import { EMPTY_SOURCE_FORM_VALUES, toSourcePatch, type SourceFormValues } from "../../src/domain/sourceFormValues";
import { useTranslation } from "../../src/i18n";
import { makeId } from "../../src/models/deck";
import type { LibrarySource } from "../../src/models/librarySource";
import type { SourceCollectionRecord } from "../../src/models/sourceCollection";
import { addLibrarySource } from "../../src/storage/librarySources";
import { getActiveSourceCollections } from "../../src/storage/sourceCollections";
import { useTheme } from "@/src/theme";
import { Button } from "../../src/ui/Button";
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
      };
      const scope = await AuthService.getActiveScope();
      await addLibrarySource(scope, source);
      router.back();
    } catch {
      // Never log title/tags/course/semester — only a diagnostic tag. Values stay in the form so
      // the user doesn't have to retype anything after a failed save.
      console.error("[library-add] failed to save source details");
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

      <SourceDetailsFields
        values={values}
        onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
        collections={collections}
        titleTouched={titleTouched}
        onTitleBlur={() => setTitleTouched(true)}
        editable={!submitting}
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
});
