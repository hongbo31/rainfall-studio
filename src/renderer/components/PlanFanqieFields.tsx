import React,{useState} from 'react';
import type {PlanCenterPlan} from '../../shared/plan-center';
export default function PlanFanqieFields({plan,patch}:{plan:PlanCenterPlan;patch:(p:Partial<PlanCenterPlan>)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 return <fieldset><legend>上传</legend><label className="check"><input type="checkbox" checked={!!plan.fanqie&&plan.authorization.publish} disabled={busy} onChange={async e=>{
  if(!e.target.checked){patch({fanqie:undefined,authorization:{...plan.authorization,publish:plan.publishTargets.some(t=>t.enabled)}});return;}
  setBusy(true);setError('');
  try{
   const config=await window.rainfall.fanqieUpload('configuration');
   if(!config.ok||!config.value.configurationHash)throw Error('请先在配置中心保存番茄署名和发布规则。');
   const opened=await window.rainfall.fanqieCatalog('open');if(!opened.ok)throw Error(opened.error.message);
   const read=await window.rainfall.fanqieCatalog('read');if(!read.ok)throw Error(read.error.message);
   if(!read.value.report?.complete)throw Error('账号未核对，请在番茄窗口登录后重试。');
   patch({fanqie:{accountKey:read.value.report.accountKey,configurationHash:config.value.configurationHash,materialsConsent:true},authorization:{...plan.authorization,publish:true}});
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }}/>{busy?'连接番茄…':'完成后上传番茄音乐'}</label>
 <small>沿用平台配置；自动检查材料，合同由你确认。</small>
 {error&&<p role="alert">{error}</p>}</fieldset>;
}
