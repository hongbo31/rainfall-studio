import React, { useEffect, useRef, useState } from "react";
import { defaultFanqieDirectoryPreferences, fanqieDirectoryPreferencesSchema, fanqieDownloadIssues, isFanqieDownloadActive,
  type FanqieDownloadBatch, type FanqieDownloadBatchItem, type FanqieDownloadPreview, type FanqieSignatureStage } from "../../shared/fanqie-downloads";
import FanqieBatchFields, { type FanqieBatchDraft } from "./FanqieBatchFields";

const batchStatus = {
  uploading: "正在上传",
  awaiting_signature: "合同待确认",
  complete: "批次已核对",
  needs_review: "需核对投稿",
};
const signatureStatus: Record<FanqieSignatureStage, { title: string; hint?: string }> = {
  manual_confirmation: { title: "等待你确认签署", hint: "在番茄页面核对合同后，点击「确认签署」。" },
  generating: { title: "合同生成中" },
  open_signing_page: { title: "等待打开签约页", hint: "若新标签页未打开，点番茄页面的「跳转授权」。" },
  open_existing_contract: { title: "正在打开本批合同" },
  verify_generated_contract: { title: "正在核对已生成的合同", hint: "核对本批作品后，自动处理下一批。" },
  complete_signing: { title: "等待完成签署", hint: "请在签约页完成短信验证和签署，Rainfall 会核对官网回执。" },
};
const itemStatus: Record<FanqieDownloadBatchItem["state"], string> = {
  queued: "未执行",
  uploading: "上传中",
  uploaded: "已上传",
  skipped: "已跳过",
  needs_review: "待核对",
  failed: "未上传",
};
const issueText = (issue: string, title?: string) => {
  const message = fanqieDownloadIssues[issue] ?? "请打开番茄账号窗口核对当前步骤。";
  return issue === "FANQIE_COVER_READBACK_REQUIRED" && title ? `歌曲《${title}》：${message}` : message;
};

