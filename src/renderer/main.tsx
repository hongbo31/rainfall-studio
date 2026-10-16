import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import "./desktop.css";
import { Context, Badge } from "./context";
import Overview from "./pages/Overview";
import Create from "./pages/Create";
import Library from "./pages/Library";
import Track from "./pages/Track";
import CoverStudio from "./pages/CoverStudio";
import PublishCenter from "./pages/PublishCenter";
import Insights from "./pages/Insights";
import Accounts from "./pages/Accounts";
import ChatCreation from "./pages/ChatCreation";
const pages = [
  ["chat", "✦", "AI 聊天创作"],
  ["overview", "◒", "总览"],
  ["create", "✧", "创作向导"],
  ["library", "▤", "作品库"],
  ["cover", "◩", "封面工作室"],
  ["publish", "↗", "发布中心"],
  ["insights", "▥", "数据看板"],
  ["accounts", "⚙", "账号设置"],
];
function App() {
  const [data, setData] = useState<any>(null),
    [runtime, setRuntime] = useState<any>({}),
    [page, setPage] = useState("overview"),
    [id, setId] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [toast, setToast] = useState(""),
    [audio, setAudio] = useState<any>(null),
    [fatal, setFatal] = useState(""),
    [switching, setSwitching] = useState(false);
  const player = useRef<HTMLAudioElement>(null);
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
      throw Error(r.error.message);
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
  const importAsset = (role: string, workId?: string) =>
    native(window.rainfall.pickImport(role, workId), "本地文件已导入");
  const exportArtifact = (kind: string, input: any = {}) =>
    native(window.rainfall.exportFile(kind, input), "文件已保存到所选位置");
  const go = (p: string, workId?: string) => {
    setPage(p);
    if (workId) setId(workId);
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
    importAsset,
    exportArtifact,
  };
  const title = pages.find((x) => x[0] === page)?.[2] || "作品详情";
  return (
    <Context.Provider value={context}>
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
        <div className="workspace">
          个人创作空间
          <small>
            {data.mode === "simulation"
              ? "SIMULATION WORKSPACE"
              : "LOCAL WORKSPACE"}
          </small>
        </div>
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
          <small>让每一个故事，被听见。</small>
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
                : "本地模式 · 外部服务未接入"}
            </Badge>
            <select
              aria-label="工作区模式"
              value={data.mode}
              onChange={async (e) => {
                setSwitching(true);
                const r = await window.rainfall.setMode(e.target.value as any);
                if (!r.ok) {
                  setSwitching(false);
                  notify(r.error.message);
                  return;
                }
                setAudio(null);
                setSelected([]);
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
          {page === "chat" ? (
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
            <Accounts />
          ) : (
            <Overview />
          )}
        </div>
      </main>
      <footer>
        <div id="now">
          ◒　
          {audio
            ? audio.title + " · " + (audio.slot === "audio_B" ? "B版" : "A版")
            : "尚未导入音频"}
          <small>
            {audio ? "受管本地文件 · 不上传" : "请选择作品并导入自己的音频"}
          </small>
        </div>
        <audio
          ref={player}
          id="audio"
          controls
          src={audio ? "media://asset/" + audio.id : undefined}
          onError={() =>
            audio && notify("音频缺失、损坏或格式不支持，请重新导入。")
          }
        />
        <span>本地试听 · 真实音频</span>
      </footer>
      <div id="toast" role="status" className={toast ? "show" : ""}>
        {toast}
      </div>
    </Context.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
