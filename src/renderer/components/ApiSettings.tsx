import React, { useEffect, useState } from "react";
import CredentialInput from './CredentialInput';
import {credentialFailureText} from '../../shared/credential-errors';
import { useStudio } from "../context";
import HelpHint from "./HelpHint";
import {
  apiProviders,
  canStoreApiCredential,
  type ApiProfile,
  type CredentialStatus,
  type ApiConnectionCheck,
} from "../../shared/api-profiles";

const statusNames = {
  absent: "未保存 Key",
  stored_unverified: "已保存 · 未验证",
  unavailable: "安全存储不可用",
};
const connectionNames: Record<ApiConnectionCheck["state"], string> = {
  connected: "认证连接成功 · 生成权限与费用未核验",
  unauthorized: "认证失败 · 请核对 Key",
  forbidden: "请求被拒绝 · 权限未核验",
  credits_required: "平台返回额度不足 · 未创建任务",
  rate_limited: "平台限流 · 未自动重试",
  unavailable: "未能完成连接 · 请稍后手动重试",
  invalid_response: "响应不符合已核验合同 · 连接状态未知",
};

function ProfileCard({
  profile,
  refresh,
  simulation,
}: {
  profile: ApiProfile;
  refresh: () => Promise<void>;
  simulation: boolean;
}) {
  const [label, setLabel] = useState(profile.label);
  const [modelId,setModelId]=useState(profile.modelId??'');
  const [inputPrice,setInputPrice]=useState(profile.textPricing?String(profile.textPricing.inputMicrosPerMillionTokens/1_000_000):'');
  const [outputPrice,setOutputPrice]=useState(profile.textPricing?String(profile.textPricing.outputMicrosPerMillionTokens/1_000_000):'');
  const [priceSource,setPriceSource]=useState(profile.textPricing?.source??'');
  const [priceVersion,setPriceVersion]=useState(profile.textPricing?.version??'');
  const [responseModels,setResponseModels]=useState(profile.textPricing?.responseModelIds.join(', ')??'');
  const [secret, setSecret] = useState("");
  useEffect(()=>setSecret(''),[profile.id,profile.revision,simulation]);
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<ApiConnectionCheck | null>(null);
  const { call } = useStudio();
  const provider = apiProviders.find((p) => p.id === profile.providerId)!;
  const eligible = canStoreApiCredential(profile);
  const textApi=profile.kind==='text'&&['deepseek','doubao'].includes(profile.providerId);
  const currency=profile.providerId==='doubao'?'CNY':'USD';
  useEffect(() => {
    if(profile.kind==='image')return;
    let active = true;
    void window.rainfall
      .apiCredentialStatus({ profileId: profile.id })
      .then((r) => {
        if (active) {
          if (r.ok) setStatus(r.value);
          else setError(credentialFailureText(r.error.code));
        }
      })
      .catch(() => {
        if (active) setError("无法读取凭据状态，请稍后重试。");
      });
    return () => {
      active = false;
    };
  }, [profile.id, profile.revision, simulation]);
  useEffect(() => {
    setLabel(profile.label);
    setModelId(profile.modelId??'');setInputPrice(profile.textPricing?String(profile.textPricing.inputMicrosPerMillionTokens/1_000_000):'');
    setOutputPrice(profile.textPricing?String(profile.textPricing.outputMicrosPerMillionTokens/1_000_000):'');setPriceSource(profile.textPricing?.source??'');setPriceVersion(profile.textPricing?.version??'');setResponseModels(profile.textPricing?.responseModelIds.join(', ')??'');
    setConnection(null);
  }, [profile.id, profile.label, profile.revision, simulation]);
  const action = async (kind: "save" | "clear" | "label" | "text" | "model") => {
    setBusy(true);
    setError("");
    setConnection(null);
    try {
      if (kind === "label" || kind==='text'||kind==='model') {
        const { revision, ...metadata } = profile;
        let textMetadata={};
        if(kind==='text'){
          const hasPrice=[inputPrice,outputPrice,priceSource,priceVersion].some(v=>v.trim());
          if(hasPrice&&(!/^\d+(\.\d{1,6})?$/.test(inputPrice)||!/^\d+(\.\d{1,6})?$/.test(outputPrice)||Number(outputPrice)<=0||!priceSource.trim()||!priceVersion.trim()))throw Error('TEXT_PRICE_REQUIRED');
          textMetadata={modelId:modelId.trim()||null,textPricing:hasPrice?{currency,modelId:modelId.trim(),inputMicrosPerMillionTokens:Math.round(Number(inputPrice)*1_000_000),outputMicrosPerMillionTokens:Math.round(Number(outputPrice)*1_000_000),source:priceSource.trim(),version:priceVersion.trim(),responseModelIds:(responseModels.trim()?responseModels.split(','):[modelId]).map(v=>v.trim()).filter(Boolean)}:null};
        }
        await call("apiProfile.save", {
          profile: { ...metadata, label,...textMetadata,...(kind==='model'?{modelId:modelId.trim()||null}:{}) },
          expectedRevision: revision,
        });
        await refresh();
      } else {
        const identity = {
          profileId: profile.id,
          expectedRevision: profile.revision,
        };
        const inputSecret = secret;
        setSecret("");
        const result =
          kind === "save"
            ? await window.rainfall.writeApiCredential({
                ...identity,
                secret: inputSecret,
              })
            : await window.rainfall.clearApiCredential(identity);
        if (!result.ok) throw Error(result.error.code);
        setStatus(result.value);
      }
    } catch (e) {
      setError(credentialFailureText(e));
    } finally {
      setBusy(false);
    }
  };
  const checkConnection = async () => {
    setBusy(true);
    setError("");
    setConnection(null);
    try {
      const r = await window.rainfall.checkApiConnection({
        profileId: profile.id,
        expectedRevision: profile.revision,
      });
      if (!r.ok) throw Error(r.error.code);
      setConnection(r.value);
    } catch (e) {
      setError(credentialFailureText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article
      className="api-profile"
      data-testid="api-profile-card"
      data-profile-id={profile.id}
      aria-label={profile.label}
    >
      <div className="api-profile-heading">
        <div>
          <span className="api-eyebrow">{provider.name} / 本机配置</span>
          <h3>{profile.label}</h3>
        </div>
        <span
          className={
            "api-status " +
            (status?.state === "stored_unverified" ? "stored" : "")
          }
        >
          {profile.kind==='image'
            ? profile.providerId==='image_pending'?'图片 API 未接入':'外部导入 · 无需 API Key'
            : simulation
            ? "模拟工作区 · Key 已禁用"
            : status
              ? statusNames[status.state]
              : "正在读取状态…"}
        </span>
      </div>
      <div className="api-profile-fields">
        <label>
          配置显示名称
          <input
            aria-label="配置显示名称"
            value={label}
            maxLength={100}
            disabled={busy}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <button
          disabled={busy || !label.trim() || label.trim() === profile.label}
          onClick={() => void action("label")}
        >
          保存配置名称
        </button>
      </div>
      {textApi&&<div className="api-profile-fields" data-testid="api-text-configuration">
        <label>模型 ID / 推理接入点 ID<input aria-label="模型 ID / 推理接入点 ID" value={modelId} maxLength={200} disabled={busy} placeholder={profile.providerId==='doubao'?'doubao-seed-2-1-pro-260915 或 ep-…':'deepseek-flash'} onChange={e=>setModelId(e.target.value)}/></label>
        <label>官方 baseURL<input aria-label="官方 baseURL" value={profile.baseUrl??(profile.providerId==='doubao'?'https://ark.cn-beijing.volces.com/api/v3':'https://api.deepseek.com')} readOnly/></label>
        <details><summary>计费依据 · {currency}</summary>
          <label>输入价（{currency} / 百万 token）<input aria-label="输入价" value={inputPrice} inputMode="decimal" disabled={busy} onChange={e=>setInputPrice(e.target.value)}/></label>
          <label>输出价（{currency} / 百万 token）<input aria-label="输出价" value={outputPrice} inputMode="decimal" disabled={busy} onChange={e=>setOutputPrice(e.target.value)}/></label>
          <label>价格来源<input aria-label="价格来源" value={priceSource} maxLength={2000} disabled={busy} onChange={e=>setPriceSource(e.target.value)}/></label>
          <label>价格版本 / 核对日期<input aria-label="价格版本" value={priceVersion} maxLength={200} disabled={busy} onChange={e=>setPriceVersion(e.target.value)}/></label>
          <label>响应模型 ID<input aria-label="响应模型 ID" value={responseModels} maxLength={4000} disabled={busy} placeholder="默认与模型 ID 相同，多个用英文逗号分隔" onChange={e=>setResponseModels(e.target.value)}/></label>
          <HelpHint label="计费依据说明">填写该模型当前的官方价格。计划按币种独立预占预算；价格缺失时无法执行。若使用 ep- 推理接入点，请填写其实际响应模型 ID。</HelpHint>
        </details>
        <button disabled={busy||!modelId.trim()} onClick={()=>void action('text')}>保存模型与计费</button>
        {profile.providerId==='doubao'&&<HelpHint label="豆包连接说明">使用火山方舟 API Key，与 DeepSeek、图片服务分别配置。未提供免费认证探测；保存后保持未验证，真实生成仅按已授权计划执行。</HelpHint>}
      </div>}
      {profile.kind==='music'&&<div className="api-profile-fields"><label>底层音乐模型 ID<input aria-label="底层音乐模型 ID" value={modelId} maxLength={200} disabled={busy} onChange={e=>setModelId(e.target.value)} placeholder="填写渠道实际支持的模型 ID"/></label><button disabled={busy||!modelId.trim()} onClick={()=>void action('model')}>保存音乐模型</button><p className="muted">渠道：{provider.name}。模型可用性、价格和生成授权仍需核实；配置默认值不触发请求。</p></div>}
      {profile.kind==='image'&&<p className="notice">{profile.providerId==='image_pending'?'图片 API 尚未实现，执行保持关闭。':'外部出图 / 本地图片导入；客户端不直接调用图片模型。'} Codex 辅助出图通过外部会话完成，没有免费直连图像 API。</p>}
      {eligible && !simulation ? (
        <>
          <div className="api-profile-fields api-secret-row">
            <CredentialInput value={secret} onChange={setSecret} disabled={busy} configured={!!status?.configured} initialVisible={profile.providerId==='yourmusic'} />
            <div className="api-actions">
              <button
                className="primary"
                disabled={busy || !secret}
                onClick={() => void action("save")}
              >
                {busy ? "处理中…" : "保存 Key"}
              </button>
              <button
                disabled={busy || !status?.configured}
                onClick={() => void action("clear")}
              >
                清除 Key
              </button>
            </div>
          </div>
          <HelpHint label="凭据存储说明">
            保存后清空输入框。Key 使用 Windows 安全存储加密，不进入备份。保存
            Key 不会联网或创建音乐任务。
          </HelpHint>
          {["yourmusic", "deepseek"].includes(profile.providerId) && (
            <div className="api-connection-check">
              <button
                disabled={busy || !status?.configured}
                onClick={() => void checkConnection()}
              >
                检查连接（只读）
              </button>
              <HelpHint label="连接检查说明">
                {profile.providerId === "deepseek"
                  ? "仅查询官方模型列表，不发送歌词或发起生成。"
                  : "仅查询一页生成历史并丢弃作品内容。官方说明查询不扣积分；不会启用生成或自动重试。"}
              </HelpHint>
              {connection && (
                <p role="status" data-testid="api-connection-result">
                  {connectionNames[connection.state]} · HTTP{" "}
                  {connection.httpStatus ?? "未知"}
                  <br />
                  {connection.failureCode && (
                    <>
                      原因：{connection.failureCode}
                      <br />
                    </>
                  )}
                  检查时间：{connection.checkedAt} · 来源：
                  {connection.providerId === "deepseek"
                    ? "DeepSeek 官方模型列表"
                    : "谱乐 API 历史查询"}
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <HelpHint label="凭据录入说明">
          {profile.kind==='image'
            ? '本地或 dot 外部结果导入无需 API Key；图片生成 API 尚未接入。'
            : simulation
            ? "模拟工作区不读取或保存真实 Key"
            : "接口与模型配置完成后，再开放凭据录入。"}
        </HelpHint>
      )}
        {status?.failureCode && <p role="status">{credentialFailureText(status.failureCode)}</p>}
        {error && (
        <p role="alert" className="api-error">
          {error}
        </p>
      )}
      <div className="api-profile-foot">
        <span>{profile.kind==='image'?'导入后由你选择封面版本':'执行按任务授权与适配器能力检查'}</span>
        <span>{profile.kind==='image'?'图片生成 API：未接入':'余额 / 权限：未核验'}</span>
        <HelpHint label="配置版本说明">配置版本 {profile.revision}</HelpHint>
      </div>
    </article>
  );
}

const groups=[{id:'text',label:'歌词与提示词',hint:'DeepSeek / 豆包。每个配置独立保存模型、价格与 Key 引用。'},{id:'image',label:'封面图片',hint:'选择外部出图后导入；未接入的图片 API 保持关闭。'},{id:'music',label:'音乐生成',hint:'生成渠道与底层音乐模型分别配置，执行前检查真实可用性。'}] as const;
export default function ApiSettings({compact=false}:{compact?:boolean}={}){
 const {runtime,call}=useStudio();const[profiles,setProfiles]=useState<ApiProfile[]>([]),[role,setRole]=useState<'text'|'image'|'music'>('text'),[providerId,setProviderId]=useState('deepseek'),[label,setLabel]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[defaults,setDefaults]=useState<any>(null);const simulation=runtime.mode==='simulation';
 const refresh=async()=>{const[p,d]=await Promise.all([call('apiProfile.list'),call('generationConfig.read')]);setProfiles(p);setDefaults(d)};
 useEffect(()=>{void refresh().catch(e=>setError(e.code??e.message))},[runtime.mode]);
 const act=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();await refresh()}catch(e:any){setError(e.code??e.message)}finally{setBusy(false)}};
 const create=(e:React.FormEvent)=>{e.preventDefault();void act(async()=>{await call('apiProfile.save',{profile:{id:crypto.randomUUID(),kind:role,providerId,label:label.trim(),modelId:null,executionEnabled:false},expectedRevision:null});setLabel('')})};
 const visible=profiles.filter(p=>p.kind===role),group=groups.find(g=>g.id===role)!;
 return <section className="panel api-settings" aria-label="生成 API 配置"><div className="section-title"><h2>{role==='image'?'封面来源配置':'生成 API 配置'}</h2><span className="api-status">配置不触发生成</span></div>
 <div className="button-row" role="tablist" aria-label="生成类型">{groups.map(g=><button key={g.id} role="tab" aria-selected={role===g.id} className={role===g.id?'primary':''} onClick={()=>{setRole(g.id);setProviderId(apiProviders.find(p=>p.kind===g.id)!.id);setLabel('');setError('')}}>{g.label}</button>)}</div>
 <p className="muted">{group.hint}</p><label>默认{group.label}<select aria-label={'默认'+group.label} disabled={busy||!defaults} value={defaults?.roles[role]??''} onChange={e=>void act(()=>call('generationConfig.save',{role,profileId:e.target.value||null,expectedRevision:defaults.revision}))}><option value="">未配置 · 执行前需处理</option>{visible.map(p=><option key={p.id} value={p.id}>{p.label} · {apiProviders.find(v=>v.id===p.providerId)?.name} · {p.modelId??(role==='image'?'外部导入':'模型待配置')}</option>)}</select></label><p className="muted">三类默认值彼此独立。已创建任务保留配置快照；默认值变化后，旧计划需编辑并重新核对授权。</p>
 <form className="api-create" onSubmit={create}><label>提供商 / 渠道<select aria-label="API 平台" disabled={busy} value={providerId} onChange={e=>setProviderId(e.target.value)}>{apiProviders.filter(p=>p.kind===role).map(p=><option key={p.id} value={p.id}>{p.name}{!p.credentialInput?' · 外部导入 / 待接入':''}</option>)}</select></label><label>配置名称<input aria-label="配置名称" value={label} disabled={busy} maxLength={100} onChange={e=>setLabel(e.target.value)} placeholder="例如：个人创作默认配置"/></label><button className="primary" disabled={busy||!label.trim()} type="submit">{role==='image'?'保存封面来源':'添加 API 配置'}</button></form>
 {simulation&&<p className="notice">模拟工作区不读取或保存真实 Key</p>}{error&&<p role="alert" className="api-error">{error}</p>}<div className="api-profiles">{visible.map(p=><ProfileCard key={p.id} profile={p} refresh={refresh} simulation={simulation}/>)}</div>{!visible.length&&<p className="api-empty">尚无{group.label}配置，先选择提供商或导入方式。</p>}
 </section>;
}
