import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, type ViewToken } from "react-native";

import { AuthService } from "../../src/auth/AuthService";
import { LocalDiscoverFixtureProvider } from "../../src/content/discoverLessons";
import {
  DISCOVER_PREVIEW_BUDGET,
  discoverBudgetSummary,
  isLessonSaved,
  markLessonViewed,
  visibleDiscoverLessons,
  type DiscoverLesson,
  type DiscoverProgressState,
} from "../../src/domain/discover";
import { useLayoutDirection } from "../../src/i18n/direction";
import { useTranslation } from "../../src/i18n";
import { getDiscoverProgress, resetDiscoverProgress, saveDiscoverProgress } from "../../src/storage/discover";
import type { WorkspaceScope } from "../../src/storage/workspaceScope";
import { useTheme } from "@/src/theme";
import { Button } from "../../src/ui/Button";
import { Card } from "../../src/ui/Card";
import { IconButton } from "../../src/ui/IconButton";
import { Screen } from "../../src/ui/Screen";

const discoverViewabilityConfig = { itemVisiblePercentThreshold: 55 };

function LessonCard({
  lesson,
  index,
  total,
  completed,
  saved,
  onPress,
}: {
  lesson: DiscoverLesson;
  index: number;
  total: number;
  completed: boolean;
  saved: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors, iconSizes, radii, spacing, typography } = useTheme();
  const { row, text } = useLayoutDirection();
  const progressLabel = t("discover.lessonPosition", { current: index + 1, total });
  const statusLabel = completed ? t("discover.completedBadge") : saved ? t("discover.savedBadge") : t("discover.notStartedBadge");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("discover.cardAccessibilityLabel", {
        title: lesson.title,
        category: lesson.category,
        minutes: lesson.estimatedMinutes,
        position: progressLabel,
        status: statusLabel,
      })}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <Card style={{ gap: spacing.md }}>
        <View style={[styles.cardMetaRow, row, { gap: spacing.sm }]}>
          <View
            style={[
              styles.categoryPill,
              { borderRadius: radii.pill, backgroundColor: colors.accentSubtle, paddingHorizontal: spacing.sm },
            ]}
          >
            <Text style={[typography.caption, styles.categoryText, { color: colors.accent, writingDirection: "ltr" }]}>
              {lesson.category}
            </Text>
          </View>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>{progressLabel}</Text>
        </View>

        <View style={{ gap: spacing.xs }}>
          <Text
            style={[typography.title, styles.lessonTitle, { color: colors.textPrimary, writingDirection: "ltr" }]}
            accessibilityRole="header"
          >
            {lesson.title}
          </Text>
          <Text style={[typography.secondary, styles.lessonHook, { color: colors.textSecondary, writingDirection: "ltr" }]}>
            {lesson.hook}
          </Text>
        </View>

        <View style={[styles.cardFooter, row, { gap: spacing.sm }]}>
          <View style={[styles.inlineMeta, row, { gap: spacing.xs }]}>
            <Ionicons name="time-outline" size={iconSizes.sm} color={colors.textSecondary} />
            <Text style={[typography.caption, text, { color: colors.textSecondary }]}>
              {t("discover.estimatedMinutes", { minutes: lesson.estimatedMinutes })}
            </Text>
          </View>
          <View style={[styles.inlineMeta, row, { gap: spacing.xs }]}>
            <Ionicons
              name={completed ? "checkmark-circle" : saved ? "bookmark" : "ellipse-outline"}
              size={iconSizes.sm}
              color={completed || saved ? colors.accent : colors.textMuted}
            />
            <Text style={[typography.caption, text, { color: completed || saved ? colors.accent : colors.textSecondary }]}>
              {statusLabel}
            </Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

function CompletionCard({
  summary,
  savedCount,
  onReset,
}: {
  summary: ReturnType<typeof discoverBudgetSummary>;
  savedCount: number;
  onReset: () => void;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, iconSizes, radii, spacing, typography } = useTheme();
  const { text } = useLayoutDirection();
  const handleDone = () => {
    if (router.canGoBack()) {
      router.dismissAll();
      return;
    }
    router.replace("/");
  };

  return (
    <View style={styles.completionWrap}>
      <Card style={{ gap: spacing.lg }}>
        <View
          style={[
            styles.completionIcon,
            { borderRadius: radii.pill, backgroundColor: colors.accentSubtle, alignSelf: "flex-start" },
          ]}
        >
          <Ionicons name="sparkles-outline" size={iconSizes.lg} color={colors.accent} />
        </View>
        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.heading, text, { color: colors.textPrimary }]} accessibilityRole="header">
            {t("discover.completeTitle")}
          </Text>
          <Text style={[typography.secondary, text, { color: colors.textSecondary }]}>
            {t("discover.completeBody", {
              lessons: summary.lessonsCompleted,
              minutes: summary.estimatedMinutesCompleted,
            })}
          </Text>
          <Text style={[typography.secondary, text, { color: colors.textSecondary }]}>
            {t("discover.completeSaved", { count: savedCount })}
          </Text>
        </View>
        <Button
          label={t("common.back")}
          variant="secondary"
          fullWidth
          onPress={handleDone}
        />
        {__DEV__ ? <Button label={t("discover.resetPreviewButton")} variant="ghost" fullWidth onPress={onReset} /> : null}
      </Card>
    </View>
  );
}

