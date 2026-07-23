import AsyncStorage from "@react-native-async-storage/async-storage";
import { cursorKey } from "./keys";
import type { WorkspaceScope } from "./workspaceScope";

export async function getSyncCursor(scope: WorkspaceScope): Promise<string | undefined> {
  const cursor = await AsyncStorage.getItem(cursorKey(scope));
  return cursor ?? undefined;
}

export async function setSyncCursor(scope: WorkspaceScope, cursor: string): Promise<void> {
  await AsyncStorage.setItem(cursorKey(scope), cursor);
}
