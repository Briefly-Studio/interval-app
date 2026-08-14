import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import { EMPTY_SOURCE_FORM_VALUES, sourceToFormValues, toSourcePatch, type SourceFormValues } from "../../../src/domain/sourceFormValues";
import { detectSourceTypeFromFile } from "../../../src/domain/sourceTypeDetection";
import { useTranslation } from "../../../src/i18n";
import type { SourceCollectionRecord } from "../../../src/models/sourceCollection";
import { getLibrarySources, updateLibrarySource } from "../../../src/storage/librarySources";
import { getActiveSourceCollections } from "../../../src/storage/sourceCollections";
import { useTheme } from "@/src/theme";
import { Button } from "../../../src/ui/Button";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";
import { SourceDetailsFields } from "../../../src/ui/SourceDetailsFields";

export default function EditLibrarySourceScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();

  const params = useLocalSearchParams();
  const idParam = params.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? idParam[0] : "";

  const [values, setValues] = useState<SourceFormValues>(EMPTY_SOURCE_FORM_VALUES);
  const [titleTouched, setTitleTouched] = useState(false);
  const [collections, setCollections] = useState<SourceCollectionRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [found, setFound] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // True when the loaded source has an attached file whose MIME type/extension confidently maps
  // to a SourceType (see src/domain/sourceTypeDetection.ts) — the type chips become read-only in
  // that case, since the source of truth is the actual attached file, not a manual pick. A source
  // with no attached file (metadata-only) or an unrecognized file type keeps the chips freely
  // selectable, exactly as before.
  const [sourceTypeLocked, setSourceTypeLocked] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!id) return;
        const scope = await AuthService.getActiveScope();
        const [all, cols] = await Promise.all([getLibrarySources(scope), getActiveSourceCollections(scope)]);
        const source = all.find((s) => s.id === id);
        if (!alive) return;
        if (source) {
          const detectedType = detectSourceTypeFromFile({ mimeType: source.mimeType, extension: source.extension });
          setValues({
            ...sourceToFormValues(source),
            // Self-heals a previously-mismatched type (e.g. a source saved as "PDF" before this
            // fix existed, but whose attached file is actually a .docx) the next time it's opened
            // for editing — the detected type from the real file always wins over a stale stored
            // value once evidence is confident.
            sourceType: detectedType ?? source.sourceType,
          });
          setSourceTypeLocked(!!detectedType);
          setFound(true);
        } else {
          setFound(false);
        }
        setCollections(cols);
        setLoaded(true);
      })();
      return () => {
        alive = false;
      };
    }, [id])
  );

  const isValid = values.displayTitle.trim().length > 0;

  const onSave = async () => {
    if (!isValid || submitting || !id) return;
    setSubmitting(true);
    try {
      const scope = await AuthService.getActiveScope();
      await updateLibrarySource(scope, id, toSourcePatch(values));
      router.back();
    } catch {
      console.error("[library-edit] failed to save source details");
      Alert.alert(t("librarySource.form.saveFailedTitle"), t("librarySource.form.saveFailedBody"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loaded && !found) {
    return (
      <Screen>
        <View style={[styles.header, { gap: spacing.sm }]}>
          <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        </View>
        <Text style={[typography.secondary, { color: colors.textSecondary }]}>{t("librarySource.detail.notFound")}</Text>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={[styles.header, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.cancel")} onPress={() => router.back()} disabled={submitting} />
        <Text style={[typography.title, styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1} accessibilityRole="header">
          {t("librarySource.form.editScreenTitle")}
        </Text>
      </View>

      <SourceDetailsFields
        values={values}
        onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
        collections={collections}
        titleTouched={titleTouched}
        onTitleBlur={() => setTitleTouched(true)}
        editable={!submitting}
        sourceTypeLocked={sourceTypeLocked}
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