export default function DiscoverScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const { row, text } = useLayoutDirection();
  const lessons = useMemo(() => LocalDiscoverFixtureProvider.listLessons(), []);
  const visibleLessons = useMemo(() => visibleDiscoverLessons(lessons, DISCOVER_PREVIEW_BUDGET), [lessons]);
  const [scope, setScope] = useState<WorkspaceScope | null>(null);
  const [progress, setProgress] = useState<DiscoverProgressState | null>(null);
  const seenViewTokens = useRef(new Set<string>());
  const scopeRef = useRef<WorkspaceScope | null>(null);
  const progressRef = useRef<DiscoverProgressState | null>(null);

  const summary = useMemo(
    () => discoverBudgetSummary(visibleLessons, progress ?? { viewedLessonIds: [], completedLessonIds: [], savedLessonIds: [] }),
    [progress, visibleLessons]
  );
  const progressPercent = summary.lessonLimit > 0 ? (summary.lessonsCompleted / summary.lessonLimit) * 100 : 0;
  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  }, [router]);

  useEffect(() => {
    scopeRef.current = scope;
    progressRef.current = progress;
  }, [progress, scope]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const activeScope = await AuthService.getActiveScope();
        const stored = await getDiscoverProgress(activeScope);
        if (!alive) return;
        setScope(activeScope);
        setProgress(stored);
        seenViewTokens.current = new Set(stored.viewedLessonIds);
      })();
      return () => {
        alive = false;
      };
    }, [])
  );

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<DiscoverLesson>[] }) => {
    const activeScope = scopeRef.current;
    const activeProgress = progressRef.current;
    if (!activeScope || !activeProgress) return;
    const newlyViewed = viewableItems
      .map((token) => token.item?.id)
      .filter((id): id is string => Boolean(id) && !seenViewTokens.current.has(id));
    if (newlyViewed.length === 0) return;
    newlyViewed.forEach((id) => seenViewTokens.current.add(id));
    const next = newlyViewed.reduce((state, id) => markLessonViewed(state, id), activeProgress);
    setProgress(next);
    progressRef.current = next;
    saveDiscoverProgress(activeScope, next).catch(() => {});
  });

  const onReset = async () => {
    if (!scope) return;
    await resetDiscoverProgress(scope);
    const next = { viewedLessonIds: [], completedLessonIds: [], savedLessonIds: [] };
    seenViewTokens.current = new Set();
    setProgress(next);
  };

  const header = (
    <View style={{ gap: spacing.lg }}>
      <View style={[styles.headerRow, row, { gap: spacing.sm }]}>
        <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={handleBack} />
        <View style={styles.headerText}>
          <Text style={[typography.title, text, { color: colors.textPrimary }]} accessibilityRole="header">
            {t("discover.title")}
          </Text>
          <Text style={[typography.secondary, text, { color: colors.textSecondary }]}>
            {t("discover.subtitle", { count: summary.lessonLimit })}
          </Text>
        </View>
      </View>

      <Card style={{ gap: spacing.sm }}>
        <View style={[styles.cardFooter, row, { gap: spacing.sm }]}>
          <Text style={[typography.label, text, { color: colors.textPrimary }]}>{t("discover.sessionProgress")}</Text>
          <Text style={[typography.caption, text, { color: colors.textSecondary }]}>
            {t("discover.sessionProgressValue", {
              completed: summary.lessonsCompleted,
              limit: summary.lessonLimit,
              minutes: summary.estimatedMinutesCompleted,
            })}
          </Text>
        </View>
        <View
          style={[styles.progressTrack, { backgroundColor: colors.surfaceMuted }]}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: summary.lessonLimit, now: summary.lessonsCompleted }}
        >
          <View
            style={[
              styles.progressFill,
              { width: `${progressPercent}%`, backgroundColor: colors.accent },
            ]}
          />
        </View>
      </Card>
    </View>
  );

  if (!progress) {
    return (
      <Screen>
        {header}
        <Text style={[typography.secondary, text, { color: colors.textSecondary }]}>{t("discover.loading")}</Text>
      </Screen>
    );
  }

  if (summary.isSessionComplete) {
    return (
      <Screen>
        {header}
        <CompletionCard summary={summary} savedCount={progress.savedLessonIds.length} onReset={onReset} />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={styles.screenContent}>
      <FlatList
        data={visibleLessons}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        ListHeaderComponentStyle={{ marginBottom: spacing.lg }}
        contentContainerStyle={[styles.listContent, { gap: spacing.md, paddingBottom: spacing.xl }]}
        renderItem={({ item, index }) => (
          <LessonCard
            lesson={item}
            index={index}
            total={visibleLessons.length}
            completed={progress.completedLessonIds.includes(item.id)}
            saved={isLessonSaved(progress, item.id)}
            onPress={() => router.push({ pathname: "/discover/[id]" as any, params: { id: item.id } })}
          />
        )}
        onViewableItemsChanged={onViewableItemsChanged.current}
        viewabilityConfig={discoverViewabilityConfig}
        ListFooterComponent={
          <Text style={[typography.caption, text, styles.footerNote, { color: colors.textSecondary }]}>
            {t("discover.boundedFooter")}
          </Text>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { paddingBottom: 0 },
  headerRow: { alignItems: "center" },
  headerText: { flex: 1 },
  cardMetaRow: { alignItems: "center", justifyContent: "space-between" },
  categoryPill: { minHeight: 28, justifyContent: "center" },
  categoryText: { fontWeight: "700" },
  lessonTitle: { lineHeight: 28 },
  lessonHook: { lineHeight: 22 },
  cardFooter: { alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" },
  inlineMeta: { alignItems: "center" },
  progressTrack: { height: 8, borderRadius: 999, overflow: "hidden", direction: "ltr" },
  progressFill: { height: "100%" },
  completionWrap: { flex: 1, justifyContent: "center" },
  completionIcon: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.86 },
  listContent: {},
  footerNote: { textAlign: "center", marginTop: 4 },
});
