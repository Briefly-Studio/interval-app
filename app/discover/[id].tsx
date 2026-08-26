import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { AuthService } from "../../src/auth/AuthService";
import { LocalDiscoverFixtureProvider } from "../../src/content/discoverLessons";
import {
  isLessonSaved,
  markLessonCompleted,
  markLessonViewed,
  setLessonSaved,
  type DiscoverLesson,
  type DiscoverProgressState,
} from "../../src/domain/discover";
import { useLayoutDirection } from "../../src/i18n/direction";
import { useTranslation } from "../../src/i18n";
import { getDiscoverProgress, saveDiscoverProgress } from "../../src/storage/discover";
import type { WorkspaceScope } from "../../src/storage/workspaceScope";
import { useTheme } from "@/src/theme";
import { Button } from "../../src/ui/Button";
import { Card } from "../../src/ui/Card";
import { EmptyState } from "../../src/ui/EmptyState";
import { IconButton } from "../../src/ui/IconButton";
import { Screen } from "../../src/ui/Screen";

function LessonBody({ lesson }: { lesson: DiscoverLesson }) {
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();

  return (
    <View style={{ gap: spacing.lg }}>
      <Text style={[typography.secondary, styles.englishText, { color: colors.textSecondary }]}>
        {t("discover.englishContentNotice")}
      </Text>
      {lesson.sections.map((section) => (
        <View key={section.heading} style={{ gap: spacing.xs }}>
          <Text style={[typography.subheading, styles.englishText, { color: colors.textPrimary }]} accessibilityRole="header">
            {section.heading}
          </Text>
          <Text style={[typography.secondary, styles.sectionBody, { color: colors.textSecondary }]}>
            {section.body}
          </Text>
        </View>
      ))}
      <Card style={{ gap: spacing.xs }}>
        <Text style={[typography.label, styles.englishText, { color: colors.accent }]}>
          {t("discover.keyTakeawayLabel")}
        </Text>
        <Text style={[typography.secondary, styles.sectionBody, { color: colors.textPrimary }]}>
          {lesson.keyTakeaway}
        </Text>
      </Card>
      {lesson.relatedTopics?.length ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.label, styles.englishText, { color: colors.textPrimary }]}>
            {t("discover.relatedTopicsLabel")}
          </Text>
          <View style={[styles.topicRow, { gap: spacing.xs }]}>
            {lesson.relatedTopics.map((topic) => (
              <View
                key={topic}
                style={[
                  styles.topicChip,
                  { borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.sm },
                ]}
              >
                <Text style={[typography.caption, styles.englishText, { color: colors.textSecondary }]}>{topic}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {lesson.sourceNote ? (
        <Text style={[typography.caption, styles.englishText, { color: colors.textMuted }]}>{lesson.sourceNote}</Text>
      ) : null}
    </View>
  );
}

export default function DiscoverLessonScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const { t } = useTranslation();
  const { colors, iconSizes, radii, spacing, typography } = useTheme();
  const { row, text } = useLayoutDirection();
  const lesson = useMemo(() => (params.id ? LocalDiscoverFixtureProvider.getLessonById(params.id) : null), [params.id]);
  const [scope, setScope] = useState<WorkspaceScope | null>(null);
  const [progress, setProgress] = useState<DiscoverProgressState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const activeScope = await AuthService.getActiveScope();
      const stored = await getDiscoverProgress(activeScope);
      const next = lesson ? markLessonViewed(stored, lesson.id) : stored;
      if (lesson) await saveDiscoverProgress(activeScope, next);
      if (!alive) return;
      setScope(activeScope);
      setProgress(next);
    })();
    return () => {
      alive = false;
    };
  }, [lesson]);

  const persistProgress = async (next: DiscoverProgressState) => {
    setProgress(next);
    if (scope) await saveDiscoverProgress(scope, next);
  };

  if (!lesson) {
    return (
      <Screen>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="compass-outline"
            title={t("discover.lessonNotFoundTitle")}
            description={t("discover.lessonNotFoundBody")}
          />
        </View>
      </Screen>
    );
  }

  const saved = progress ? isLessonSaved(progress, lesson.id) : false;
  const completed = progress?.completedLessonIds.includes(lesson.id) ?? false;

  const onToggleSave = async () => {
    if (!progress) return;
    setSaving(true);
    try {
      await persistProgress(setLessonSaved(progress, lesson.id, !saved));
    } catch {
      Alert.alert(t("discover.saveFailedTitle"), t("discover.saveFailedBody"));
    } finally {
      setSaving(false);
    }
  };

  const onComplete = async () => {
    if (!progress) return;
    try {
      await persistProgress(markLessonCompleted(progress, lesson.id));
      router.back();
    } catch {
      Alert.alert(t("discover.completeFailedTitle"), t("discover.completeFailedBody"));
    }
  };

  return (
    <Screen contentStyle={styles.readerScreen}>
      <View style={[styles.headerRow, row, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={() => router.back()} />
        <View style={styles.headerText}>
          <Text style={[typography.caption, text, { color: colors.textSecondary }]}>{t("discover.lessonScreenLabel")}</Text>
        </View>
        <IconButton
          name={saved ? "bookmark" : "bookmark-outline"}
          accessibilityLabel={saved ? t("discover.unsaveLesson") : t("discover.saveLesson")}
          onPress={onToggleSave}
          disabled={!progress || saving}
          color={saved ? colors.accent : undefined}
        />
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, { gap: spacing.lg, paddingBottom: spacing.xl }]}>
        <View style={{ gap: spacing.sm }}>
          <View style={[styles.lessonMetaRow, row, { gap: spacing.sm }]}>
            <View
              style={[
                styles.categoryPill,
                { borderRadius: radii.pill, backgroundColor: colors.accentSubtle, paddingHorizontal: spacing.sm },
              ]}
            >
              <Text style={[typography.caption, styles.englishText, styles.categoryText, { color: colors.accent }]}>
                {lesson.category}
              </Text>
            </View>
            <View style={[styles.inlineMeta, row, { gap: spacing.xs }]}>
              <Ionicons name="time-outline" size={iconSizes.sm} color={colors.textSecondary} />
              <Text style={[typography.caption, text, { color: colors.textSecondary }]}>
                {t("discover.estimatedMinutes", { minutes: lesson.estimatedMinutes })}
              </Text>
            </View>
          </View>

          <Text style={[typography.heading, styles.lessonTitle, { color: colors.textPrimary }]} accessibilityRole="header">
            {lesson.title}
          </Text>
          <Text style={[typography.secondary, styles.lessonHook, { color: colors.textSecondary }]}>
            {lesson.hook}
          </Text>
        </View>

        <LessonBody lesson={lesson} />

        <View style={{ gap: spacing.sm }}>
          <Button
            label={completed ? t("discover.completedAction") : t("discover.completeLessonButton")}
            onPress={onComplete}
            disabled={!progress}
            fullWidth
          />
          <Button
            label={saved ? t("discover.unsaveLesson") : t("discover.saveLesson")}
            onPress={onToggleSave}
            loading={saving}
            disabled={!progress}
            variant="secondary"
            fullWidth
          />
          <Button label={t("discover.generateDeckComingSoon")} onPress={() => {}} disabled variant="ghost" fullWidth />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  readerScreen: { paddingBottom: 0 },
  headerRow: { alignItems: "center" },
  headerText: { flex: 1 },
  emptyWrap: { flex: 1, justifyContent: "center" },
  scrollContent: {},
  lessonMetaRow: { alignItems: "center", flexWrap: "wrap" },
  categoryPill: { minHeight: 28, justifyContent: "center" },
  categoryText: { fontWeight: "700" },
  inlineMeta: { alignItems: "center" },
  lessonTitle: { lineHeight: 30, writingDirection: "ltr", textAlign: "left" },
  lessonHook: { lineHeight: 22, writingDirection: "ltr", textAlign: "left" },
  englishText: { writingDirection: "ltr", textAlign: "left" },
  sectionBody: { lineHeight: 23, writingDirection: "ltr", textAlign: "left" },
  topicRow: { flexDirection: "row", flexWrap: "wrap" },
  topicChip: { minHeight: 28, justifyContent: "center", borderWidth: 1, borderRadius: 999 },
});

