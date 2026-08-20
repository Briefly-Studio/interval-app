import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { SOURCE_TYPE_LABEL_KEYS, STATUS_LABEL_KEYS } from "../domain/librarySourceLabels";
import { formatAudioDuration, formatFileSize } from "../domain/librarySourceFormat";
import { useTranslation } from "../i18n";
import { mirrorIfRtl, useLayoutDirection } from "../i18n/direction";
import type { LibrarySourceRecord } from "../models/librarySource";
import type { SourceCollectionRecord } from "../models/sourceCollection";
import { useTheme } from "@/src/theme";
import { Card } from "./Card";

type SourceCardProps = {
  source: LibrarySourceRecord;
  collections: SourceCollectionRecord[];
  onPress: () => void;
  onLongPress?: () => void;
};

// Reusable Library source row. Every piece of state (type, status, size, counts) is rendered as
// real text — never conveyed by color or icon alone (docs/accessibility-foundation.md §11's
// Library requirements). There is no "open file" affordance anywhere here: no binary has ever
// been imported by this foundation, so there is nothing to open.
export function SourceCard({ source, collections, onPress, onLongPress }: SourceCardProps) {
  const { t, plural, language } = useTranslation();
  const { colors, iconSizes, spacing, typography } = useTheme();
  const { direction, row, text } = useLayoutDirection();

  const typeLabel = t(SOURCE_TYPE_LABEL_KEYS[source.sourceType]);
  const statusLabel = source.processingStatus === "ready" ? null : t(STATUS_LABEL_KEYS[source.processingStatus]);

  const collectionNames = source.collectionIds
    .map((id) => collections.find((c) => c.id === id)?.name)
    .filter((name): name is string => !!name);

  const metaParts: string[] = [typeLabel];
  const sizeLabel = formatFileSize(source.fileSize);
  if (sizeLabel) metaParts.push(sizeLabel);
  if (source.sourceType === "pdf" || source.sourceType === "docx") {
    if (source.pageCount) metaParts.push(plural("librarySource.pageCountLabel", source.pageCount));
  }
  if (source.sourceType === "pptx" && source.slideCount) {
    metaParts.push(plural("librarySource.slideCountLabel", source.slideCount));
  }
  if (source.sourceType === "xlsx" && source.sheetCount) {
    metaParts.push(plural("librarySource.sheetCountLabel", source.sheetCount));
  }
  if (source.sourceType === "audio") {
    const duration = formatAudioDuration(source.audioDuration);
    if (duration) metaParts.push(duration);
  }

  const contextParts: string[] = [];
  if (source.course) contextParts.push(source.course);
  if (source.semester) contextParts.push(source.semester);
  if (collectionNames.length > 0) contextParts.push(collectionNames.join(", "));

  const dateLabel = t("librarySource.addedOn", {
    date: new Date(source.createdAt).toLocaleDateString(language),
  });

  const accessibilityLabelParts = [
    source.displayTitle,
    typeLabel,
    statusLabel,
    sizeLabel,
    contextParts.join(", "),
    dateLabel,
  ].filter(Boolean);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabelParts.join(". ")}
      accessibilityHint={t("librarySource.cardHint")}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <Card style={[styles.cardRow, row, { gap: spacing.sm }]}>
        <View style={[styles.content, { gap: spacing.xs }]}>
          <Text style={[typography.subheading, text, { color: colors.textPrimary }]} numberOfLines={2}>
            {source.displayTitle}
          </Text>
          {source.originalName && source.originalName !== source.displayTitle ? (
            <Text style={[typography.caption, text, { color: colors.textSecondary }]} numberOfLines={1}>
              {source.originalName}
            </Text>
          ) : null}
          <Text style={[typography.caption, text, { color: colors.textSecondary }]} numberOfLines={1}>
            {metaParts.join(" · ")}
          </Text>
          {contextParts.length > 0 ? (
            <Text style={[typography.caption, text, { color: colors.textSecondary }]} numberOfLines={1}>
              {contextParts.join(" · ")}
            </Text>
          ) : null}
          <View style={[styles.footerRow, row, { gap: spacing.sm }]}>
            <Text style={[typography.caption, text, { color: colors.textMuted }]}>{dateLabel}</Text>
            {statusLabel ? (
              <Text style={[typography.caption, text, styles.statusLabel, { color: colors.accent }]}>{statusLabel}</Text>
            ) : null}
          </View>
        </View>
        {/* Visual affordance only — a sighted user has no other cue that this row opens
            something. Accessibility already gets this via accessibilityRole="button" plus the
            hint above; the icon itself carries no separate accessible name (decorative). */}
        <Ionicons
          name="chevron-forward"
          size={iconSizes.md}
          color={colors.textSecondary}
          importantForAccessibility="no"
          style={mirrorIfRtl(direction)}
        />
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
  cardRow: { alignItems: "center" },
  content: { flex: 1 },
  footerRow: { justifyContent: "space-between", alignItems: "center" },
  statusLabel: { fontWeight: "700" },
});
