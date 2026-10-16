import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  dialog,
  shell,
  utilityProcess,
  net,
  safeStorage,
  Tray,
  Menu,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { validate } from "../shared/schemas";
import type { Mode } from "../shared/contracts";
import { CredentialVault } from "./credentials";
import {
  ApiCredentials,
  registerApiCredentialHandlers,
} from "./api-credentials";
import { acquireWorkspaceLease, SessionRuntime } from "./session-runtime";
import { resolveDataRoot } from "./data-root";
if (require("electron-squirrel-startup")) app.quit();
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  {
    scheme: "media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
const root = resolveDataRoot(process.env.RAINFALL_DATA_ROOT,
  process.env.RAINFALL_PREVIEW_DATA_ROOT, app.getPath("appData"));
fs.mkdirSync(path.join(root, "runtime"), { recursive: true });
app.setPath("userData", path.join(root, "runtime"));
app.setPath("crashDumps", path.join(root, "runtime", "crashes"));
app.disableHardwareAcceleration();
let switching = false;
let restarts = 0;
let mode: Mode =
  process.env.RAINFALL_MODE === "simulation" ? "simulation" : "production";
let child: ReturnType<typeof utilityProcess.fork>;
let window: BrowserWindow;
let lease: Awaited<ReturnType<typeof acquireWorkspaceLease>> | undefined;
let tray: Tray | undefined;
const sessionRuntime = new SessionRuntime({
  show: () => {
    window?.show();
    window?.focus();
  },
  hide: () => window?.hide(),
  tray: (enabled) => {
    if (!enabled) {
      tray?.destroy();
      tray = undefined;
      return;
    }
    if (!tray) {
      tray = new Tray(path.join(app.getAppPath(), "assets", "rainfall.ico"));
      tray.setToolTip("Rainfall Studio · 后台运行；关机和注销时不执行");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "打开工作台", click: () => sessionRuntime.open() },
          { label: "暂停自动创作", click: () => sessionRuntime.pause() },
          { label: "退出应用", click: () => sessionRuntime.quit() },
        ]),
      );
      tray.on("double-click", () => sessionRuntime.open());
    }
  },
  login: (enabled) => app.setLoginItemSettings({ openAtLogin: enabled }),
  pause: () => {
    void rpc("internal.pauseAutomation").catch(() => undefined);
  },
  quit: () => app.quit(),
});
// Activation is intentionally unavailable in this build. No configure(true) call or OS registration.
let ready: Promise<void>;
let coreGeneration = 0;
const apiCredentials = new ApiCredentials({
  vault: new CredentialVault(path.join(root, "credentials"), safeStorage),
  context: () => ({
    mode: switching || closing ? "unavailable" : mode,
    generation: coreGeneration,
  }),
  getProfile: async (id) => {
    const result = await rpc("apiProfile.list");
    if (!result.ok) throw Error("PROFILE_LOOKUP_FAILED");
    return result.value.find((profile: { id: string }) => profile.id === id);
  },
});
const pending = new Map<
  string,
  { resolve: (v: any) => void; reject: (e: any) => void; timer: NodeJS.Timeout }
