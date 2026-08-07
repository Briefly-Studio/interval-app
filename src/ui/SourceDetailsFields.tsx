import { StyleSheet, Text, View } from "react-native";

import { ALL_SOURCE_TYPES, SOURCE_TYPE_LABEL_KEYS } from "../domain/librarySourceLabels";
import type { SourceFormValues } from "../domain/sourceFormValues";
import { useTranslation } from "../i18n";
import type { SourceCollectionRecord } from "../models/sourceCollection";
import { useTheme } from "@/src/theme";
import { Card } from "./Card";
import { FilterChip } from "./FilterChip";
import { TextField } from "./TextField";

type SourceDetailsFieldsProps = {
  values: SourceFormValues;
  onChange: (patch: Partial<SourceFormValues>) => void;
  collections: SourceCollectionRecord[];
  titleTouched: boolean;
  onTitleBlur: () => void;
  editable: boolean;
};

// Shared field renderer for Add Source Details and Edit Source Details — a "dumb" controlled
// component (no internal state) so both screens keep owning their own form state and submit
// logic, per this repository's existing per-screen form convention (see app/create-deck.tsx,
// app/deck/[id]/add-card.tsx). Every field here is metadata only — there is no file picker, no
// upload progress, no AWS key field, and no AI generation control anywhere in this form.
export function SourceDetailsFields({ values, onChange, collections, titleTouched, onTitleBlur, editable }: SourceDetailsFieldsProps) {
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();

  const titleError = titleTouched && !values.displayTitle.trim() ? t("librarySource.form.titleRequiredError") : undefined;

  const toggleCollection = (id: string) => {
    const isSelected = values.collectionIds.includes(id);
    onChange({ collectionIds: isSelected ? values.collectionIds.filter((c) => c !== id) : [...values.collectionIds, id] });
  };

  return (
    <>
      <Card style={[styles.formCard, { gap: spacing.md }]}>
        <TextField
          label={t("librarySource.form.titleLabel")}
          value={values.displayTitle}
          onChangeText={(text) => onChange({ displayTitle: text })}
          onBlur={onTitleBlur}
          error={titleError}
          placeholder={t("librarySource.form.titlePlaceholder")}
          editable={editable}
        />

        <View style={[styles.fieldGroup, { gap: spacing.xs }]}>
          <Text style={[typography.label, { color: colors.textSecondary }]}>{t("librarySource.form.typeLabel")}</Text>
          <View style={[styles.chipRow, { gap: spacing.xs }]} accessibilityRole="radiogroup">
            {ALL_SOURCE_TYPES.map((type) => (
              <FilterChip
                key={type}
                label={t(SOURCE_TYPE_LABEL_KEYS[type])}
                selected={values.sourceType === type}
                onPress={() => onChange({ sourceType: type })}
              />
            ))}
          </View>
        </View>

        <TextField
          label={t("librarySource.form.originalNameLabel")}
          value={values.originalName}
          onChangeText={(text) => onChange({ originalName: text })}
          placeholder={t("librarySource.form.originalNamePlaceholder")}
          editable={editable}
        />

        <TextField
          label={t("librarySource.form.fileSizeLabel")}
          value={values.fileSizeMB}
          onChangeText={(text) => onChange({ fileSizeMB: text })}
          placeholder={t("librarySource.form.fileSizePlaceholder")}
          keyboardType="decimal-pad"
          editable={editable}
        />

        {(values.sourceType === "pdf" || values.sourceType === "docx") && (
          <TextField
            label={t("librarySource.form.pageCountLabel")}
            value={values.pageCount}
            onChangeText={(text) => onChange({ pageCount: text })}
            keyboardType="number-pad"
            editable={editable}
          />
        )}
        {values.sourceType === "pptx" && (
          <TextField
            label={t("librarySource.form.slideCountLabel")}
            value={values.slideCount}
            onChangeText={(text) => onChange({ slideCount: text })}
            keyboardType="number-pad"
            editable={editable}
          />
        )}
        {values.sourceType === "xlsx" && (
          <TextField
            label={t("librarySource.form.sheetCountLabel")}
            value={values.sheetCount}
            onChangeText={(text) => onChange({ sheetCount: text })}
            keyboardType="number-pad"
            editable={editable}
          />
        )}
        {values.sourceType === "audio" && (
          <TextField
            label={t("librarySource.form.durationLabel")}
            value={values.durationMinutes}
            onChangeText={(text) => onChange({ durationMinutes: text })}
            keyboardType="decimal-pad"
            editable={editable}
          />
        )}

        <TextField
          label={t("librarySource.form.tagsLabel")}
          value={values.tags}
          onChangeText={(text) => onChange({ tags: text })}
          placeholder={t("librarySource.form.tagsPlaceholder")}
          editable={editable}
        />
        <TextField
          label={t("librarySource.form.courseLabel")}
          value={values.course}
          onChangeText={(text) => onChange({ course: text })}
          editable={editable}
        />
        <TextField
          label={t("librarySource.form.semesterLabel")}
          value={values.semester}
          onChangeText={(text) => onChange({ semester: text })}
          editable={editable}
        />
        <TextField
          label={t("librarySource.form.languageLabel")}
          value={values.sourceLanguage}
          onChangeText={(text) => onChange({ sourceLanguage: text })}
          placeholder={t("librarySource.form.languagePlaceholder")}
          editable={editable}
        />
      </Card>

      {collections.length > 0 && (
        <View style={[styles.fieldGroup, { gap: spacing.xs }]}>
          <Text style={[typography.label, { color: colors.textSecondary }]}>{t("librarySource.form.collectionsLabel")}</Text>
          <View style={[styles.chipRow, { gap: spacing.xs }]}>
            {collections.map((collection) => (
              <FilterChip
                key={collection.id}
                role="checkbox"
                label={collection.name}
                selected={values.collectionIds.includes(collection.id)}
                onPress={() => toggleCollection(collection.id)}
              />
            ))}
          </View>
        </View>
      )}

      <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("librarySource.form.localOnlyNote")}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  formCard: {},
  fieldGroup: {},
  chipRow: { flexDirection: "row", flexWrap: "wrap" },
});
