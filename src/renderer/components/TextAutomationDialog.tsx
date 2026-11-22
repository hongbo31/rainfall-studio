import React, { useEffect, useId, useRef, useState } from "react";
import type { ApiProfile } from "../../shared/api-profiles";
import { credentialFailureText } from "../../shared/credential-errors";
import { lyricResultVersion, type LyricJob } from "../../shared/lyric-writing";
import { useStudio } from "../context";

const jobStatuses: Record<LyricJob["state"], string> = {
  ready: "等待执行",
  dispatching: "正在调用模型",
  complete: "作词与评分已完成",
  rejected: "评分已完成 · 未达标",
  stopped: "测试已停止",
  blocked: "执行中断 · 请在 AI 作词查看详情",
  unknown: "结果待核对 · 请在 AI 作词查看详情",
};

export default function TextAutomationDialog({ title, profiles, defaultProfileId, onClose }: {
  title: string;
  profiles: ApiProfile[];
  defaultProfileId?: string | null;
  onClose: () => void;
}) {
  const { go } = useStudio();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const flight = useRef(false);
  const [profileId, setProfileId] = useState(() =>
    profiles.find(profile => profile.id === defaultProfileId)?.id ?? (profiles.length === 1 ? profiles[0].id : ""));
  const [inspiration, setInspiration] = useState("写一首简短的中文歌，主题是回家路上亮起的街灯。");
  const [job, setJob] = useState<LyricJob>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const profile = profiles.find(item => item.id === profileId);
  const runningId = job && (job.state === "ready" || job.state === "dispatching") ? job.id : undefined;
  const version = job && lyricResultVersion(job);

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  useEffect(() => {
    if (!runningId) return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    async function read(id: string) {
      try {
        const result = await window.rainfall.call("lyricWriting.read", { id });
        if (!result.ok) throw Error(result.error.message);
        if (!mounted) return;
        setJob(result.value);
        setError("");
      } catch {
        if (mounted) setError("暂时无法刷新测试进度。");
      }
      if (mounted) timer = setTimeout(() => void read(id), 1_200);
    }
    timer = setTimeout(() => void read(runningId), 1_200);
    return () => { mounted = false; clearTimeout(timer); };
  }, [runningId]);

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile?.modelId || !profile.textPricing || !inspiration.trim() || runningId || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setJob(undefined);
    try {
      const status = await window.rainfall.apiCredentialStatus({ profileId: profile.id });
      if (!dialog.current?.open) return;
      if (!status.ok) throw Error(credentialFailureText(status.error.code));
      if (!status.value.configured) throw Error("请先在模型 API 中保存所选配置的 API Key。");
      const result = await window.rainfall.call("lyricWriting.start", {
        id: crypto.randomUUID(), mode: "inspiration", artistId: null, inspiration: inspiration.trim(),
        profileId: profile.id, profileRevision: profile.revision, maxRewrites: 0, consent: true,
      });
      if (!result.ok) throw Error(result.error.message);
      setJob(result.value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法启动模型测试，请检查配置。");
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }

  return <dialog ref={dialog} className="platform-automation-dialog scroll-panel" aria-labelledby={titleId} onClose={onClose}>
    <div className="section-title">
      <h2 id={titleId}>{title} · 自动化调试</h2>
      <button type="button" onClick={() => dialog.current?.close()}>关闭</button>
    </div>
    <div className="scroll-panel-body">
      <form className="platform-text-test" onSubmit={event => void start(event)}>
        <label>模型配置<select aria-label="模型配置" value={profile?.id ?? ""} disabled={busy || !!runningId || !profiles.length}
          onChange={event => { setProfileId(event.target.value); setJob(undefined); setError(""); }}>
          <option value="">{profiles.length ? "请选择配置" : "暂无该平台的模型配置"}</option>
          {profiles.map(item => <option key={item.id} value={item.id}>{item.label}{item.modelId ? " · " + item.modelId : ""}</option>)}
        </select></label>
        {(!profiles.length || profile && (!profile.modelId || !profile.textPricing)) &&
          <div className="row actions">
            {profile && <small className="muted">请填写模型和计价。</small>}
            <button type="button" onClick={() => go("accounts", "models")}>配置模型 API</button>
          </div>}
        <label>测试内容<textarea required aria-label="测试内容" rows={3} maxLength={16_000}
          disabled={busy || !!runningId} value={inspiration} onChange={event => setInspiration(event.target.value)} /></label>
        <div className="row actions">
          <button type="submit" className="primary"
            disabled={!profile?.modelId || !profile.textPricing || !inspiration.trim() || busy || !!runningId}>
            开始测试
          </button>
          <small className="muted">作词和评分按模型用量计费。</small>
        </div>
      </form>
      {error && <p role="alert" className="notice">{error}</p>}
      {job && <section aria-label="文本测试结果">
        <p role="status">{job.state === "dispatching" && job.phase === "score" ? "正在评分" : jobStatuses[job.state]}</p>
        {version && <>
          <p>{version.title} · {version.alternateTitle}{version.review ? ` · ${version.review.score} 分` : ""}</p>
          <p className="platform-text-output">{version.lyrics}</p>
        </>}
      </section>}
    </div>
  </dialog>;
}
