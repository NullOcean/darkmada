import * as backend from "../backend";
import type { CatalogApp } from "../types";
import { addToSteam, removeFromSteam } from "./shortcuts";

// Keep Steam and the backend's shortcut record in sync for manual and automatic adds.
export async function addAppToSteam(app: CatalogApp): Promise<void> {
  const appid = await addToSteam(app.launch);
  await backend.recordShortcut(app.id, appid);
}

export async function removeAppFromSteam(app: CatalogApp, appid: number): Promise<void> {
  removeFromSteam(appid);
  await backend.clearShortcutRecord(app.id);
}

// Best-effort shortcut removal: on failure the record survives, so the menu
// keeps offering "Remove from Steam" even after the app itself is gone.
export async function uninstallApp(app: CatalogApp, shortcut: number | undefined): Promise<void> {
  if (shortcut != null) {
    try {
      await removeAppFromSteam(app, shortcut);
    } catch (error) {
    }
  }
  await backend.uninstallApp(app.id);
}
