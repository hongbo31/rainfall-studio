import React, { useEffect, useRef, useState } from "react";
import HelpNote from "./HelpNote";

type Action =
  | "connectBrowser"
  | "inspect"
  | "register"
  | "list"
  | "context"
  | "start"
  | "run"
  | "reconcile"
  | "resumePicker"
  | "resumeCrop";
type PublicRows = { grants: any[]; jobs: any[] };
export type PublicationScope={publicationTaskId:string;accountId:string};
export const matchesPublicationScope=(row:any,scope?:PublicationScope)=>!scope||row?.publicationTaskId===scope.publicationTaskId&&row?.accountId===scope.accountId;
export function preparationInput(action:Action,input:unknown,workId:string,scope?:PublicationScope){
  return scope&&action!=='list'&&action!=='connectBrowser'?{...(input as Record<string,unknown>),workId,...scope}:input;
}
export function preparationRows(rows:PublicRows,scope?:PublicationScope):PublicRows{
  return {grants:rows.grants.filter(row=>matchesPublicationScope(row,scope)),jobs:rows.jobs.filter(row=>matchesPublicationScope(row,scope))};
}
type Inspection = {
  authorizationNonce?: string;
  identity: {
    subjectType: string;
    maskedKugouId: string;
    qqDisplayName: string;
    artistName: string;
    observedAt: string;
  };
  binding: { pid: number; handle: string; started: string } | {transport:"cloud-playwright";sessionId:string;pageId:string;started:string};
  page: { mode: string; route: string };
  registered: boolean;
};
type PanelProps = {
  publicationScope?:PublicationScope;
  compact?: boolean;
  data: any;
  workId: string;
  inspection: Inspection | null;
  grants: any[];
  jobs: any[];
  context: any;
  consent: boolean;
  busy: boolean;
  error: string;
  onSelectWork: (id: string) => void;
  onConsent: (consent: boolean) => void;
  onAction: (action: Action, id?: string) => void;
};
const stateNames: Record<string, string> = {
  ready: "准备就绪，等待继续",
  dispatching: "页面操作进行中，禁止重复",
  unknown: "结果未知，禁止重复",
  reconcile_required: "需只读核对，禁止重复",
  blocked: "准备已暂停",
  awaiting_terms_review: "待条款确认",
};
const stepNames: Record<string, string> = {
  locate_intake: "定位 AI 上传页",
  upload_audio: "核对或上传已授权 A",
  fill_metadata: "填写歌词、署名、工具与日期",
  set_cover: "核对并设置封面",
  save_album: "核对并留存专辑材料快照",
  advance_to_terms: "进入条款预览",
};

const preparationErrorMessages: Record<string, string> = {
  MANUAL_COVER_ACCEPTANCE_REQUIRED:
    "封面回显尚未稳定，请核对官网当前封面后再做只读检查",
  CROP_COMPLETION_REQUIRED: "尚未确认本次裁剪完成，请核对当前裁剪窗口",
  COVER_READBACK_SCOPE_CHANGED:
    "核对期间账号或页面已变化，请回到原作品后重新检查",
  COVER_READBACK_SCOPE_REQUIRED: "无法确认当前账号和作品页面，请先检查原账户",
  COVER_READBACK_INVALID_VALUE: "封面核对信息不完整，请先检查原账户",
};
const preparationErrorMessage = (code: string) =>
  preparationErrorMessages[code] ?? code;

