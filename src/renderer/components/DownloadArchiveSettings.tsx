import React, { useEffect, useRef, useState } from "react";
import { downloadArchiveErrors, type DownloadArchiveSettings as Settings } from "../../shared/download-archive";
import { useStudio } from "../context";
import HelpHint from "./HelpHint";

const errors: Record<string, string> = {
  ...downloadArchiveErrors,
  REVISION_CONFLICT: "目录配置已更新，请刷新后重试。",
};

export default function DownloadArchiveSettings() {
  const { call, notify } = useStudio();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    void call("downloadArchive.read").then(value => {
      if (active) setSettings(value);
    }).catch(() => { if (active) setError("下载目录配置读取失败，请重新打开本页。"); });
    return () => { active = false; };
  }, [call]);

  const save = async (action: "chooseDirectory" | "clearDirectory") => {
    if (!settings || inFlight.current) return;
    inFlight.current = true;
    setError("");
    setBusy(true);
    try {
      const saved = await call("downloadArchive." + action, { expectedRevision: settings.revision });
      if (saved) { setSettings(saved); notify("下载目录配置已保存"); }
    } catch (cause) {
      const code = (cause as { code?: string })?.code ?? "";
      if (code === "REVISION_CONFLICT") {
        try { setSettings(await call("downloadArchive.read")); } catch { /* Keep the last readable selection. */ }
      }
      setError(errors[code] ?? "保存配置失败，请检查文件夹。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return <section className="panel" aria-label="下载目录配置">
    <div className="section-title"><h2>下载目录</h2>
      <HelpHint label="下载目录说明">歌曲、歌词、封面、证书和发布材料保存在这里。计划产物按「音乐人账号名称_歌手名_提示词引擎」归档。</HelpHint>
    </div>
    <label>歌曲和发布材料下载位置<input readOnly value={settings?.root ?? ""} placeholder="请选择文件夹" /></label>
    <div className="button-row">
      <button type="button" disabled={!settings || busy} onClick={() => void save("chooseDirectory")}>选择下载目录</button>
      {settings?.root && <button type="button" disabled={busy} onClick={() => void save("clearDirectory")}>清除目录配置</button>}
    </div>
    {error && <p role="alert" className="notice">{error}</p>}
  </section>;
}
