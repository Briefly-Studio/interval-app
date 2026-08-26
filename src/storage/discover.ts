import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  emptyDiscoverProgress,
  type DiscoverProgressState,
  uniqueIds,
} from "../domain/discover";
import type { WorkspaceScope } from "./workspaceScope";
import { scopedKey } from "./workspaceScope";

export const DISCOVER_PROGRESS_KEY = "interval.discoverProgress.v1";

export const discoverProgressKey = (scope: WorkspaceScope) => scopedKey(scope, DISCOVER_PROGRESS_KEY);

function normalizeProgress(value: unknown): DiscoverProgressState {
  if (!value || typeof value !== "object") return emptyDiscoverProgress();
  const candidate = value as Partial<Record<keyof DiscoverProgressState, unknown>>;
  return {
    viewedLessonIds: uniqueIds(Array.isArray(candidate.viewedLessonIds) ? candidate.viewedLessonIds.filter(String) : []),
    completedLessonIds: uniqueIds(
      Array.isArray(candidate.completedLessonIds) ? candidate.completedLessonIds.filter(String) : []
    ),
    savedLessonIds: uniqueIds(Array.isArray(candidate.savedLessonIds) ? candidate.savedLessonIds.filter(String) : []),
  };
}

export async function getDiscoverProgress(scope: WorkspaceScope): Promise<DiscoverProgressState> {
  const raw = await AsyncStorage.getItem(discoverProgressKey(scope));
  if (!raw) return emptyDiscoverProgress();
  try {
    return normalizeProgress(JSON.parse(raw));
  } catch {
    return emptyDiscoverProgress();
  }
}

export async function saveDiscoverProgress(scope: WorkspaceScope, progress: DiscoverProgressState): Promise<void> {
  await AsyncStorage.setItem(discoverProgressKey(scope), JSON.stringify(normalizeProgress(progress)));
}

export async function resetDiscoverProgress(scope: WorkspaceScope): Promise<void> {
  await AsyncStorage.removeItem(discoverProgressKey(scope));
}

