import React, { useRef, useState } from "react";
import type { PlatformAccount } from "../../shared/platform-accounts";
import type { PlatformTarget, PublicationPreview } from "../../shared/platform-config";
import { publicationWorkflowHandler, type WorkflowNodeDefinition } from "../../shared/platform-directory";
import type { WorkVersion } from "../../shared/work-versions";
import { useStudio } from "../context";
import FanqieDownloadUpload from "./FanqieDownloadUpload";
import PlatformAutomationPanel from "./PlatformAutomationPanel";
import PublicationPipelineProgress from "./PublicationPipelineProgress";
import QishuiPublisher from "./QishuiPublisher";

type DebugWork = WorkVersion & { id: string; selectedAudioVariant?: "A" | "B" };
type PipelineJob = { id: string; workId: string; accountId?: string; title: string; state: string };
type Result =
  | { kind: "preview"; report: PublicationPreview }
  | { kind: "tme"; jobs: PipelineJob[] };

const errors: Record<string, string> = {
  DOWNLOAD_ROOT_REQUIRED: "请先在配置中心设置下载目录。",
  TARGET_ACCOUNT_MISMATCH: "该账号已不适用于所选发布平台，请重新选择。",
  ACCOUNT_NOT_FOUND: "所选发布账号已移除。",
  NOT_FOUND: "所选作品已移除。",
};
const actionLabel = { preview: "执行预检", tme: "执行发布准备" };

export default function PublicationAutomationDialog({ node, platform, accounts, defaultAccountId, onClose }: {
  node: WorkflowNodeDefinition;
  platform: PlatformTarget;
  accounts: PlatformAccount[];
  defaultAccountId?: string | null;
  onClose: () => void;
}) {
  const { data, runtime, go } = useStudio();
  const [accountId, setAccountId] = useState(() => defaultAccountId ?? (accounts.length === 1 ? accounts[0].id : ""));
  const [uploading, setUploading] = useState(false);
  const account = accounts.find(row => row.id === accountId);
  const handler = data.mode === "production" && !runtime.offlineAcceptance && node.available ? publicationWorkflowHandler(platform) : undefined;
  return <PlatformAutomationPanel title={`${node.label} · ${handler === "fanqie" ? "目录上传" : "自动化调试"}`}
    onClose={onClose} closeDisabled={uploading}>
    <label>发布账号<select aria-label="发布账号" value={account?.id ?? ""} disabled={!accounts.length || uploading}
      onChange={event => setAccountId(event.target.value)}>
      <option value="">{accounts.length ? "选择账号" : "暂无账号"}</option>
      {accounts.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
    </select></label>
    {!account && handler && <p role="status">执行前请选择发布账号。</p>}
    {!accounts.length && <button type="button" onClick={() => go("platform-accounts", platform)}>管理账号</button>}
    {!handler && <p className="muted">{node.available ? "当前工作区支持本地材料预检" : "自动上传待接入 · 可执行本地材料预检"}</p>}
    {handler === "qishui" ? account && <QishuiPublisher accountId={account.id} />
      : handler === "fanqie" ? account && <FanqieDownloadUpload key={account.id} accountId={account.id} onBusy={setUploading} />
      : <PublicationAutomationForm key={`${handler}:${account?.id}`} platform={platform} account={account} kind={handler ?? "preview"} />}
  </PlatformAutomationPanel>;
}

function PublicationAutomationForm({ platform, account, kind }: {
  platform: PlatformTarget;
  account?: PlatformAccount;
  kind: Result["kind"];
}) {
  const { data, call, refresh, go } = useStudio();
  const [workId, setWorkId] = useState("");
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  const works: DebugWork[] = data.works ?? [];
  const work = works.find(row => row.id === workId);
  const canExecute = !!work && !busy && (kind === "preview" || !!account);

  const changeWork = (id: string) => {
    setWorkId(id);
    setResult(undefined);
    setError("");
  };

  const execute = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canExecute || flight.current || !work) return;
    flight.current = true;
    setBusy(true);
    setResult(undefined);
    setError("");
    try {
      if (kind === "tme" && account) {
        const { pipeline } = await call("publish.simple", {
          workIds: [work.id], targets: [platform], accountOverrides: { [platform]: account.id },
        });
        setResult({ kind, jobs: pipeline });
      } else {
        const report = await call("publish.preview", { target: platform, accountId: account?.id ?? null, workId: work.id });
        setResult({ kind: "preview", report });
      }
    } catch (cause) {
      const code = (cause as { code?: string } | null)?.code;
      setError((code && errors[code]) || (cause instanceof Error ? cause.message : "执行未完成，请检查准备材料和账号设置。"));
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };

  const liveJobs: PipelineJob[] = data.publicationPipelineJobs ?? [];
  const jobs = result?.kind === "tme" ? result.jobs.map(job => liveJobs.find(row => row.id === job.id) ?? job) : [];
  return <>
    <form onSubmit={event => void execute(event)}>
      <label>作品<select aria-label="作品" value={workId} disabled={busy} onChange={event => changeWork(event.target.value)}>
        <option value="">{works.length ? "选择作品" : "作品库暂无作品"}</option>
        {works.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
      </select></label>
      {work && kind === "tme" && <p className="muted">录音版本 · {work.selectedAudioVariant === "B" ? "B" : "A"} 版</p>}
      <button type="submit" className="primary" disabled={!canExecute}>{busy ? "正在执行…" : actionLabel[kind]}</button>
    </form>
    {error && <p className="notice" role="alert">{error}</p>}
    {result?.kind === "preview" && <section aria-label="预检结果">
      <p role="status">{result.report.title} · {result.report.recordingSlot === "audio_B" ? "B" : "A"} 版 · {result.report.issues.length ? "需补充材料或配置" : "本地材料已齐"}</p>
      {!!result.report.issues.length && <ul>{result.report.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    </section>}
    {!!jobs.length && <PublicationPipelineProgress jobs={jobs} data={data} onRefresh={refresh}
      onTrack={id => go("track", id)} onConfigure={(target, id) => go("platform-accounts", id === account?.id ? account?.provider : target)}
      onReconcile={id => call("publish.reconcile", { id })} />}
  </>;
}
