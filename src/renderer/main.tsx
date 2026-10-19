import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "./ui-system.css";
import "./plan-center.css";
import PlanCenter from "./pages/PlanCenter";
import HelpHint from "./components/HelpHint";
import { clientVersionLabel } from "./client-version";
import { Context, Badge } from "./context";
import Overview from "./pages/Overview";
import Create from "./pages/Create";
import Library from "./pages/Library";
import Track from "./pages/Track";
import CoverStudio from "./pages/CoverStudio";
import PublishCenter from "./pages/PublishCenter";
import Insights from "./pages/Insights";
import ConfigurationCenter from "./pages/ConfigurationCenter";
import { createSelectionWriter } from "./publish-selection";
import {
  platformTargets,
  type PlatformTarget,
  type PublishSelection,
} from "../shared/platform-config";
import ChatCreation from "./pages/ChatCreation";
const pages = [
  ["plans", "◷", "计划中心"],
  ["chat", "♫", "创作中心"],
  ["overview", "◫", "总览"],
  ["create", "✎", "手动模板"],
  ["library", "▤", "作品库"],
  ["cover", "▧", "封面工作室"],
  ["publish", "↗", "发布中心"],
  ["insights", "▥", "数据看板"],
  ["accounts", "⚙", "配置中心"],
];
function App() {
  const [data, setData] = useState<any>(null),
    [runtime, setRuntime] = useState<any>({}),
    [page, setPage] = useState("overview"),
    [id, setId] = useState(""),
    [publishSelection, setSelectionState] = useState<PublishSelection>({
      workIds: [],
      targets: [],
      accountOverrides: {},
    }),
    [configurationTarget, setConfigurationTarget] =
      useState<PlatformTarget>("netease"),
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
  const refresh = useCallback(async () => {
    const result = await window.rainfall.call("snapshot");
    if (!result.ok) throw Error(result.error.message);
    setData(result.value);
  }, []);
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
    const t = setInterval(() => {
      void refresh().catch(() => {});
    }, 1500);
    const unhandled = (e: PromiseRejectionEvent) => {
      e.preventDefault();
      notify(e.reason?.message || "操作未完成");
    };
    window.addEventListener("unhandledrejection", unhandled);
    return () => {
      clearInterval(t);
      window.removeEventListener("unhandledrejection", unhandled);
    };
  }, []);
  const call = async (method: string, input: any = {}) => {
    const r = await window.rainfall.call(method, input);
    if (!r.ok) {
      notify(r.error.message);
      throw Object.assign(Error(r.error.message),{code:r.error.code});
    }
    await refresh();
    return r.value;
  };
  const native = async (p: Promise<any>, success: string) => {
    const r = await p;
    if (!r.ok) {
      notify(r.error.message);
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
    native(window.rainfall.exportFile(kind, input), "文件已保存到所选位置");
  const go = (p: string, workId?: string) => {
    setPage(p);
    if (p === "accounts") {
      if (platformTargets.includes(workId as PlatformTarget))
        setConfigurationTarget(workId as PlatformTarget);
    } else if (workId) setId(workId);
    window.scrollTo(0, 0);
  };
  const play = (w: any, slot = "audio_A") => {
    if (!w.assets[slot]) {
      notify("这首作品还没有导入该音频版本");
      return;
    }
    setAudio({ id: w.assets[slot], title: w.title, slot });
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
  return (
    <Context.Provider value={context}>
      {runtime.previewFixture&&<div className="plan-fixture-ribbon">离线交互演示 · 全部账号与数据为隔离测试样本</div>}
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
            <Badge>
              {data.mode === "simulation"
                ? "模拟演练 · 不进行真实投稿"
                : "本地作品库"}
            </Badge>
            <select
              aria-label="工作区模式"
              value={data.mode}
              onChange={async (e) => {
                setSwitching(true);
                try {
                  await selectionWriter.current.flush();
                } catch {}
                const r = await window.rainfall.setMode(e.target.value as any);
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
            <button onClick={() => exportArtifact("backup")}>↗ 备份导出</button>
          </div>
        </header>
        <div id="content">
          {page === "plans" ? (
            <PlanCenter />
          ) : page === "chat" ? (
            <ChatCreation />
          ) : page === "overview" ? (
            <Overview />
          ) : page === "create" ? (
            <Create />
          ) : page === "library" ? (
            <Library />
          ) : page === "track" && data.works.some((w: any) => w.id === id) ? (
            <Track key={id} id={id} />
          ) : page === "cover" ? (
            <CoverStudio key={id} initialId={id} />
          ) : page === "publish" ? (
            <PublishCenter />
          ) : page === "insights" ? (
            <Insights />
          ) : page === "accounts" ? (
            <ConfigurationCenter initialTarget={configurationTarget} />
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
              : "在作品详情选择试听 A / B；已导入的音频会保留"}
          </HelpHint>
        </div>
        <audio
          ref={player}
          id="audio"
          controls={!!audio}
          hidden={!audio}
          src={audio ? "media://asset/" + audio.id : undefined}
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
createRoot(document.getElementById("root")!).render(<App />);
