import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SessionRecord } from "../models/session";
import { upgradeSession } from "../models/session";
import { sessionsKey } from "./keys";
import type { WorkspaceScope } from "./workspaceScope";

async function safeParse(
  scope: WorkspaceScope,
  raw: string | null
): Promise<SessionRecord[]> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const upgraded = parsed.map((session) => upgradeSession(session));
    try {
      await setSessions(scope, upgraded);
    } catch {
      // ignore
    }
    return upgraded;
  } catch {
    return [];
  }
}

export async function getSessions(scope: WorkspaceScope): Promise<SessionRecord[]> {
  const raw = await AsyncStorage.getItem(sessionsKey(scope));
  return safeParse(scope, raw);
}

export async function setSessions(
  scope: WorkspaceScope,
  sessions: SessionRecord[]
): Promise<void> {
  await AsyncStorage.setItem(sessionsKey(scope), JSON.stringify(sessions));
}

export async function addSession(
  scope: WorkspaceScope,
  session: SessionRecord
): Promise<SessionRecord[]> {
  const existing = await getSessions(scope);
  const updated = [upgradeSession(session), ...existing];
  await setSessions(scope, updated);
  return updated;
}

export async function getSessionsForDeck(
  scope: WorkspaceScope,
  deckId: string
): Promise<SessionRecord[]> {
  const all = await getSessions(scope);
  return all.filter((s) => s.deckId === deckId);
}

export async function deleteSessionsForDeck(
  scope: WorkspaceScope,
  deckId: string
): Promise<void> {
  const all = await getSessions(scope);
  const now = new Date().toISOString();
  const updated = all.map((session) => {
    if (session.deckId !== deckId) return session;
    if (session.deletedAt) return session;
    return {
      ...session,
      deletedAt: now,
      updatedAt: now,
      rev: session.rev + 1,
      dirty: true,
    };
  });
  await setSessions(scope, updated);
}
