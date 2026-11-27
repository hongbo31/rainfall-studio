import { connectBrowserStudio, isBrowserStudio, studioMediaUrl } from "./browser-studio";
import { workVersionTitle, type WorkVersion, type WorkVersionSlot } from "../shared/work-versions";
import { isConfiguredDownloadKind } from "../shared/download-archive";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "./ui-system.css";
import "./plan-center.css";
import "./loading-indicator.css";
import "./themes.css";
import "./account-style.css";
import { initializeTheme } from "./theme";
import ThemeToggle from "./components/ThemeToggle";
import PlanCenter from "./pages/PlanCenter";
import HelpHint from "./components/HelpHint";
import { clientVersionLabel } from "./client-version";
import { Context, Badge } from "./context";
import Overview from "./pages/Overview";
import Track from "./pages/Track";
import PublishCenter from "./pages/PublishCenter";
import Insights from "./pages/Insights";
import ConfigurationCenter from "./pages/ConfigurationCenter";
import PlatformAccounts from "./pages/PlatformAccounts";
import PlatformManagement from "./pages/PlatformManagement";
import { createSelectionWriter } from "./publish-selection";
import { createSnapshotRefresh } from "./snapshot-refresh";
import type { PublishSelection } from "../shared/platform-config";
import ChatCreation from "./pages/ChatCreation";
import { emptyCreationEditor, type CreationEditor } from "./components/CreationWorkspace";
import LyricWriting from "./pages/LyricWriting";
import BrowserPublishWorkbench from "./pages/BrowserPublishWorkbench";
import RemoteAssist from "./pages/RemoteAssist";
initializeTheme();
const pages = [
  ["chat", "♫", "创作中心"],
  ["lyric-writing", "✦", "AI作词"],
  ["platform-management", "◇", "平台管理"],
  ["plans", "◷", "计划中心"],
  ["publish", "▤", "任务中心"],
  ["overview", "◫", "总览"],
  ["insights", "▥", "数据看板"],
  ["remote-assist", "▣", "远控"],
  ["platform-accounts", "◎", "账号管理"],
  ["accounts", "⚙", "配置中心"],
];
function App() {
  const [data, setData] = useState<any>(null),
    [runtime, setRuntime] = useState<any>({}),
    [page, setPage] = useState("overview"),
    [id, setId] = useState(""),
    [creationEditors, setCreationEditors] = useState<Record<string, CreationEditor>>({}),
    [publishSelection, setSelectionState] = useState<PublishSelection>({
      workIds: [],
      targets: [],
      accountOverrides: {},
    }),
    [configurationCategory, setConfigurationCategory] = useState<"models" | "inbox" | "diagnostics">("models"),
    [toast, setToast] = useState(""),
    [audio, setAudio] = useState<any>(null),
    [fatal, setFatal] = useState(""),
    [switching, setSwitching] = useState(false);
  const player = useRef<HTMLAudioElement>(null);
  const selectionRef = useRef(publishSelection);
  const selectionMode = useRef<string | null>(null);
  const selectionWriter = useRef(
    createSelectionWriter(async (selection) => {
      const result = await window.rainfall.call(
        "publish.selection.save",
        selection,
      );
      if (!result.ok) throw Error(result.error.message);
    }),
  );
  const setPublishSelection = (selection: PublishSelection) => {
    selectionRef.current = selection;
    setSelectionState(selection);
    return selectionWriter.current.enqueue(selection);
  };
  const selected = publishSelection.workIds;
  const setSelected = (workIds: string[]) => {
    void setPublishSelection({ ...selectionRef.current, workIds }).catch(
      (error: Error) => notify(error.message),
    );
  };
  const notify = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast(""), 5000);
  }, []);
  const snapshotReader = useRef<ReturnType<typeof createSnapshotRefresh<any>> | null>(null);
  if (!snapshotReader.current) snapshotReader.current = createSnapshotRefresh(async () => {
    const result = await window.rainfall.call("snapshot");
    if (!result.ok) throw Error(result.error.message);
    return result.value;
  }, setData);
  const refresh = useCallback(() => snapshotReader.current!.refresh(), []);
  useEffect(() => {
    if (!data || selectionMode.current === data.mode) return;
    selectionMode.current = data.mode;
    const selection = data.publishSelection ?? {
      workIds: [],
      targets: [],
      accountOverrides: {},
    };
    selectionRef.current = selection;
    setSelectionState(selection);
  }, [data]);
  useEffect(() => {
    window.rainfall.call("runtime").then((r) => r.ok && setRuntime(r.value));
    void refresh().catch((e) => setFatal(e.message));
    const poll = () => {
      if (document.visibilityState !== "hidden") void snapshotReader.current!.poll().catch(() => {});
    };
    const t = setInterval(poll, 1500);
    document.addEventListener("visibilitychange", poll);
    const unhandled = (e: PromiseRejectionEvent) => {
      e.preventDefault();
      notify(e.reason?.message || "操作未完成");
    };
    window.addEventListener("unhandledrejection", unhandled);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("unhandledrejection", unhandled);
    };
  }, []);
  const call = useCallback(async (method: string, input: any = {}, { refreshSnapshot = true } = {}) => {
    const r = await window.rainfall.call(method, input);
    if (!r.ok) {
      if (refreshSnapshot) notify(r.error.message);
      throw Object.assign(Error(r.error.message),{code:r.error.code,activeRunId:r.error.activeRunId});
    }
    if (refreshSnapshot) await refresh();
    return r.value;
  }, [notify, refresh]);
  const native = async (p: Promise<any>, success: string) => {
    const r = await p;
    if (!r.ok) {
      const coverError = r.error.code === "COVER_VERSION_DUPLICATE_IMAGE" ? "A、B 两版需要使用不同的封面。" :
        r.error.code === "COVER_VERSION_AUDIO_REQUIRED" ? "请先导入 B 版音频。" : null;
      notify(coverError ?? r.error.message);
      return;
    }
    if (r.value === null) return;
    await refresh();
    notify(r.value.notice || success);
  };
  const importAsset = (role: string, workId?: string, requestId?: string) =>
    native(
      window.rainfall.pickImport(role, workId, requestId),
      "本地文件已导入",
    );
  const exportArtifact = (kind: string, input: any = {}) =>
    native(window.rainfall.exportFile(kind, input), isConfiguredDownloadKind(kind) ? "文件已保存到下载目录" : "文件已保存到所选位置");
  const go = (p: string, workId?: string) => {
    setPage(p);
    if (p === "accounts") {
      setConfigurationCategory(workId === "inbox" || workId === "diagnostics" ? workId : "models");
    } else if (p === "platform-accounts" || p === "plans") setId(workId ?? "");
    else if (workId) setId(workId);
    window.scrollTo(0, 0);
  };
  const play = (w: WorkVersion, slot: WorkVersionSlot = "audio_A") => {
    const asset = w.assets?.[slot];
    if (!asset) {
      notify("这首作品还没有导入该音频版本");
      return;
    }
    setAudio({ id: asset, title: workVersionTitle(w, slot), slot });
  };
  useEffect(() => {
    if (audio && player.current) {
      player.current.load();
      void player.current
        .play()
        .catch(() => notify("音频未能播放，请检查素材或点击播放。"));
    }
  }, [audio]);
  if (!data)
    return (
      <div className="boot">
        <div className="brand">◒ Rainfall Studio</div>
        <p>{fatal || "正在打开本地作品库…"}</p>
      </div>
    );
  const context = {
    data,
    runtime,
    call,
    refresh,
    notify,
    go,
    play,
    selected,
    setSelected,
    publishSelection,
    setPublishSelection,
    flushPublishSelection: () => selectionWriter.current.flush(),
    importAsset,
    exportArtifact,
  };
  const title = pages.find((x) => x[0] === page)?.[2] || "作品详情";
  const updateCreation = (fields: Partial<CreationEditor>) => setCreationEditors(editors => ({
    ...editors, [data.mode]: { ...(editors[data.mode] ?? emptyCreationEditor), ...fields },
  }));
  return (
    <Context.Provider value={context}>
      {runtime.previewFixture&&<div className="plan-fixture-ribbon">离线交互演示 · 全部账号与数据为隔离测试样本</div>}
      {runtime.offlineAcceptance&&<div className="plan-fixture-ribbon">离线验收 · 临时数据库 / 测试音频 · 外网与自动执行已禁用</div>}
      {switching && (
        <div className="mode-screen" role="status">
          <h2>正在切换独立工作区…</h2>
          <p>当前任务正在安全保存，请稍候。</p>
        </div>
      )}
      <aside>
        <div className="brand">
          ◒{" "}
          <b>
            Rainfall<span>STUDIO</span>
          </b>
        </div>
        <div className="workspace">个人创作空间</div>
        <nav>
          {pages.map(([key, icon, name]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => go(key)}
            >
              <span aria-hidden="true">{icon}</span>
              {name}
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <span className="dot" /> 本地素材 · 独立存储
          <small
            className="client-version"
            aria-label="客户端版本"
            aria-live="polite"
          >
            {clientVersionLabel(
              runtime,
              typeof window.rainfall?.call === "function",
            )}
          </small>
        </div>
      </aside>
      <main>
        <header>
          <div>
            工作空间 <span>/</span>
            <b>{title}</b>
          </div>
          <div className="header-right">
            <ThemeToggle />
            <Badge>
              {data.mode === "simulation"
                ? "模拟演练 · 不进行真实投稿"
                : "本地作品库"}
            </Badge>
            <select
              aria-label="工作区模式"
              value={data.mode}
              onChange={async (e) => {
                const nextMode = e.currentTarget.value as 'production' | 'simulation';
                setSwitching(true);
                try {
                  await selectionWriter.current.flush();
                } catch {}
                const r = await window.rainfall.setMode(nextMode);
                if (!r.ok) {
                  setSwitching(false);
                  notify(r.error.message);
                  return;
                }
                setAudio(null);
                selectionMode.current = null;
                selectionRef.current = {
                  workIds: [],
                  targets: [],
                  accountOverrides: {},
                };
                setSelectionState(selectionRef.current);
                setId("");
                setPage("overview");
                const info = await window.rainfall.call("runtime");
                if (info.ok) setRuntime(info.value);
                await refresh();
                setSwitching(false);
              }}
            >
              <option value="production">真实本地库</option>
              <option value="simulation">隔离模拟演练</option>
            </select>
            {!isBrowserStudio() && <button onClick={() => {
              void window.rainfall.openOfficial("browserStudio").then(result => {
                if (!result.ok) notify(result.error.message);
              }).catch(() => notify("无法打开浏览器工作台"));
            }}>浏览器工作台</button>}
            <button onClick={() => exportArtifact("backup")}>↗ 备份导出</button>
          </div>
        </header>
        <div id="content">
          <RemoteAssist key={data.mode} open={page === "remote-assist"} onOpen={() => go("remote-assist")} />
          {page === "remote-assist" ? null : page === "plans" ? (
            <PlanCenter key={data.mode} initialRunId={id} />
          ) : page === "chat" ? (
            <ChatCreation key={data.mode} draft={creationEditors[data.mode] ?? emptyCreationEditor} update={updateCreation} />
          ) : page === "lyric-writing" ? (
            <LyricWriting key={data.mode} onTransfer={({title,alternateTitle,style,lyrics}) => {
              updateCreation(lyrics === undefined
                ? { title, alternateTitle, style, lyrics: "", songType: "instrumental", musicConsent: "" }
                : { title, alternateTitle, style, lyrics, songType: "vocal", musicConsent: "" });
              go("chat");
            }} />
          ) : page === "platform-management" ? (
            <PlatformManagement key={data.mode} />
          ) : page === "overview" ? (
            <Overview />
          ) : page === "track" && data.works.some((w: any) => w.id === id) ? (
            <Track key={id} id={id} />
          ) : page === "publish" ? (
            <PublishCenter key={data.mode} />
          ) : page === "insights" ? (
            <Insights />
          ) : page === "accounts" ? (
            <ConfigurationCenter initialCategory={configurationCategory} />
          ) : page === "platform-accounts" ? (
            <PlatformAccounts key={data.mode + ":" + id} initialProvider={id}/>
          ) : (
            <Overview />
          )}
        </div>
      </main>
      <footer>
        <div id="now" className="player-summary" data-testid="player-state">
          ◒　
          {audio
            ? audio.title + " · " + (audio.slot === "audio_B" ? "B版" : "A版")
            : "尚未选择试听"}
          <HelpHint label="试听说明">
            {audio
              ? "受管本地文件 · 试听不改变发布音频"
              : "在作品列表或详情选择试听 A / B"}
          </HelpHint>
        </div>
        <audio
          ref={player}
          id="audio"
          controls={!!audio}
          hidden={!audio}
          src={audio ? studioMediaUrl("media://asset/" + audio.id) : undefined}
          onError={() =>
            audio && notify("音频缺失、损坏或格式不支持，请重新导入。")
          }
        />
        {audio && <span>本地试听 · 真实音频</span>}
      </footer>
      <div id="toast" role="status" className={toast ? "show" : ""}>
        {toast}
      </div>
    </Context.Provider>
  );
}
const root = createRoot(document.getElementById("root")!);
if (document.querySelector('meta[name="rainfall-browser-studio"]') && !connectBrowserStudio()) {
  root.render(<div className="boot"><div className="brand">◒ Rainfall Studio</div>
    <p>请使用启动文件重新打开浏览器工作台。</p></div>);
} else {
  root.render(window.rainfall ? <App /> : <BrowserPublishWorkbench />);
}
