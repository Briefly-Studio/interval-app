import AsyncStorage from "@react-native-async-storage/async-storage";
import { deleteCardsForDeck } from "./cards";
import { getDecksAll } from "./decks";
import { cursorKey, decksKey, sessionsKey } from "./keys";
import type { WorkspaceScope } from "./workspaceScope";

async function wipeScope(scope: WorkspaceScope): Promise<void> {
  const decks = await getDecksAll(scope);
  await Promise.all(decks.map((deck) => deleteCardsForDeck(scope, deck.id)));
  await AsyncStorage.removeItem(cursorKey(scope));
  await AsyncStorage.removeItem(decksKey(scope));
  await AsyncStorage.removeItem(sessionsKey(scope));
}

export async function resetLocalData(scope: WorkspaceScope): Promise<void> {
  await wipeScope(scope);
}

// Defensive guard: guest data exists only on this device and has no cloud copy to restore
// from, so wiping it here would be permanent data loss. This backstops the UI-level guard in
// dev-tools.tsx in case another caller invokes Force Resync for the guest workspace by mistake.
export async function forceFullResyncPrep(scope: WorkspaceScope): Promise<void> {
  if (scope.kind === "guest") {
    throw new Error(
      "Force Resync is not available for the guest workspace: guest data exists only locally " +
        "and has no cloud copy to restore from."
    );
  }
  await wipeScope(scope);
}
