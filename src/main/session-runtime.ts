import net from "node:net";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
export async function acquireWorkspaceLease(root: string) {
  const identity =
    path.resolve(root).toLowerCase() + "|" + os.userInfo().username;
  const key = createHash("sha256").update(identity).digest("hex").slice(0, 32);
  const endpoint =
    process.platform === "win32"
      ? "\\\\.\\pipe\\RainfallStudio-" + key
      : path.join(os.tmpdir(), "rainfall-" + key + ".sock");
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(error.code === "EADDRINUSE"
        ? new Error("WORKSPACE_ALREADY_OWNED", { cause: error })
        : error);
    });
    server.listen({ path: endpoint, exclusive: true }, () => resolve());
  });
  server.unref();
  return {
    release: () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
type Effects = {
  show: () => void;
  hide: () => void;
  tray: (enabled: boolean) => void;
  login: (enabled: boolean) => void;
  pause: () => void;
  quit: () => void;
};
export class SessionRuntime {
  private settings = { backgroundEnabled: false, loginAtStartup: false };
  constructor(private effects: Effects) {}
  configure(
    next: { backgroundEnabled: boolean; loginAtStartup: boolean },
    confirmed: boolean,
  ) {
    if (!confirmed) throw Error("RUNTIME_CONSENT_REQUIRED");
    if (next.loginAtStartup !== this.settings.loginAtStartup)
      this.effects.login(next.loginAtStartup);
    if (next.backgroundEnabled !== this.settings.backgroundEnabled)
      this.effects.tray(next.backgroundEnabled);
    this.settings = { ...next };
    return { ...this.settings };
  }
  closeRequested() {
    if (!this.settings.backgroundEnabled) return false;
    this.effects.hide();
    return true;
  }
  pause() {
    this.effects.pause();
  }
  open() {
    this.effects.show();
  }
  quit() {
    this.effects.quit();
  }
}