/** Public, read-only view shared by the live bridge workspace and offline SSR checks. */
export function TmeAiPreparePanel(props: PanelProps) {
  const {
    data,
    workId,
    inspection,
    grants,
    jobs,
    context,
    consent,
    busy,
    error,
    onSelectWork,
    onConsent,
    onAction,
  } = props;
  if (data.mode !== "production") return null;
  const works = data.works ?? [];
  const grant = grants.find((g) => g.workId === workId&&matchesPublicationScope(g,props.publicationScope)),
    job = context?.job?.workId === workId&&matchesPublicationScope(context.job,props.publicationScope) ? context.job : null;
  const history = jobs.filter((j) => j.workId === workId&&matchesPublicationScope(j,props.publicationScope)),
    existing = history.length > 0;
  const canWrite = !busy && consent && !!inspection;
  const identity = inspection?.identity ?? grant?.identity;
  if (props.compact)
    return (
      <section aria-label="确认材料准备" data-testid="tme-ai-prepare-compact">
        <button disabled={busy || !workId} onClick={() => onAction("inspect")}>
          核对投稿账号
        </button>
        {inspection && (
          <p>
            {identity?.qqDisplayName} · {identity?.artistName} ·{" "}
            {identity?.maskedKugouId}
          </p>
        )}
        <label className="inline-check">
          <input
            type="checkbox"
            checked={consent}
            disabled={busy || !inspection}
            onChange={(event) => onConsent(event.target.checked)}
          />
          同意将本首音频
          A、封面和歌词发送至以上腾讯账号，并填写歌曲资料，准备到条款预览。
        </label>
        <button
          className="primary"
          disabled={!canWrite || !!grant}
          onClick={() => onAction("register")}
        >
          确认并继续准备
        </button>
        {grant && (
          <>
            <p role="status">已有准备授权，请核对原任务与当前材料。</p>
            <details>
              <summary>核对原准备记录</summary>
              <TmeAiPreparePanel {...props} compact={false} />
            </details>
          </>
        )}
        {busy && <p role="status">处理中…</p>}
        {error && <p role="alert">{preparationErrorMessage(error)}</p>}
      </section>
    );
  return (
    <section
      className="panel"
      aria-label="腾讯 AI 作品真实页面准备"
      data-testid="tme-ai-prepare"
    >
      <div className="section-title">
        <div>
          <h2>腾讯 AI 作品准备</h2>
          <p>
            仅使用已授权的 A 及其 PCM 格式兼容派生；B 禁止上传，不新增付费操作。
          </p>
        </div>
        <strong>本准备流程正式提交：0 · 未正式发布</strong>
      </div>
      <p>非独家授权 3 年 · 期间不可独家授权其他平台 · 条款未接受</p>
      <label>
        已授权作品（仅 A）
        <select
          aria-label="已授权作品（仅 A）"
          value={workId}
          disabled={busy||!!props.publicationScope}
          onChange={(e) => onSelectWork(e.target.value)}
        >
          {!works.some((w: any) => w.id === workId) && (
            <option value="">请选择已授权作品</option>
          )}
          {works.map((w: any) => (
            <option key={w.id} value={w.id}>
              {w.title} · A
            </option>
          ))}
        </select>
      </label>
      {!works.length && (
        <p className="notice">当前作品库没有本次授权作品，请先核对工作区。</p>
      )}
      <div className="button-row">
        <button disabled={busy || !workId} onClick={() => onAction("inspect")}>
          检查原账户
        </button>
        <button disabled={busy} onClick={() => onAction("list")}>
          刷新本地记录
        </button>
      </div>
      {identity ? (
        <div className="notice" aria-label="原账户绑定信息">
          <p>
            原账户：QQ 显示名 {identity.qqDisplayName} · 音乐人{" "}
            {identity.artistName} · 酷狗 ID {identity.maskedKugouId}
          </p>
          <HelpNote label="账号核验说明">
            官方可见绑定指纹（非 UID），不是 OAuth
            授权；不等于已核实平台唯一账号 ID。
          </HelpNote>
          {inspection && (
            <>
              <p>
                本次观察：
                <time dateTime={identity.observedAt}>
                  {identity.observedAt}
                </time>{" "}
                · {inspection.registered ? "已有授权登记" : "尚未登记本次授权"}
              </p>
              <details>
                <summary>窗口记录</summary>
                <small>
                  {"transport" in inspection.binding ? `云浏览器页面 ${inspection.binding.pageId}` : `绑定窗口 PID ${inspection.binding.pid} / ${inspection.binding.handle}`} · 启动{" "}
                  {inspection.binding.started}
                  ；页面 {inspection.page.mode} · {inspection.page.route}
                </small>
              </details>
            </>
          )}
          {!inspection && <p>这是历史登记信息；本次操作前请先检查原账户。</p>}
        </div>
      ) : (
        <p className="notice">尚未核对当前账户</p>
      )}
      <label className="inline-check">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy || !workId}
          onChange={(e) => onConsent(e.target.checked)}
        />
        我同意使用原账户，为本次已授权 A 准备官方页面，到条款预览即停止；不上传
        B、不接受新条款、不正式提交。
      </label>
      <div className="button-row">
        <button
          disabled={!canWrite || !workId || !!grant}
          onClick={() => onAction("register")}
        >
          登记本次授权
        </button>
        <button
          disabled={!canWrite || !grant || existing}
          onClick={() => onAction("start")}
        >
          开始准备
        </button>
        <button
          className="primary"
          disabled={!canWrite || job?.state !== "ready"}
          onClick={() => onAction("run", job?.id)}
        >
          继续准备到条款预览
        </button>
      </div>
      {busy && (
        <p role="status">正在处理，请勿重复操作或切换浏览器中的作品。</p>
      )}
      {error && (
        <p className="notice" role="alert">
          {preparationErrorMessage(error)}
        </p>
      )}
      {job && (
        <article aria-label="当前准备任务">
          <h3>{stateNames[job.state] ?? job.state}</h3>
          <p>
            当前步骤：{stepNames[job.step] ?? job.step ?? "条款预览已到达"} ·
            本地修订 {job.revision}
          </p>
          <HelpNote label="专辑记录说明">
            专辑快照为本地核对记录；不代表官网保存、正式提交或上架回执。
          </HelpNote>
          {job.localAlbumSnapshot?.externalSaveOutcome === "unknown" && (
            <p className="notice">
              可选官网保存结果未知，未重试；已核对本地材料快照，继续仅投稿前预检。
            </p>
          )}
          {job.reason && (
            <p className="notice">{preparationErrorMessage(job.reason)}</p>
          )}
          {["unknown", "reconcile_required", "dispatching"].includes(
            job.state,
          ) && <p className="notice">结果待核对 · 请勿重复上传</p>}
          {job.audioDisposition && (
            <p>
              音频记录：
              {job.audioDisposition === "verified_existing"
                ? "已核对并复用页面已有音频"
                : "客户端上传步骤已读回"}
            </p>
          )}
          <button disabled={busy} onClick={() => onAction("reconcile", job.id)}>
            只读核对
          </button>
          {job.state === "reconcile_required" &&
            job.reason === "FILE_NAME_CONTROL_REQUIRED" && (
              <div className="notice">
                <p>
                  仅限原生封面文件选择器尚未选文件，且当前账号、窗口、目录重新核对通过后一次续接；不会重开上传，也不是通用重试。最终由客户端主进程严格审核。
                </p>
                <button
                  disabled={!canWrite}
                  onClick={() => onAction("resumePicker", job.id)}
                >
                  续接原封面文件选择器
                </button>
              </div>
            )}
          {job.state === "reconcile_required" &&
            job.reason === "CROP_DIALOG_SCOPE_REQUIRED" && (
              <div className="notice">
                <p>
                  仅对现有“调整图片”分组中的确认执行一次续接；不重选封面、不重传文件。需当前账号和窗口重新核对通过，并由主进程核验原文件选择器记录及一次裁剪续接范围。
                </p>
                <button
                  disabled={!canWrite}
                  onClick={() => onAction("resumeCrop", job.id)}
                >
                  续接原封面裁剪
                </button>
              </div>
            )}
          {job.terms && (
            <div className="notice" aria-label="待确认条款">
              <h3>待条款确认 · 未接受条款</h3>
              <p>{job.terms.modeText}</p>
              <details>
                <summary>查看官方页面原文</summary>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    maxHeight: 280,
                    overflowY: "auto",
                  }}
                >
                  {job.terms.termsText}
                </pre>
              </details>
              <small style={{ overflowWrap: "anywhere" }}>
                观察时间 {job.terms.observedAt} · 条款摘要 {job.terms.termsHash}
              </small>
            </div>
          )}
        </article>
      )}
      <details open={history.length > 0}>
        <summary>本地准备历史（{history.length}）</summary>
        {!history.length && <p>尚无本地准备任务；登记授权不会上传素材。</p>}
        {history.map((item) => (
          <article key={item.id}>
            <b>{stateNames[item.state] ?? item.state}</b>
            <small>
              {" "}
              · {item.updatedAt} · 修订 {item.revision}
            </small>
            {item.reason && <p>{preparationErrorMessage(item.reason)}</p>}
            <button
              disabled={busy}
              onClick={() => onAction("context", item.id)}
            >
              查看记录
            </button>
          </article>
        ))}
      </details>
    </section>
  );
}

