import type { AutoUpdater } from "electron";
import type { AppUpdateState, AppUpdateStatus } from "../shared/app-update";

function validatedFeedUrl(value: string): string | undefined {
  if (!value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      return undefined;
    }
    const normalized = url.toString();
    return normalized.endsWith("/") ? normalized : normalized + "/";
  } catch {
    return undefined;
  }
}

export function createAppUpdater(options: {
  updater: AutoUpdater;
  currentVersion: string;
  feedUrl: string;
  squirrelInstalled: boolean;
  squirrelFirstRun: boolean;
}): {
  status(): AppUpdateStatus;
  check(): AppUpdateStatus;
  install(): void;
} {
  const supported = options.squirrelInstalled;
  const feedUrl = validatedFeedUrl(options.feedUrl);
  let state: AppUpdateState = !supported
    ? "unsupported"
    : feedUrl
      ? options.squirrelFirstRun ? "initializing" : "idle"
      : "not-configured";
  let releaseName: string | undefined;
  let checkTimeout: ReturnType<typeof setTimeout> | undefined;
  const checkAvailableAt = options.squirrelFirstRun ? Date.now() + 10_000 : 0;

  const clearCheckTimeout = () => {
    if (checkTimeout) clearTimeout(checkTimeout);
    checkTimeout = undefined;
  };

  if (supported && feedUrl) {
    try {
      options.updater.setFeedURL({ url: feedUrl });
      options.updater.on("checking-for-update", () => {
        state = "checking";
      });
      options.updater.on("update-available", () => {
        clearCheckTimeout();
        releaseName = undefined;
        state = "downloading";
      });
      options.updater.on("update-not-available", () => {
        clearCheckTimeout();
        state = "up-to-date";
      });
      options.updater.on("update-downloaded", (_event, _notes, name) => {
        clearCheckTimeout();
        releaseName = typeof name === "string" && name.trim() ? name.trim() : undefined;
        state = "downloaded";
      });
      options.updater.on("error", () => {
        clearCheckTimeout();
        state = "error";
      });
    } catch {
      state = "error";
    }
  }

  const snapshot = (): AppUpdateStatus => {
    if (state === "initializing" && Date.now() >= checkAvailableAt) state = "idle";
    return {
      supported,
      state,
      currentVersion: options.currentVersion,
      ...(releaseName ? { releaseName } : {}),
    };
  };

  return {
    status: snapshot,
    check() {
      if (!supported || !feedUrl) return snapshot();
      if (state === "checking" || state === "downloading" || state === "downloaded") return snapshot();
      if (Date.now() < checkAvailableAt) {
        state = "initializing";
        return snapshot();
      }
      clearCheckTimeout();
      state = "checking";
      checkTimeout = setTimeout(() => {
        if (state === "checking") state = "error";
        checkTimeout = undefined;
      }, 60_000);
      checkTimeout.unref?.();
      try {
        options.updater.checkForUpdates();
      } catch {
        clearCheckTimeout();
        state = "error";
      }
      return snapshot();
    },
    install() {
      if (state !== "downloaded") throw new Error("APP_UPDATE_NOT_READY");
      options.updater.quitAndInstall();
    },
  };
}