export default function FanqieDownloadUpload({ accountId, onBusy }: { accountId: string; onBusy: (busy: boolean) => void }) {
  const [preview, setPreview] = useState<FanqieDownloadPreview>();
  const [batch, setBatch] = useState<FanqieDownloadBatch | null>(null);
  const [scan, setScan] = useState(0);
  const [loading, setLoading] = useState(true);
  const [consent, setConsent] = useState(false);
  const [draft, setDraft] = useState<Partial<FanqieBatchDraft>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const flight = useRef(false);
  const running = busy || batch?.state === "uploading";

  useEffect(() => {
    let current = true;
    setLoading(true);
    setConsent(false);
    void window.rainfall.fanqieUpload("previewDownloads", { accountId }).then(reply => {
      if (!current) return;
      if (!reply.ok) throw Error(fanqieDownloadIssues[reply.error.code] ?? reply.error.message);
      const value: FanqieDownloadPreview = reply.value;
      setPreview(value);
      if (value.batch !== undefined) setBatch(value.batch);
    }).catch(cause => {
      if (current) {
        setPreview(undefined);
        setError(cause instanceof Error ? cause.message : "读取下载目录失败。");
      }
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [accountId, scan]);

  useEffect(() => {
    if (!running) return;
    let current = true;
    const timer = setInterval(() => {
      void window.rainfall.fanqieCatalog("status", { accountId }).then(reply => {
        if (current && reply.ok) setProgress(reply.value.progress ?? "");
      }).catch(() => undefined);
    }, 1000);
    return () => { current = false; clearInterval(timer); };
  }, [accountId, running]);

  useEffect(() => {
    if (busy || !batch?.hasDiagnostics || batch.state === "complete" && !batch.cleanupPending) return;
    let current = true;
    const timer = setInterval(() => {
      void window.rainfall.fanqieUpload("downloadStatus", { accountId }).then(reply => {
        if (!current || !reply.ok || reply.value?.id !== batch.id) return;
        const updated: FanqieDownloadBatch = reply.value;
        setBatch(updated);
        if (updated.state === "complete" && !updated.cleanupPending) setScan(value => value + 1);
      }).catch(() => undefined);
    }, 2000);
    return () => { current = false; clearInterval(timer); };
  }, [accountId, batch?.id, batch?.hasDiagnostics, batch?.state, batch?.cleanupPending, busy]);

  const previousBatch = batch?.state !== "complete" ? batch : null;
  const savedBatchSettings = previousBatch?.preferences;
  const savedLimit = savedBatchSettings?.limit ?? preview?.limit ?? defaultFanqieDirectoryPreferences.limit;
  const savedSignContract = savedBatchSettings?.signContract ?? preview?.signContract ?? defaultFanqieDirectoryPreferences.signContract;
  const limit = draft.limit ?? String(savedLimit);
  const signContract = draft.signContract ?? savedSignContract;
  const settings = fanqieDirectoryPreferencesSchema.safeParse({ limit: Number(limit), signContract });
  const ready = preview?.items.filter(item => !item.issue).length ?? 0;
  const blockedSummary = preview?.items.reduce<Record<string, number>>((counts, item) => {
    if (item.issue) counts[item.issue] = (counts[item.issue] ?? 0) + 1;
    return counts;
  }, {}) ?? {};
  const count = settings.success ? Math.min(ready, settings.data.limit) : 0;
  const active = isFanqieDownloadActive(batch);
  const cleanupBatch = batch?.state === "needs_review" &&
    (batch.issue === "FANQIE_DOWNLOAD_CLEANUP_FAILED" || batch.issue === "FANQIE_DOWNLOAD_CLEANUP_PENDING") ? batch : null;
  const canConfirm = !loading && !running && !active && !!preview &&
    !preview.rootIssue && settings.success && (!!cleanupBatch || !preview.configurationRequired && count > 0);
  const signature = batch?.state === "awaiting_signature" && batch.signatureStage ? signatureStatus[batch.signatureStage] : undefined;

  const run = async () => {
    if (flight.current || !canConfirm || !consent || !preview || !settings.success) return;
    flight.current = true;
    setBusy(true);
    setConsent(false);
    setProgress("");
    setError("");
    onBusy(true);
    try {
      const reply = cleanupBatch
        ? await window.rainfall.fanqieUpload("reconcileDownloads", {
          accountId, batchId: cleanupBatch.id, preferences: settings.data,
        })
        : await window.rainfall.fanqieUpload("publishDownloads", {
          accountId, fingerprint: preview.fingerprint, consent: true, ...settings.data,
          ...(previousBatch ? { replaceBatchId: previousBatch.id } : {}),
        });
      if (!reply.ok) throw Error(fanqieDownloadIssues[reply.error.code] ?? reply.error.message);
      setBatch(reply.value);
      setScan(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "番茄操作未完成。");
      setScan(value => value + 1);
    } finally {
      flight.current = false;
      setBusy(false);
      onBusy(false);
    }
  };

  const showDiagnostics = async (scanOnly = false) => {
    try {
      const reply = await window.rainfall.fanqieUpload("openDownloadDiagnostics", { accountId, scan: scanOnly });
      if (!reply.ok) throw Error(fanqieDownloadIssues[reply.error.code] ?? reply.error.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : issueText("FANQIE_DIAGNOSTICS_OPEN_FAILED"));
    }
  };

  return <>
    <form onSubmit={event => {
      event.preventDefault();
      void run();
    }}>
      <FanqieBatchFields value={{ limit, signContract }} valid={settings.success} disabled={running} onChange={changes => {
        setDraft(current => ({ ...current, ...changes }));
        setConsent(false);
      }} />
      {!!count && !active && <p className="muted">本批最多处理 {count} 首</p>}
      <label className="inline-check">
        <input type="checkbox" checked={consent} disabled={!canConfirm} onChange={event => setConsent(event.target.checked)} />
        确认本批及后续批次的发布权、AI 标注、歌手和歌词已核对，允许生成待签合同
      </label>
      <button type="submit" className="primary" disabled={!canConfirm || !consent}>执行上传</button>
    </form>
    {running && <p role="status">{progress || "正在上传本批歌曲…"}</p>}
    {error && <p className="notice" role="alert">{error}</p>}
    <section className="fanqie-downloads" aria-label="下载目录歌曲">
      <div className="section-title fanqie-download-heading">
        <h3>下载目录歌曲</h3>
        <div>
          {preview?.hasDiagnostics && <button type="button" disabled={loading || running} onClick={() => void showDiagnostics(true)}>打开扫描日志</button>}
          <button type="button" disabled={loading || running} onClick={() => { setError(""); setScan(value => value + 1); }}>重新扫描</button>
        </div>
      </div>
      {loading && <p role="status">正在扫描下载目录…</p>}
      {preview?.rootIssue && <p className="notice" role="alert">{issueText(preview.rootIssue)}</p>}
      {preview?.configurationRequired && <p className="notice" role="status">{issueText("FANQIE_CONFIGURATION_REQUIRED")}</p>}
      {preview && !preview.rootIssue && !loading && <p className="muted">
        {preview.items.length ? `共发现 ${preview.items.length} 首 · ${ready} 首待预检` : "该账号的下载目录下暂无歌曲。"}
      </p>}
      {preview && !preview.rootIssue && !loading && preview.items.length > 0 && ready === 0 && <p className="notice" role="status">
        当前没有可安全投稿的歌曲：{Object.entries(blockedSummary).map(([issue, count]) =>
          `${count} 首${fanqieDownloadIssues[issue] ?? issue}`).join("；") || "请重新扫描并查看逐首状态"}
      </p>}
      {!!preview?.items.length && <ul className="fanqie-download-list" aria-label="扫描结果" tabIndex={0}>
        {preview.items.map(item => <li key={item.id}>
          <strong>{item.title}</strong><span>{item.singer}</span>
          <small title={item.folder}>{item.folder} / {item.audioName}</small>
          {item.release && <small>{item.release.musicType === "cover" ? "翻唱" : "原创"} · {item.release.songAttribute === "multi_version" ? "多版本" : "原版"} · {item.release.ai ? "AI 作品" : "非 AI 作品"}{item.release.proofRequired ? " · 需版权证明" : ""}</small>}
          {item.issue && <small>{issueText(item.issue)}</small>}
        </li>)}
      </ul>}
    </section>
    {!busy && batch && <section aria-label="最近一批投稿">
      <div className="section-title fanqie-download-heading">
        <h3>最近一批投稿</h3>
        {batch.hasDiagnostics && <button type="button" disabled={running} onClick={() => void showDiagnostics()}>打开执行日志</button>}
      </div>
      <p role="status">{cleanupBatch ? "下载文件待回收" : signature?.title ?? batchStatus[batch.state]}</p>
      {batch.cleanupPending && <p role="status">{issueText("FANQIE_DOWNLOAD_CLEANUP_PENDING")}</p>}
      {batch.round !== undefined && <p className="muted">第 {batch.round} 批 · {batch.remaining ?? 0} 首待处理</p>}
      {signature?.hint && !batch.issue && <p className="muted">{signature.hint}</p>}
      {batch.issue && <p className="notice" role="alert">
        {issueText(batch.issue)}
        {batch.issue === "FANQIE_COVER_READBACK_REQUIRED" && batch.items.some(item => item.state === "needs_review") && <>
          <br />待核对歌曲：{batch.items.filter(item => item.state === "needs_review").map(item => item.title).join("、")}
        </>}
      </p>}
      <ul className="fanqie-download-list" aria-label="投稿结果" tabIndex={0}>
        {batch.items.map(item => <li key={item.id}>
          <strong>{item.title}</strong><span>{item.singer}</span>
          <small>{item.round ? `第 ${item.round} 批 · ` : ""}{item.officialStatus ?? itemStatus[item.state]}{item.workId ? ` · 作品 ID ${item.workId}` : ""}</small>
          {item.issue && <small>{issueText(item.issue, item.title)}</small>}
        </li>)}
      </ul>
    </section>}
  </>;
}
