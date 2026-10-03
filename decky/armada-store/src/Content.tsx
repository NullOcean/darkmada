import { FileSelectionType, openFilePicker, toaster } from "@decky/api";
import { ButtonItem, PanelSection, PanelSectionRow, showContextMenu } from "@decky/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as backend from "./backend";
import { AppMenu } from "./components/AppMenu";
import { AppRow, TERMINAL_PHASES } from "./components/AppRow";
import { categoryIcons } from "./icons";
import { addAppToSteam } from "./lib/appActions";
import { addToSteam, removeFromSteam } from "./lib/shortcuts";
import { styles } from "./styles";
import type { Catalog, CatalogApp, Job, Status } from "./types";

const SECTIONS = [
  { key: "emulators", title: "Emulators" },
  { key: "applications", title: "Applications" },
  { key: "scripts", title: "Scripts" },
  { key: "plugins", title: "Decky Plugins" },
];

// The QAM unmounts the panel whenever a menu or modal takes focus, so
// per-render state cannot survive a drill-down.
let rememberedView: string | null = null;
let cachedCatalog: Catalog | null = null;
// Module scope: the panel remounts constantly, and AddShortcut may have run
// before a failure, so a retry would duplicate. Removal is safe to repeat.
const autoAddAttempted = new Set<string>();
const removalInFlight = new Set<string>();