type WorkspaceProps={data:any;initialWorkId?:string;compact?:boolean;notify:(text:string)=>void;publicationScope?:PublicationScope};
export default function TmeAiPrepareWorkspace(props:WorkspaceProps){
  return <PrepareWorkspaceSession key={`${props.data.mode}:${props.initialWorkId??''}:${props.publicationScope?.publicationTaskId??'legacy'}:${props.publicationScope?.accountId??''}`} {...props}/>;
}
function PrepareWorkspaceSession({
  data,
  notify,
  initialWorkId,
  compact = false,
  publicationScope,
}:WorkspaceProps) {
  const [workId, setWorkId] = useState(
    () => initialWorkId ?? data.works?.[0]?.id ?? "",
  );
  const [rows, setRows] = useState<PublicRows>({ grants: [], jobs: [] });
  const [inspection, setInspection] = useState<Inspection | null>(null),
    [context, setContext] = useState<any>(null);
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const locked = useRef(false),
    mounted = useRef(false),
    selectedWork = useRef(workId);
  selectedWork.current = workId;
  const request = async (action: Action, input: unknown = {}) => {
    if (data.mode !== "production")
      throw Error("仅生产工作区可使用真实页面准备。");
    const bridge = (
      window.rainfall as unknown as {
        tmeAiPrepare?: (action: Action, input?: unknown) => Promise<any>;
      }
    ).tmeAiPrepare;
    if (!bridge) throw Error("当前客户端尚未连接 AI 页面准备服务。");
    const result = await bridge(action, preparationInput(action,input,initialWorkId??workId,publicationScope));
    if (!result?.ok)
      throw Error(result?.error?.message ?? "AI 页面准备服务返回失败。");
    return result.value;
  };
  const read = async (id?: string, scope = selectedWork.current) => {
    const result = preparationRows((await request("list")) as PublicRows,publicationScope);
    if (!mounted.current) return;
    setRows(result);
    const candidates = result.jobs.filter((j: any) => j.workId === scope);
    const chosen =
      candidates.find((j: any) => j.id === id) ?? candidates.at(-1);
    const detail = chosen ? await request("context", { id: chosen.id }) : null;
    if (mounted.current && selectedWork.current === scope) setContext(detail&&matchesPublicationScope(detail.job,publicationScope)&&matchesPublicationScope(detail.grant,publicationScope)?detail:null);
  };
  const act = async (action: Action, id?: string) => {
    if (locked.current || data.mode !== "production") return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      let result: any;
      const grant = rows.grants.find((g) => g.workId === workId),
        job = context?.job;
      if (action === "connectBrowser") {
        setInspection(null);setConsent(false);
        result = await request("connectBrowser", {port:9222,allowConnection:true});
        if (!result.connected) throw Error(result.reason ?? "CLOUD_BROWSER_SESSION_REQUIRED");
      } else if (action === "inspect") {
        setInspection(null);
        result = await request("inspect", { workId });
        if (mounted.current) setInspection(result);
      } else if (action === "list") await read();
      else if (action === "context" || action === "reconcile") {
        if (!id) throw Error("请先选择本地准备任务。");
        result = await request(action, { id });
        if (mounted.current) setContext(result&&matchesPublicationScope(result.job,publicationScope)&&matchesPublicationScope(result.grant,publicationScope)?result:null);
        await read(id);
      } else {
        if (!consent || !inspection)
          throw Error("请先检查原账户并确认本次准备范围。");
        if (action === "register") {
          if (!workId || grant) throw Error("请选择尚未登记的本次授权作品。");
          result = await request("register", { workId, consent: true, ...(inspection.authorizationNonce ? {authorizationNonce:inspection.authorizationNonce} : {}) });
        } else if (action === "start") {
          if (!grant || rows.jobs.some((j) => j.grantId === grant.id))
            throw Error("已有任务请查看记录，禁止重复开始。");
          result = await request("start", {
            grantId: grant.id,
            expectedRevision: grant.revision,
            consent: true,
          });
        } else if (action === "resumePicker") {
          if (
            !job ||
            job.id !== id ||
            job.workId !== workId ||
            job.state !== "reconcile_required" ||
            job.reason !== "FILE_NAME_CONTROL_REQUIRED"
          )
            throw Error(
              "仅可续接尚未选文件的原封面选择器；其他未知状态请只读核对。",
            );
          result = await request("resumePicker", {
            id: job.id,
            expectedRevision: job.revision,
            consent: true,
          });
        } else if (action === "resumeCrop") {
          if (
            !job ||
            job.id !== id ||
            job.workId !== workId ||
            job.state !== "reconcile_required" ||
            job.reason !== "CROP_DIALOG_SCOPE_REQUIRED"
          )
            throw Error("仅可续接现有封面裁剪分组；其他未知状态请只读核对。");
          result = await request("resumeCrop", {
            id: job.id,
            expectedRevision: job.revision,
            consent: true,
          });
        } else {
          if (
            !job ||
            job.id !== id ||
            job.workId !== workId ||
            job.state !== "ready"
          )
            throw Error("当前任务不可继续；结果未知时请只读核对。");
          result = await request("run", {
            id: job.id,
            expectedRevision: job.revision,
            consent: true,
          });
        }
        await read(result?.job?.id ?? result?.id ?? id);
        if (mounted.current)
          notify(
            action === "register"
              ? "已登记本次 A 的页面准备授权；未上传或提交。"
              : "本地准备记录已更新；未接受条款，未正式发布。",
          );
      }
    } catch (e: any) {
      if (mounted.current) {
        setError(e?.message ?? "页面准备失败，请先只读核对。");
        if (
          action === "run" ||
          action === "start" ||
          action === "resumePicker" ||
          action === "resumeCrop"
        )
          try {
            await read(id);
          } catch {
            /* Preserve the original error; refreshing never resends a write. */
          }
      }
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    if (data.mode === "production") void act("list");
    return () => {
      mounted.current = false;
    };
  }, [data.mode]);
  return (
    <TmeAiPreparePanel
      data={publicationScope?{...data,works:(data.works??[]).filter((work:any)=>work.id===initialWorkId)}:data}
      publicationScope={publicationScope}
      compact={compact}
      workId={workId}
      inspection={inspection}
      grants={rows.grants}
      jobs={rows.jobs}
      context={context}
      consent={consent}
      busy={busy}
      error={error}
      onSelectWork={(id) => {
        selectedWork.current = id;
        setWorkId(id);
        setInspection(null);
        setConsent(false);
        setContext(null);
        void read(undefined, id).catch((e) => {
          if (mounted.current) setError(e.message);
        });
      }}
      onConsent={setConsent}
      onAction={(action, id) => {
        void act(action, id);
      }}
    />
  );
}
