import React, { useEffect, useRef, useState } from "react";
import {matchesPublicationScope,type PublicationScope} from './TmeAiPrepareWorkspace';
export function submissionResult(result:any,scope?:PublicationScope){
  if(!scope||!result)return result;
  const job=matchesPublicationScope(result.job,scope)?result.job:undefined;
  return {...result,job,jobs:(result.jobs??[]).filter((row:any)=>matchesPublicationScope(row,scope)),ready:result.ready===true&&!!job};
}
const reasons: Record<string, string> = {
  AUDIO_REQUIRED: "需要音频",
  COVER_REQUIRED: "需要封面",
  LYRICS_REQUIRED: "需要歌词",
  LYRICS_ALIGNMENT_REQUIRED: "歌词与音频待核对",
  LYRICS_MARKERS_REQUIRE_REVIEW: "歌词标记待整理",
  RIGHTS_UNCONFIRMED: "权利依据待确认",
  AI_DISCLOSURE_REQUIRED: "AI 声明待确认",
  PREPARATION_REQUIRED: "尚未完成本首歌曲官网材料准备",
  PREPARATION_SCOPE_CHANGED: "准备材料已变化，请重新核对",
  NATIVE_AI_SUBMIT_CONTRACT_UNVERIFIED: "官网提交控件待验证",
  EXTERNAL_RECEIPT_ACCOUNT_BINDING_REQUIRED: "回执尚未绑定已核实的官方账号",
  EXISTING_ALBUM_WRITE_INTEGRATION_UNVERIFIED: "已有专辑写入流程待独立验收，当前保持锁定",
  OFFICIAL_RECEIPT_CONTRACT_UNVERIFIED: "官方回执读取待验证",
  SUBMISSION_REVIEW_STALE: "条款预检已过期，请重新检查",
  TERMS_CHANGED: "官网条款已变化，请重新检查",
  AI_INTAKE_TAB_REQUIRED: "请在官网打开本首歌曲 AI 投稿页面",
  WORKSPACE_CHANGED: "工作区已切换，请重新检查",
  SUBMISSION_ALREADY_DISPATCHED: "已有提交操作，请核对原记录",
  OFFICIAL_RECORD_ALREADY_EXISTS: "已有官网投稿记录，只读核对，不会再次上传或提交",
  SUBMISSION_MATERIALS_CHANGED: "本首歌曲材料已变化",
};
const states: Record<string, string> = {
  reviewed: "待逐首授权",
  authorized: "已确认本次授权",
  accepted: "已接受本次条款",
  dispatching: "操作处理中，禁止重发",
  reconcile_required: "结果未知，禁止重发",
  reviewing: "官网审核中",
  rejected: "官网已驳回",
  published: "官网已发布",
};
type Props = {
  publicationScope?:PublicationScope;
  works: any[];
  workId: string;
  busy: boolean;
  consent: boolean;
  rightsConfirmed: boolean;
  error: string;
  result: any;
  onSelect: (id: string) => void;
  onCheck: () => void;
  onConsent: (value: boolean) => void;
  onRights: (value: boolean) => void;
  onSubmit: () => void;
  onRefresh?: () => void;
  onReconcile?: () => void;
};
export function TmeAiSubmissionPanel(p: Props) {
  if(p.publicationScope)p={...p,result:submissionResult(p.result,p.publicationScope)};
  const job = p.result?.job ?? p.result?.jobs?.at(-1),
    capability = p.result?.capability;
  const canSubmit =
    !p.busy &&
    p.result?.ready === true &&
    capability?.available === true &&
    job?.state === "reviewed" &&
    !!job.termsText &&
    p.consent &&
    p.rightsConfirmed;
  return (
    <section aria-label="腾讯 AI 提交前检查">
      <label>
        检查歌曲
        <select
          aria-label="腾讯 AI 预检歌曲"
          value={p.workId}
          disabled={p.busy||!!p.publicationScope}
          onChange={(e) => p.onSelect(e.target.value)}
        >
          {!p.workId && <option value="">选择歌曲</option>}
          {p.works.map((w) => (
            <option key={w.id} value={w.id}>
              {w.title}
            </option>
          ))}
        </select>
      </label>
      <div className="button-row">
        <button disabled={p.busy || !p.workId} onClick={p.onCheck}>
          提交前检查
        </button>
        {p.onRefresh && (
          <button disabled={p.busy || !p.workId} onClick={p.onRefresh}>
            刷新本地记录
          </button>
        )}
      </div>
      {p.busy && <p role="status">检查中…</p>}
      {p.error && <p role="alert">{p.error}</p>}
      {p.result && (
        <div aria-live="polite">
          <p>{job?.externalReceipt ? "已有官网投稿记录 · 仅支持只读核对" : p.result.ready ? "材料与当前条款已核对" : "待处理 · 尚未提交"}</p>
          {[
            ...new Set<string>([
              ...(p.result.reasons ?? []),
              ...(capability?.reasons ?? []),
            ]),
          ].map((code) => (
            <p className="notice" key={code}>
              {reasons[code] ?? "预检未完成"}
              {!reasons[code] && (
                <details>
                  <summary>诊断</summary>
                  <code>{code}</code>
                </details>
              )}
            </p>
          ))}
        </div>
      )}
      {job && (
        <>
          <p>
            {states[job.state] ?? "状态待核对"}
            {job.remoteId && ` · 记录 ${job.remoteId}`}
          </p>
          {job.termsText && (
            <details>
              <summary>本首歌曲当前授权条款</summary>
              <pre className="wrap">{job.termsText}</pre>
            </details>
          )}
          {job.receipt && (
            <><p>来源：腾讯官方审核记录 · {job.receipt.observedAt}</p>{job.receipt.platformStatusText&&<p>后台状态：{job.receipt.platformStatusText}</p>}</>
          )}
        </>
      )}
      {p.result?.ready && job?.termsText && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={p.consent}
              disabled={p.busy}
              onChange={(e) => p.onConsent(e.target.checked)}
            />
            我已阅读并同意以上本首歌曲条款
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={p.rightsConfirmed}
              disabled={p.busy}
              onChange={(e) => p.onRights(e.target.checked)}
            />
            本首音频、歌词、封面权利及 AI 声明属实
          </label>
        </>
      )}
      <div className="button-row">
        <button disabled={!canSubmit} onClick={p.onSubmit}>
          确认授权并提交审核
        </button>
        {(job?.state === "reconcile_required" || job?.externalReceipt) && p.onReconcile && (
          <button
            disabled={p.busy || !(job?.externalReceipt ? capability?.readOnlyReceiptAvailable : capability?.available)}
            onClick={p.onReconcile}
          >
            只读核对官方回执
          </button>
        )}
      </div>
    </section>
  );
}
type WorkspaceProps={data:any;initialWorkId?:string;expanded?:boolean;publicationScope?:PublicationScope};
export default function TmeAiSubmissionWorkspace(props:WorkspaceProps){
  return <SubmissionWorkspaceSession key={`${props.data.mode}:${props.initialWorkId??''}:${props.publicationScope?.publicationTaskId??'legacy'}:${props.publicationScope?.accountId??''}`} {...props}/>;
}
function SubmissionWorkspaceSession({
  data,
  initialWorkId,
  expanded = false,
  publicationScope,
}:WorkspaceProps) {
  const works = (data.works ?? []).filter((work:any)=>!publicationScope||work.id===initialWorkId),
    [workId, setWorkId] = useState(initialWorkId ?? works.at(-1)?.id ?? ""),
    [result, setResult] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false),
    [rights, setRights] = useState(false),
    generation = useRef(0),
    inFlight = useRef(false);

  const run = async (
    action: "preflight" | "status" | "authorizeAndSubmit" | "reconcile",
  ) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const token = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const job = result?.job ?? result?.jobs?.at(-1),
        input =
          action === "preflight" || action === "status"
            ? { workId }
            : action === "reconcile"
              ? { id: job.id }
              : {
                  id: job.id,
                  expectedRevision: job.revision,
                  termsHash: job.termsHash,
                  consent: true,
                  rightsConfirmed: true,
                };
      const response = await window.rainfall.tmeAiSubmission(action, publicationScope?{...input,workId,...publicationScope}:input);
      if (token !== generation.current) return;
      if (!response.ok) throw Error(response.error.message);
      setResult(
        submissionResult(action === "authorizeAndSubmit" || action === "reconcile"
          ? { ...result, ready: false, job: response.value }
          : response.value,publicationScope),
      );
      setConsent(false);
      setRights(false);
    } catch (e) {
      if (token === generation.current) {
        setError(
          e instanceof Error ? e.message : "检查未完成，请重试只读检查。",
        );
        if (action === "authorizeAndSubmit") {
          setResult({ ...result, ready: false });
          setConsent(false);
          setRights(false);
        }
      }
    } finally {
      inFlight.current = false;
      if (token === generation.current) setBusy(false);
    }
  };
  useEffect(() => {
    generation.current++;
    setWorkId(initialWorkId ?? works.at(-1)?.id ?? "");
    setResult(null);
    setError("");
    setConsent(false);
    setRights(false);
    setBusy(false);
  }, [initialWorkId, data.mode]);
  if (data.mode !== "production") return null;
  return (
    <details className="panel" open={expanded || undefined}>
      <summary>腾讯 AI 提交前检查</summary>
      <TmeAiSubmissionPanel
        publicationScope={publicationScope}
        works={works}
        workId={workId}
        busy={busy}
        consent={consent}
        rightsConfirmed={rights}
        error={error}
        result={result}
        onSelect={(id) => {
          generation.current++;
          setWorkId(id);
          setResult(null);
          setError("");
          setConsent(false);
          setRights(false);
        }}
        onCheck={() => void run("preflight")}
        onRefresh={() => void run("status")}
        onConsent={setConsent}
        onRights={setRights}
        onSubmit={() => void run("authorizeAndSubmit")}
        onReconcile={() => void run("reconcile")}
      />
    </details>
  );
}
