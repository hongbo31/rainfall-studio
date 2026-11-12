import React from 'react';
import HelpNote from './HelpNote';
import type {PlanCenterPlan} from '../../shared/plan-center';

export default function PlanMusicFields({plan:p,catalog,patch,busy,refreshModels}:{plan:PlanCenterPlan;catalog:any;patch:(p:Partial<PlanCenterPlan>)=>void;busy:boolean;refreshModels:()=>void}){
 const promptMode=p.material.source==='pule_prompt';
 const external=['yourmusic','pule'].includes(p.music.route);
 const uncapped=p.music.creditPolicy?.mode==='uncapped_existing_credits';
 const profile=catalog?.profiles.find((x:any)=>x.id===p.music.profileId);
 const models=catalog?.routes.find((x:any)=>x.id===p.music.route)?.models.filter((x:any)=>x.profileId===p.music.profileId)??[];
 const model=models.find((m:any)=>m.id===p.music.modelId);
 const change=(v:Partial<PlanCenterPlan['music']>)=>patch({music:{...p.music,...v,consent:false,creditPolicy:undefined},authorization:{...p.authorization,music:false}});
 return <fieldset><legend>音乐生成与版本</legend>{p.routing&&<p className="muted">{profile?.label??'待配置'} · {p.music.modelId??'模型未设置'}</p>}<div className="form-grid">
  <label hidden={!!p.routing||promptMode}>生成渠道<select aria-label="生成渠道" value={p.music.route} onChange={e=>change({route:e.target.value as any,profileId:undefined,profileRevision:undefined,modelId:undefined})}>{catalog?.routes.map((r:any)=><option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
  {external&&!p.routing&&<><label>账号 / API 配置<select aria-label="音乐账号配置" value={p.music.profileId??''} onChange={e=>{const profile=catalog.profiles.find((x:any)=>x.id===e.target.value);change({profileId:profile?.id,profileRevision:profile?.revision,modelId:profile?.modelId??'chirp-v6'})}}><option value="">请选择</option>{catalog?.profiles.filter((x:any)=>x.kind==='music'&&x.providerId==='yourmusic').map((x:any)=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
  <label>生成模型<select aria-label="生成模型" disabled={!profile} value={p.music.modelId??''} onChange={e=>change({modelId:e.target.value})}><option value="">请选择</option>{models.map((m:any)=><option key={m.id} value={m.id}>{m.label} · {m.accountStatus==='account-observed-success'?'账号历史成功':m.accountStatus==='stale'?'历史证据已过期':'账号可用性待核实'}</option>)}</select></label></>}
  <label hidden={promptMode}>版本选取策略<select aria-label="版本选取策略" value={p.music.versionPolicy} onChange={e=>patch({music:{...p.music,versionPolicy:e.target.value as any}})}><option value="first">选择 A 版本</option><option value="manual">保留 A/B，手动选取</option></select></label>
  {external&&!uncapped&&!promptMode&&<><label>每次计划总预算（积分）<input aria-label="音乐总预算" type="number" min={1} value={p.music.budgetCredits??''} onChange={e=>change({budgetCredits:e.target.value?Number(e.target.value):undefined})}/></label><label>每次请求预留（积分）<input aria-label="音乐单次预留" type="number" min={1} value={p.music.maxCostPerRequestCredits??''} onChange={e=>change({maxCostPerRequestCredits:e.target.value?Number(e.target.value):undefined})}/></label></>}
 </div>
 {external?<><details><summary>模型状态</summary><div className="plan-model-evidence"><span>来源：已安装接口契约 · 当前账号可用性未获验证</span><button type="button" disabled={busy||!profile} onClick={refreshModels}>刷新账号历史证据</button></div>{model?.evidence&&<p className="muted">最近 20 条历史记录中的成功证据 · 观察 {new Date(model.evidence.observedAt).toLocaleString('zh-CN')} · 有效至 {new Date(model.evidence.expiresAt).toLocaleString('zh-CN')}（24 小时）</p>}</details>
 <label className="check"><input type="checkbox" aria-label="不限制音乐积分" checked={uncapped} onChange={e=>patch({music:{...p.music,consent:e.target.checked,budgetCredits:1,maxCostPerRequestCredits:1,creditPolicy:e.target.checked?{mode:'uncapped_existing_credits',noRecharge:true,actualCostUnknown:true,consent:true}:undefined},authorization:{...p.authorization,music:e.target.checked}})}/>不限积分，按计划首数生成（不充值）</label><label className="check" hidden={uncapped}><input aria-label="授权音乐已有积分" type="checkbox" checked={p.authorization.music&&p.music.creditPolicy?.mode==='existing_credits'} onChange={e=>patch({music:{...p.music,consent:e.target.checked,creditPolicy:e.target.checked?{mode:'existing_credits',noRecharge:true,actualCostUnknown:true,consent:true}:undefined},authorization:{...p.authorization,music:e.target.checked}})}/>按预算使用已有积分（不充值）</label>
 <HelpNote label="模型与费用">支持 chirp-v6、chirp-v6-wild、chirp-v6-mini 的已安装第三方接口。历史成功不代表当前权限或余额，预留积分不是供应商报价。每次请求仅派发一次；未知结果必须核对原任务。</HelpNote></>:<p className="muted">{p.music.route==='manual'?'执行详情中可绑定同作者、同标题和最终歌词的已有作品，保留原始 A/B 音频。':'Suno 官方音乐生成接口未核实；此渠道保留待接入。'}</p>}
 </fieldset>;
}
