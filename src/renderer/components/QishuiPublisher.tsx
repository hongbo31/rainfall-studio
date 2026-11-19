import React,{useEffect,useRef,useState} from 'react';
import {useStudio} from '../context';
const errors:Record<string,string>={
 QISHUI_POSSIBLE_DUPLICATE:'官网已发现同名作品，请先核对发布记录，避免重复上传。',
 QISHUI_EXISTING_JOB_REVIEW_REQUIRED:'这首作品已有操作记录，请核对官网当前结果后继续。',
 QISHUI_MULTIPLE_TABS:'账号窗口打开了多个汽水页面，请只保留本次发布页面。',
 QISHUI_WINDOW_REQUIRED:'请先打开该账号的专属窗口。',
 QISHUI_CONTRACT_CHANGED:'合同内容已变化，请重新读取并确认当前合同。',
 QISHUI_CURRENT_CONTRACT_CONFIRMATION_REQUIRED:'本次合同确认已失效，请重新读取并确认。',
 QISHUI_CONTRACT_SCOPE_UNVERIFIED:'无法核对合同对应的作品，已停止操作。',
 QISHUI_AUTHOR_SELECTION_REQUIRED:'请在官网选择对应的作者署名后核对任务。',
 QISHUI_PERFORMER_MISMATCH:'官网表演者与所选作品不一致，请核对账号和艺人。',
 QISHUI_CATALOG_REVIEW_REQUIRED:'官网作品列表还有未核对的分页，请先排查是否已提交。',
 QISHUI_PAGE_CHANGED:'官网页面与预期不符，已停止操作，请核对当前页面。',
 WORKSPACE_CHANGED:'工作区已变化，操作已停止。',
};
export default function QishuiPublisher(){
 const {data,call}=useStudio();
 const [accountId,setAccount]=useState(''),[workId,setWork]=useState(''),[variant,setVariant]=useState('A');
 const [performer,setPerformer]=useState(''),[lyricist,setLyricist]=useState(''),[composer,setComposer]=useState('');
 const [ai,setAi]=useState(true),[aiTool,setTool]=useState('Suno'),[mode,setMode]=useState('exclusive_agency');
 const [busy,setBusy]=useState(false),[job,setJob]=useState<any>(null),[error,setError]=useState('');
 const [confirmed,setConfirmed]=useState(false);
 const flight=useRef(false),scope=useRef('');scope.current=accountId+':'+workId;
 useEffect(()=>{setJob(null);setError('');setConfirmed(false);},[accountId,workId]);
 const act=async(method:string,input:any)=>{
  if(flight.current)return;flight.current=true;setBusy(true);setError('');const captured=scope.current;
  try{const result=await call(method,input);if(captured===scope.current&&method.startsWith('publish.qishui.')){setJob(result);setConfirmed(false);}}
  catch(e){if(captured===scope.current){const message=e instanceof Error?e.message:'操作未完成';const code=Object.keys(errors).find(code=>message.includes(code));setError(code?errors[code]:message);}}
  finally{flight.current=false;setBusy(false);}
 };
 const labels:Record<string,string>={prepared:'材料已检查',running:'正在处理',form_ready:'已填表上传，请核对官网',authorization:'已到授权作品页',contract_review:'合同待确认',verification_required:'等待验证码',unknown:'结果待核对，请勿重复上传'};
 return <details className="panel"><summary>汽水音乐自动填表上传</summary>
 <fieldset disabled={busy||data.mode!=='production'}>
  <label>账号<select value={accountId} onChange={e=>setAccount(e.target.value)}><option value="">请选择</option>{data.accounts.filter((a:any)=>a.provider==='qishui').map((a:any)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
  <label>作品<select value={workId} onChange={e=>{setWork(e.target.value);const w=data.works.find((w:any)=>w.id===e.target.value),a=data.artists.find((a:any)=>a.id===w?.artistId);setPerformer(a?.name??'');setComposer('');setLyricist('');}}><option value="">请选择</option>{data.works.map((w:any)=><option key={w.id} value={w.id}>{w.title}</option>)}</select></label>
  <label>版本<select value={variant} onChange={e=>setVariant(e.target.value)}><option>A</option><option>B</option></select></label>
  <label>表演者<input value={performer} onChange={e=>setPerformer(e.target.value)}/></label>
  <label>词作者<input value={lyricist} onChange={e=>setLyricist(e.target.value)}/></label>
  <label>曲作者<input value={composer} onChange={e=>setComposer(e.target.value)}/></label>
  <label><input type="checkbox" checked={ai} onChange={e=>setAi(e.target.checked)}/>AI 创作</label>
  {ai&&<label>AI 工具<select value={aiTool} onChange={e=>setTool(e.target.value)}>{['Suno','Udio','天音','海绵音乐','腾讯启明星','天工AI','Mureka','其他'].map(t=><option key={t}>{t}</option>)}</select></label>}
  <button disabled={!accountId} onClick={()=>void act('accountSession.open',{accountId})}>打开账号窗口</button>
  <button disabled={!accountId||!workId||!performer||!composer||!lyricist||!!job} onClick={()=>void act('publish.qishui.fill',{accountId,workId,variant,performer,composer,lyricist,ai,aiTool})}>填写并上传到官网</button>
  <button disabled={!accountId||!workId} onClick={()=>void act('publish.qishui.status',{accountId,workId})}>读取任务记录</button>
  {job?.stage==='form_ready'&&<><label>授权模式<select value={mode} onChange={e=>setMode(e.target.value)}><option value="exclusive_agency">独家代理发行（3年）</option><option value="exclusive">独家授权（3年）</option><option value="nonexclusive">非独家授权（3年）</option></select></label><button onClick={()=>void act('publish.qishui.authorization',{accountId,workId,mode})}>进入授权作品并选择模式</button></>}
  {(job?.stage==='authorization'||job?.stage==='contract_review')&&<button onClick={()=>void act('publish.qishui.contract',{accountId,workId})}>读取当次合同</button>}
  {job?.stage==='contract_review'&&job.reviewToken&&<section aria-label="当次合同确认"><pre style={{whiteSpace:'pre-wrap',maxHeight:360,overflow:'auto'}}>{job.contractText}</pre><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已核对本次作品、授权范围和期限，同意接受上方合同</label><button disabled={!confirmed} onClick={()=>void act('publish.qishui.accept',{accountId,workId,contractHash:job.contractHash,reviewToken:job.reviewToken,confirmed:true})}>接受本次合同并等待验证码</button></section>}
  {job?.stage==='verification_required'&&<p>请在专属官网窗口完成验证码验证。</p>}
 </fieldset>
 {job&&<p role="status">{labels[job.stage]??'等待核对'}</p>}{error&&<p role="alert">{error}</p>}
 </details>;
}
