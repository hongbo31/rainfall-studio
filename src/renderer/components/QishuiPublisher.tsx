import React, { useEffect, useRef, useState } from "react";
import type { QishuiFillInput, QishuiJobStage } from "../../shared/qishui";
import { workRecordingSinger } from "../../shared/local-artist";
import { workVersionTitle } from "../../shared/work-versions";
import { useStudio } from "../context";

type Credits = Pick<QishuiFillInput, "performer" | "lyricist" | "composer">;
type PlanSelection = {
  runId: string;
  accountId: string;
  workId: string;
  variant: QishuiFillInput["variant"];
  credits: Credits;
  submitted?: boolean;
};
type Job = {
  stage: QishuiJobStage;
  contractText?: string;
  contractHash?: string;
  reviewToken?: string;
};

const errors: Record<string, string> = {
  QISHUI_POSSIBLE_DUPLICATE: "官网已发现同名作品，请先核对发布记录，避免重复上传。",
  QISHUI_EXISTING_JOB_REVIEW_REQUIRED: "这首作品已有操作记录，请核对官网当前结果后继续。",
  QISHUI_MULTIPLE_TABS: "账号窗口打开了多个汽水页面，请只保留本次发布页面。",
  QISHUI_WINDOW_REQUIRED: "请先打开该账号的专属窗口。",
  QISHUI_CONTRACT_CHANGED: "合同内容已变化，请重新读取并确认当前合同。",
  QISHUI_CURRENT_CONTRACT_CONFIRMATION_REQUIRED: "本次合同确认已失效，请重新读取并确认。",
  QISHUI_CONTRACT_SCOPE_UNVERIFIED: "无法核对合同对应的作品，已停止操作。",
  QISHUI_AUTHOR_SELECTION_REQUIRED: "请在官网选择对应的作者署名后核对任务。",
  QISHUI_PERFORMER_MISMATCH: "官网表演者与所选作品不一致，请核对账号和艺人。",
  QISHUI_CATALOG_REVIEW_REQUIRED: "官网作品列表还有未核对的分页，请先排查是否已提交。",
  QISHUI_PAGE_CHANGED: "官网页面与预期不符，已停止操作，请核对当前页面。",
  WORKFLOW_QISHUI_SCOPE: "请重新打开本次计划详情，核对汽水发布的作品和账号。",
  WORKFLOW_QISHUI_VERIFICATION_REQUIRED: "请先读取本次任务记录，核对官网验证码步骤。",
  WORKSPACE_CHANGED: "工作区已变化，操作已停止。",
};
const stageLabels: Record<QishuiJobStage, string> = {
  prepared: "材料已检查",
  running: "正在处理",
  form_ready: "已填表上传，请核对官网",
  authorization: "已到授权作品页",
  contract_review: "合同待确认",
  verification_required: "等待验证码",
  unknown: "结果待核对，请勿重复上传",
};
const creditFields = [["performer", "表演者"], ["lyricist", "词作者"], ["composer", "曲作者"]] as const;
const aiTools = ["Suno", "Udio", "天音", "海绵音乐", "腾讯启明星", "天工AI", "Mureka", "其他"];

type PublisherProps = { plan?: PlanSelection; accountId?: string };

export default function QishuiPublisher({ plan, accountId }: PublisherProps) {
  const key = plan ? `${plan.runId}:${plan.accountId}:${plan.workId}:${plan.variant}` : accountId ?? "manual";
  return <QishuiPublishForm key={key} plan={plan} accountId={accountId} />;
}

