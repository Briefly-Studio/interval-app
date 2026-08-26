export type DiscoverCategory =
  | "Science"
  | "History"
  | "Technology"
  | "Psychology"
  | "Finance"
  | "Art & Culture"
  | "Geography";

export type DiscoverLessonSection = {
  heading: string;
  body: string;
};

export type DiscoverLesson = {
  id: string;
  title: string;
  category: DiscoverCategory;
  estimatedMinutes: number;
  hook: string;
  contentLanguage: "en";
  sections: DiscoverLessonSection[];
  keyTakeaway: string;
  relatedTopics?: string[];
  sourceNote?: string;
};

export type DiscoverContentProvider = {
  listLessons: () => readonly DiscoverLesson[];
  getLessonById: (id: string) => DiscoverLesson | null;
};

export type DiscoverProgressState = {
  viewedLessonIds: string[];
  completedLessonIds: string[];
  savedLessonIds: string[];
};

export type DiscoverBudgetConfig = {
  lessonLimit: number;
};

export type DiscoverBudgetSummary = {
  lessonLimit: number;
  lessonsViewed: number;
  lessonsCompleted: number;
  estimatedMinutesCompleted: number;
  isSessionComplete: boolean;
};

export const DISCOVER_PREVIEW_SESSION_LESSON_LIMIT = 7;

export const DISCOVER_PREVIEW_BUDGET: DiscoverBudgetConfig = {
  lessonLimit: DISCOVER_PREVIEW_SESSION_LESSON_LIMIT,
};

export function emptyDiscoverProgress(): DiscoverProgressState {
  return { viewedLessonIds: [], completedLessonIds: [], savedLessonIds: [] };
}

export function uniqueIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

export function markLessonViewed(progress: DiscoverProgressState, lessonId: string): DiscoverProgressState {
  return { ...progress, viewedLessonIds: uniqueIds([...progress.viewedLessonIds, lessonId]) };
}

export function markLessonCompleted(progress: DiscoverProgressState, lessonId: string): DiscoverProgressState {
  return {
    ...markLessonViewed(progress, lessonId),
    completedLessonIds: uniqueIds([...progress.completedLessonIds, lessonId]),
  };
}

export function setLessonSaved(
  progress: DiscoverProgressState,
  lessonId: string,
  saved: boolean
): DiscoverProgressState {
  const withoutLesson = progress.savedLessonIds.filter((id) => id !== lessonId);
  return {
    ...progress,
    savedLessonIds: saved ? uniqueIds([...withoutLesson, lessonId]) : withoutLesson,
  };
}

export function isLessonSaved(progress: DiscoverProgressState, lessonId: string): boolean {
  return progress.savedLessonIds.includes(lessonId);
}

export function discoverBudgetSummary(
  lessons: readonly DiscoverLesson[],
  progress: DiscoverProgressState,
  config: DiscoverBudgetConfig = DISCOVER_PREVIEW_BUDGET
): DiscoverBudgetSummary {
  const completed = new Set(progress.completedLessonIds);
  const estimatedMinutesCompleted = lessons.reduce(
    (total, lesson) => total + (completed.has(lesson.id) ? lesson.estimatedMinutes : 0),
    0
  );
  const lessonsViewed = Math.min(uniqueIds(progress.viewedLessonIds).length, config.lessonLimit);
  const lessonsCompleted = Math.min(uniqueIds(progress.completedLessonIds).length, config.lessonLimit);
  return {
    lessonLimit: config.lessonLimit,
    lessonsViewed,
    lessonsCompleted,
    estimatedMinutesCompleted,
    isSessionComplete: lessonsCompleted >= config.lessonLimit,
  };
}

export function visibleDiscoverLessons(
  lessons: readonly DiscoverLesson[],
  config: DiscoverBudgetConfig = DISCOVER_PREVIEW_BUDGET
): readonly DiscoverLesson[] {
  return lessons.slice(0, config.lessonLimit);
}

