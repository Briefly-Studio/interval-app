import * as SecureStore from "./secureStore";
import { makeId } from "../models/deck";

const KEY = "briefly.deviceId";

export async function getDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY);
  if (existing) return existing;

  const id = `dev-${makeId()}`;
  await SecureStore.setItemAsync(KEY, id);
  return id;
}