export function Content() {
  const [catalog, setCatalogState] = useState<Catalog | null>(cachedCatalog);
  const [status, setStatus] = useState<Status | null>(null);
  const [updates, setUpdates] = useState<Record<string, { latest: string }>>({});
  const [view, setViewState] = useState<string | null>(rememberedView);
  const [message, setMessage] = useState("Loading");
  const setCatalog = useCallback((next: Catalog | null) => {
    cachedCatalog = next;
    setCatalogState(next);
  }, []);
  const setView = useCallback((next: string | null) => {
    rememberedView = next;
    setViewState(next);
  }, []);
  const prevJobs = useRef(new Map<string, Job>());
  const unmounted = useRef(false);
  const statusInFlight = useRef(false);

  const refreshStatus = useCallback(async () => {
    if (statusInFlight.current) return;
    statusInFlight.current = true;
    try {
      const next = await backend.getStatus();
      if (!unmounted.current) setStatus(next);
    } catch (error) {
    } finally {
      statusInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    unmounted.current = false;
    backend.getCatalog()
      .then((data) => {
        if (!unmounted.current) setCatalog(data);
      })
      .catch((error) => {
        if (!unmounted.current) setMessage(String(error));
      });
    refreshStatus();
    backend.checkUpdates()
      .then((available) => {
        if (!unmounted.current) setUpdates(available);
      })
      .catch(() => {});
    const timer = window.setInterval(refreshStatus, 1000);
    return () => {
      unmounted.current = true;
      window.clearInterval(timer);
    };
  }, [refreshStatus]);

  const toast = useCallback((title: string, body?: string) => {
    try {
      toaster.toast({ title, body });
    } catch (error) {
    }
  }, []);

  useEffect(() => {
    if (!status || !catalog) return;
    let installFinished = false;
    for (const job of status.jobs) {
      const prev = prevJobs.current.get(job.appId);
      if (!prev || TERMINAL_PHASES.includes(prev.phase) || !TERMINAL_PHASES.includes(job.phase)) continue;
      const app = catalog.apps.find((entry) => entry.id === job.appId);
      if (!app) continue;
      if (job.phase === "error") {
        toast(app.name, job.error || "Failed");
      } else if (job.phase === "done") {
        if (job.action !== "uninstall") {
          installFinished = true;
          toast(app.name, job.action === "run" ? "Completed" : "Installed");
        } else {
          toast(app.name, "Uninstalled");
        }
      }
    }
    prevJobs.current = new Map(status.jobs.map((job) => [job.appId, job]));
    if (installFinished) {
      // Latest tags stay cached; only the installed-version comparison reruns,
      // so a just-applied update clears its badge immediately.
      backend.checkUpdates()
        .then((available) => {
          if (!unmounted.current) setUpdates(available);
        })
        .catch(() => {});
    }
  }, [status, catalog, toast]);

  const jobs = useMemo(() => {
    const map = new Map<string, Job>();
    for (const job of status?.jobs || []) map.set(job.appId, job);
    return map;
  }, [status]);

  const run = useCallback((work: Promise<unknown>, onDone?: () => void) => {
    work
      .then(() => {
        onDone?.();
        refreshStatus();
      })
      .catch((error) => toast("Armada Store", String(error)));
  }, [refreshStatus, toast]);

  // A replacement queues while its old shortcut still exists. Dropping that one
  // is its own phase so a failure retries, leaving the queued add in place.
  const dropOldShortcut = async (appId: string, previous: number) => {
    try {
      removeFromSteam(previous);
      await backend.clearShortcutRecord(appId, true, previous);
    } finally {
      removalInFlight.delete(appId);
    }
  };

  // The backend keeps the pending list until a shortcut is recorded, so an
  // install that finished with the panel closed is still picked up later.
  useEffect(() => {
    if (!status || !catalog) return;
    const pending = status.pending || [];
    for (const appId of autoAddAttempted) {
      // Off the queue: a later install or replacement gets a fresh attempt.
      if (!pending.includes(appId)) autoAddAttempted.delete(appId);
    }
    for (const appId of pending) {
      const app = catalog.apps.find((entry) => entry.id === appId);
      if (!app || !app.launch) continue;
      if (!status.installed?.[app.id]?.installed) continue;
      const previous = status.shortcuts?.[app.id];
      if (previous != null) {
        if (removalInFlight.has(app.id)) continue;
        removalInFlight.add(app.id);
        dropOldShortcut(app.id, previous).then(refreshStatus, () => {});
        continue;
      }
      if (autoAddAttempted.has(app.id)) continue;
      autoAddAttempted.add(app.id);
      run(addAppToSteam(app), () => toast(app.name, "Added to Steam"));
    }
  }, [status, catalog]);

  const openMenu = (app: CatalogApp) => {
    showContextMenu(
      <AppMenu
        app={app}
        job={jobs.get(app.id) || null}
        info={status?.installed?.[app.id] || null}
        shortcut={status?.shortcuts?.[app.id]}
        updateAvailable={updates[app.id] != null}
        run={run}
        toast={toast}
      />,
    );
  };

  // Steam's own "Add a Non-Steam Game" browse button does nothing on the ARM
  // client (ValveSoftware/steam-for-linux#9447).
  const addNonSteamGame = () => {
    const home = catalog?.home || "/var/home/armada";
    openFilePicker(FileSelectionType.FILE, home, true, true)
      .then((result) => {
        const path = result.realpath || result.path;
        if (!path) return;
        backend.prepareShortcut(path)
          .then((launch) => addToSteam(launch).then(() => toast(launch.name, "Added to Steam")))
          .catch((error) => toast("Could not add", String(error)));
      })
      .catch(() => {});
  };

  const categoryApps = (key: string) =>
    (catalog?.apps || [])
      .filter((app) => app.category === key)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  if (!catalog) {
    return (
      <PanelSection title="Armada Store">
        <PanelSectionRow>
          <div>{message}</div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  const section = SECTIONS.find((entry) => entry.key === view);
  if (section) {
    const apps = categoryApps(section.key);
    return (
      <>
        <style>{styles}</style>
        <PanelSection title={section.title}>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => setView(null)}>
              Back
            </ButtonItem>
          </PanelSectionRow>
          {apps.map((app) => (
            <AppRow
              key={app.id}
              app={app}
              job={jobs.get(app.id) || null}
              info={status?.installed?.[app.id] || null}
              updateAvailable={updates[app.id] != null}
              onMenu={() => openMenu(app)}
            />
          ))}
        </PanelSection>
      </>
    );
  }

  return (
    <>
      <style>{styles}</style>
      <PanelSection title="Armada Store">
        {SECTIONS.map(({ key, title }) => {
          const apps = categoryApps(key);
          const activeJob = apps
            .map((app) => jobs.get(app.id))
            .find((job) => job && !TERMINAL_PHASES.includes(job.phase));
          const state = activeJob ? (activeJob.percent != null ? `${activeJob.percent}%` : "...") : "";
          return (
            <PanelSectionRow key={key}>
              <ButtonItem layout="below" onClick={() => setView(key)}>
                <div className="armada-store-row">
                  {categoryIcons[key]}
                  <div className="armada-store-row-text">
                    <div className="armada-store-row-name">{title}</div>
                  </div>
                  {state && <div className="armada-store-row-state">{state}</div>}
                </div>
              </ButtonItem>
            </PanelSectionRow>
          );
        })}
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={addNonSteamGame}>
            <div className="armada-store-row">
              {categoryIcons.add}
              <div className="armada-store-row-text">
                <div className="armada-store-row-name">Add Non-Steam Game</div>
              </div>
            </div>
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
}
