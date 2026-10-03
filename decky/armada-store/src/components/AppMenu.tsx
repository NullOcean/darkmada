import { Menu, MenuItem } from "@decky/ui";
import * as backend from "../backend";
import { addAppToSteam, removeAppFromSteam, uninstallApp } from "../lib/appActions";
import { launchShortcut } from "../lib/shortcuts";
import type { CatalogApp, InstalledInfo, Job } from "../types";
import { TERMINAL_PHASES } from "./AppRow";

interface AppMenuProps {
  app: CatalogApp;
  job: Job | null;
  info: InstalledInfo | null;
  shortcut: number | undefined;
  updateAvailable: boolean;
  run: (work: Promise<unknown>, onDone?: () => void) => void;
  toast: (title: string, body?: string) => void;
}

export function AppMenu({ app, job, info, shortcut, updateAvailable, run, toast }: AppMenuProps) {
  const active = !!job && !TERMINAL_PHASES.includes(job.phase);
  if (active) {
    return (
      <Menu label={app.name}>
        <MenuItem onSelected={() => run(backend.cancelJob(app.id))}>Cancel</MenuItem>
      </Menu>
    );
  }

  const installed = !!info?.installed;
  const conflicts = info?.conflicts || [];
  // A desktop-only tool must not be launched from game mode even if an
  // older install left a Steam shortcut behind.
  const launchable = installed && !app.desktopOnly;
  const conflictKind = conflicts[0]?.type === "appimage" ? "AppImage" : "Flatpak";

  const launch = () => {
    if (shortcut == null) return;
    try {
      launchShortcut(shortcut);
    } catch (error) {
      toast("Armada Store", String(error));
    }
  };

  return (
    <Menu label={app.name}>
      {job?.phase === "error" && (
        <MenuItem onSelected={() => run(backend.dismissJob(app.id))}>Dismiss error</MenuItem>
      )}
      {shortcut != null && launchable && (
        <MenuItem onSelected={launch}>Launch</MenuItem>
      )}
      {shortcut == null && app.launch && launchable && (
        <MenuItem onSelected={() => run(addAppToSteam(app), () => toast(app.name, "Added to Steam"))}>
          Add to Steam
        </MenuItem>
      )}
      {conflicts.length > 0 ? (
        // Replace the rival packaging so the user doesn't get duplicate installs.
        <MenuItem onSelected={() => run(backend.replaceApp(app.id))}>
          {`Replace ${conflictKind} version`}
        </MenuItem>
      ) : (!installed || updateAvailable) && (
        <MenuItem onSelected={() => run(backend.installApp(app.id))}>
          {installed ? "Update to latest" : "Install"}
        </MenuItem>
      )}
      {app.desktopOnly && installed && (
        <MenuItem onSelected={() => run(backend.switchToDesktop())}>Switch to Desktop</MenuItem>
      )}
      {shortcut != null && (
        // Keep this available after uninstall to clean up a stranded shortcut.
        <MenuItem onSelected={() => run(removeAppFromSteam(app, shortcut), () => toast(app.name, "Removed from Steam"))}>
          Remove from Steam
        </MenuItem>
      )}
      {installed && app.hasConfig && (
        <MenuItem
          tone="destructive"
          onSelected={() => run(backend.resetConfig(app.id), () => toast(app.name, "Configuration reset, previous kept as .bak"))}
        >
          Reset Configuration
        </MenuItem>
      )}
      {installed && app.installType !== "system" && (
        <MenuItem tone="destructive" onSelected={() => run(uninstallApp(app, shortcut))}>
          Uninstall
        </MenuItem>
      )}
    </Menu>
  );
}