function QishuiPublishForm({ plan, accountId: debugAccountId }: PublisherProps) {
  const { data, call } = useStudio();
  const [selectedAccount, setAccount] = useState("");
  const [selectedWork, setWork] = useState("");
  const [selectedVariant, setVariant] = useState<QishuiFillInput["variant"]>("A");
  const [manualCredits, setCredits] = useState<Credits>({ performer: "", lyricist: "", composer: "" });
  const [manualAi, setAi] = useState(true);
  const [aiTool, setTool] = useState(plan ? "其他" : "Suno");
  const [mode, setMode] = useState("exclusive_agency");
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [contractConfirmed, setContractConfirmed] = useState(false);
  const [submissionConfirmed, setSubmissionConfirmed] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const flight = useRef(false);
  const scope = useRef("");

  const { accountId, workId, variant, credits } = plan ?? {
    accountId: debugAccountId ?? selectedAccount, workId: selectedWork, variant: selectedVariant, credits: manualCredits,
  };
  const { performer, lyricist, composer } = credits;
  const ai = !!plan || manualAi;
  scope.current = `${accountId}:${workId}`;
  const accounts = data.accounts.filter((account: any) => account.provider === "qishui");
  const manualWork = !plan && data.works.find((work: any) => work.id === workId);
  const plannedAccount = plan && accounts.find((account: any) => account.id === accountId);
  const plannedWork = plan && data.works.find((work: any) => work.id === workId);
  const submitted = plan?.submitted || recorded;
  const resultLabel = submitted ? "用户已记录官网提交" : job ? stageLabels[job.stage] ?? "等待核对" : "待处理";
  const jobScope = { accountId, workId, ...(plan && { planRunId: plan.runId }) };

  useEffect(() => {
    setJob(null);
    setError("");
    setContractConfirmed(false);
    setSubmissionConfirmed(false);
  }, [accountId, workId]);

  const selectWork = (id: string) => {
    setWork(id);
    const work = data.works.find((work: any) => work.id === id);
    const artist = data.artists.find((artist: any) => artist.id === work?.artistId);
    const profile = artist?.accountLocalArtist ? artist.profile : undefined;
    let performer = profile?.singer ?? artist?.name ?? "";
    if (debugAccountId && work) {
      const version = work.assets?.audio_B && (work.selectedAudioVariant === "B" || !work.assets?.audio_A) ? "B" : "A";
      setVariant(version);
      performer = workRecordingSinger(work, artist, version) ?? performer;
      if (work.ai !== "unknown") setAi(work.ai === "generated" || work.ai === "assisted");
    }
    setCredits({ performer, composer: profile?.composer ?? "", lyricist: profile?.lyricist ?? "" });
  };
  const selectVersion = (version: QishuiFillInput["variant"]) => {
    setVariant(version);
    if (!debugAccountId || !manualWork) return;
    const artist = data.artists.find((artist: any) => artist.id === manualWork.artistId);
    const performer = workRecordingSinger(manualWork, artist, version) ?? "";
    setCredits(current => ({ ...current, performer }));
  };

  const act = async (method: string, input: Record<string, unknown>) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setContractConfirmed(false);
    setSubmissionConfirmed(false);
    const captured = scope.current;
    try {
      const result = await call(method, input);
      if (captured !== scope.current) return;
      if (method.startsWith("publish.qishui.")) setJob(result);
      if (method === "planCenter.qishuiSubmitted") setRecorded(true);
    } catch (error) {
      if (captured === scope.current) {
        const message = error instanceof Error ? error.message : "操作未完成";
        const code = Object.keys(errors).find(code => message.includes(code));
        setError(code ? errors[code] : message);
      }
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };

  return <details className={plan ? "plan-detail-history" : "panel"} open={debugAccountId ? true : undefined}>
    <summary>{plan ? <>汽水音乐 · <span role="status">{resultLabel}</span></> : "汽水音乐自动填表上传"}</summary>
    {plan && <p>
      <strong>{plannedWork ? workVersionTitle(plannedWork, variant === "B" ? "audio_B" : "audio_A") : "计划作品"}</strong>
      {` · ${variant} 版 · `}<span>{plannedAccount?.name ?? "计划账号"}</span>
    </p>}
    {!submitted && <fieldset disabled={busy || data.mode !== "production"}>
      {!plan && <>
        {!debugAccountId && <label>账号<select value={accountId} onChange={event => setAccount(event.target.value)}>
          <option value="">请选择</option>
          {accounts.map((account: any) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select></label>}
        <label>作品<select aria-label="作品" value={workId} onChange={event => selectWork(event.target.value)}>
          <option value="">请选择</option>
          {data.works.map((work: any) => <option key={work.id} value={work.id}>{work.title}</option>)}
        </select></label>
        <label>版本<select value={variant} disabled={!!debugAccountId && (!manualWork || !!job)}
          onChange={event => selectVersion(event.target.value === "B" ? "B" : "A")}>
          <option disabled={!!debugAccountId && !manualWork?.assets?.audio_A}>A</option>
          <option disabled={!!debugAccountId && !manualWork?.assets?.audio_B}>B</option>
        </select></label>
      </>}
      {creditFields.map(([field, label]) => <label key={field}>{label}
        <input value={credits[field]} readOnly={!!plan}
          onChange={plan ? undefined : event => setCredits({ ...manualCredits, [field]: event.target.value })} />
      </label>)}
      {!plan && <label className="check"><input type="checkbox" checked={manualAi} onChange={event => setAi(event.target.checked)} />AI 创作</label>}
      {ai && <label>AI 工具<select value={aiTool} onChange={event => setTool(event.target.value)}>
        {aiTools.map(tool => <option key={tool}>{tool}</option>)}
      </select></label>}
      <button type="button" disabled={!accountId} onClick={() => void act("accountSession.open", { accountId })}>打开账号窗口</button>
      <button type="button" disabled={!accountId || !workId || !performer || !composer || !lyricist || !!job ||
        (!!debugAccountId && !manualWork?.assets?.[`audio_${variant}`])}
        onClick={() => void act("publish.qishui.fill", {
          ...jobScope, variant, ...(debugAccountId ? { useVersionMetadata: true } : {}), performer, composer, lyricist, ai, aiTool,
        })}>填写并上传到官网</button>
      <button type="button" disabled={!accountId || !workId} onClick={() => void act("publish.qishui.status", jobScope)}>读取任务记录</button>
      {job?.stage === "form_ready" && <>
        <label>授权模式<select value={mode} onChange={event => setMode(event.target.value)}>
          <option value="exclusive_agency">独家代理发行（3年）</option>
          <option value="exclusive">独家授权（3年）</option>
          <option value="nonexclusive">非独家授权（3年）</option>
        </select></label>
        <button type="button" onClick={() => void act("publish.qishui.authorization", { ...jobScope, mode })}>进入授权作品并选择模式</button>
      </>}
      {(job?.stage === "authorization" || job?.stage === "contract_review") &&
        <button type="button" onClick={() => void act("publish.qishui.contract", jobScope)}>读取当次合同</button>}
      {job?.stage === "contract_review" && job.reviewToken && job.contractHash && job.contractText &&
        <section aria-label="当次合同确认">
          <pre tabIndex={0} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 360, overflow: "auto" }}>{job.contractText}</pre>
          <label className="check"><input type="checkbox" checked={contractConfirmed}
            onChange={event => setContractConfirmed(event.target.checked)} />我已核对本次作品、授权范围和期限，同意接受上方合同</label>
          <button type="button" disabled={!contractConfirmed} onClick={() => void act("publish.qishui.accept", {
            ...jobScope, contractHash: job.contractHash, reviewToken: job.reviewToken, confirmed: true,
          })}>接受本次合同并等待验证码</button>
        </section>}
      {job?.stage === "verification_required" && (plan ?
        <section aria-label="官网提交确认">
          <label className="check"><input type="checkbox" checked={submissionConfirmed}
            onChange={event => setSubmissionConfirmed(event.target.checked)} />我已在官网完成验证码验证并提交</label>
          <button type="button" disabled={!submissionConfirmed} onClick={() => void act("planCenter.qishuiSubmitted", {
            runId: plan.runId, accountId, workId, confirmed: true,
          })}>记录官网已提交</button>
        </section> : <p>请在专属官网窗口完成验证码验证。</p>)}
    </fieldset>}
    {!plan && job && <p role="status">{resultLabel}</p>}
    {error && !submitted && <p role="alert">{error}</p>}
  </details>;
}