>();
function startCore() {
  coreGeneration++;
  ready = new Promise((resolve, reject) => {
    child = utilityProcess.fork(
      path.join(__dirname, "core.cjs"),
      [root, mode],
      { stdio: "pipe", serviceName: "Rainfall Core" },
    );
    const worker = child;
    child.stdout?.on("data", (b) => console.log(b.toString()));
    child.stderr?.on("data", (b) => console.error(b.toString()));
    child.on("message", (m) => {
      if (m.ready) {
        resolve();
        return;
      }
      const p = pending.get(m.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(m.id);
        p.resolve(m.result);
      }
    });
    child.on("exit", (code) => {
      if (child !== worker) return;
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("CORE_EXITED"));
      }
      pending.clear();
      if (code) reject(new Error("CORE_START_FAILED"));
      if (window && !closing && !switching && restarts++ < 3) {
        startCore();
        ready.catch(() => undefined);
      }
    });
  });
}
async function rpc(method: string, input: any = {}) {
  await ready;
  return new Promise<any>((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("OPERATION_TIMEOUT"));
    }, 180000);
    pending.set(id, { resolve, reject, timer });
    child.postMessage({ id, method, input });
  });
}
function trusted(event: Electron.IpcMainInvokeEvent) {
  if (
    event.senderFrame !== window.webContents.mainFrame ||
    !event.senderFrame.url.startsWith("app://ui/")
  )
    throw Error("IPC_SOURCE_REJECTED");
}
async function safe(fn: () => any) {
  try {
    return await fn();
  } catch (e: any) {
    return {
      ok: false,
      error: {
        code:
          e.message === "METHOD_NOT_ALLOWED"
            ? "METHOD_NOT_ALLOWED"
            : "REQUEST_REJECTED",
        message:
          e.message === "METHOD_NOT_ALLOWED"
            ? "不允许的操作"
            : "操作失败，请检查输入或本地文件。",
      },
    };
  }
}
const official: Record<string, string> = {
  suno: "https://suno.com",
  yourmusic: "https://app.yourmusic.fun/create",
  netease: "https://music.163.com/st/musician",
  qishui: "https://music.douyin.com/home",
  qqmusic: "https://y.tencentmusic.com/",
  kugou: "https://y.tencentmusic.com/",
  tme: "https://y.tencentmusic.com/",
  douyin: "https://creator.douyin.com/",
};
function handlers() {
  registerApiCredentialHandlers(
    (channel, handler) => ipcMain.handle(channel, handler),
    trusted,
    apiCredentials,
  );
  ipcMain.handle("rainfall:call", (e, method, input) =>
    safe(async () => {
      trusted(e);
      const parsed = validate(method, input);
      if (method === "runtime")
        return {
          ok: true,
          value: {
            mode,
            root,
            versions: process.versions,
            packaged: app.isPackaged,
            externalConnections: 0,
          },
        };
      return method === "apiProfile.save"
        ? apiCredentials.runExclusive(() => rpc(method, parsed))
        : rpc(method, parsed);
    }),
  );
  ipcMain.handle("rainfall:import", (e, role, workId) =>
    safe(async () => {
      trusted(e);
      if (
        ![
          "audio_A",
          "audio_B",
          "cover",
          "rights",
          "report",
          "legacy",
          "backup",
        ].includes(role)
      )
        throw Error("ROLE");
      if (workId && !/^[a-f0-9-]{36}$/.test(workId)) throw Error("WORK_ID");
      const r = await dialog.showOpenDialog(window, {
        title: role === "backup" ? "选择备份恢复" : "导入本地文件",
        properties: ["openFile"],
      });
      if (r.canceled) return { ok: true, value: null };
      if (role === "legacy") {
        const preview = await rpc("internal.previewLegacy", {
          source: r.filePaths[0],
        });
        if (!preview.ok) return preview;
        const confirmation = await dialog.showMessageBox(window, {
          type: "question",
          title: "原型迁移预览",
          message: "将导入 " + preview.value.works + " 首作品到隔离模拟库。",
          detail:
            "旧音频blob无法迁移；需要重新导入 " +
            preview.value.missingAudio +
            " 首音频。原型数据保留，不恢复真实发布状态。",
          buttons: ["确认导入", "取消"],
          defaultId: 1,
          cancelId: 1,
        });
        if (confirmation.response !== 0) return { ok: true, value: null };
      }
      const performImport = () =>
        rpc("internal.import", { role, workId, source: r.filePaths[0] });
      return role === "backup"
        ? apiCredentials.runExclusive(performImport)
        : performImport();
    }),
  );
  ipcMain.handle("rainfall:export", (e, kind, input) =>
    safe(async () => {
      trusted(e);
      if (
        !["backup", "materials", "coverTask", "cover", "diagnostics"].includes(
          kind,
        )
      )
        throw Error("KIND");
      const ext =
        kind === "backup"
          ? "rainfall-backup.zip"
          : kind === "materials"
            ? "zip"
            : kind === "cover"
              ? "png"
              : "txt";
      const r = await dialog.showSaveDialog(window, {
        defaultPath: `Rainfall-${kind}-${Date.now()}.${ext}`,
      });
      if (r.canceled) return { ok: true, value: null };
      return rpc("internal.export", { kind, input, destination: r.filePath });
    }),
  );
  ipcMain.handle("rainfall:mode", (e, next) =>
    safe(() =>
      apiCredentials.runExclusive(async () => {
        trusted(e);
        if (!["production", "simulation"].includes(next)) throw Error("MODE");
        switching = true;
        try {
          await rpc("internal.close");
          child.kill();
          mode = next;
          startCore();
          await ready;
          return { ok: true, value: { mode } };
        } finally {
          switching = false;
        }
      }),
    ),
  );
  ipcMain.handle("rainfall:official", (e, provider) =>
    safe(async () => {
      trusted(e);
      if (!official[provider]) throw Error("PROVIDER");
      await shell.openExternal(official[provider]);
      return { ok: true, value: true };
    }),
  );
}
app
  .whenReady()
  .then(async () => {
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }
    lease = await acquireWorkspaceLease(root);
    startCore();
    await ready;
    protocol.handle("app", (request) => {
      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname);
      const target = path.resolve(__dirname, "ui", "." + rel);
      const allowed = path.resolve(__dirname, "ui");
      if (url.host !== "ui" || !target.startsWith(allowed + path.sep))
        return new Response("Forbidden", { status: 403 });
      return net.fetch("file:///" + target.replace(/\\/g, "/"));
    });
    protocol.handle("media", async (request) => {
      try {
        const url = new URL(request.url);
        const id = url.pathname.slice(1);
        if (url.host !== "asset" || !/^[a-f0-9-]{36}$/.test(id))
          return new Response("Not found", { status: 404 });
        const r = await rpc("internal.locate", { id });
        if (!r.ok) return new Response("Missing asset", { status: 404 });
        const { file, mime, bytes } = r.value;
        let start = 0,
          end = bytes - 1,
          status = 200;
        const range = request.headers.get("range");
        if (range) {
          const m = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!m)
            return new Response(null, {
              status: 416,
              headers: { "Content-Range": `bytes */${bytes}` },
            });
          if (!m[1]) {
            start = Math.max(0, bytes - Number(m[2]));
          } else {
            start = Number(m[1]);
            if (m[2]) end = Math.min(end, Number(m[2]));
          }
          if (start > end || start >= bytes)
            return new Response(null, {
              status: 416,
              headers: { "Content-Range": `bytes */${bytes}` },
            });
          status = 206;
        }
        const headers: Record<string, string> = {
          "Content-Type": mime,
          "Accept-Ranges": "bytes",
          "Content-Length": String(end - start + 1),
          "Cache-Control": "no-store",
        };
        if (status === 206)
          headers["Content-Range"] = `bytes ${start}-${end}/${bytes}`;
        return new Response(
          Readable.toWeb(fs.createReadStream(file, { start, end })) as any,
          { status, headers },
        );
      } catch {
        return new Response("Media unavailable", { status: 404 });
      }
    });
    window = new BrowserWindow({
      width: 1440,
      height: 1000,
      minWidth: 1000,
      minHeight: 700,
      title: "Rainfall Studio",
      backgroundColor: "#101015",
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    window.removeMenu();
    window.on("close", (event) => {
      if (!closing && sessionRuntime.closeRequested()) event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (e, url) => {
      if (!url.startsWith("app://ui/")) e.preventDefault();
    });
    window.webContents.session.setPermissionRequestHandler(
      (_wc, _permission, callback) => callback(false),
    );
    handlers();
    await window.loadURL("app://ui/index.html");
    window.show();
  })
  .catch((err) => {
    console.error(err);
    app.exit(1);
  });
let closing = false;
app.on("before-quit", (e) => {
  if (!closing && child) {
    e.preventDefault();
    closing = true;
    rpc("internal.close").finally(() => {
      child.kill();
      app.quit();
    });
  }
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  tray?.destroy();
  void lease?.release();
});
app.on("second-instance", () => {
  window?.show();
  window?.focus();
});
