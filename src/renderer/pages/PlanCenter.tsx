import React, {useEffect, useRef, useState} from 'react';
import {useStudio, useStudioRequest, localMusicians, names} from '../context';
import HelpNote from '../components/HelpNote';
import GenerationRoutes from '../components/GenerationRoutes';
import PlanMusicFields from '../components/PlanMusicFields';
import MusicStylePicker from '../components/MusicStylePicker';
import PlanFanqieFields from '../components/PlanFanqieFields';
import ProviderPlanStatus from '../components/ProviderPlanStatus';
import PlanRunAssets from '../components/PlanRunAssets';
import PlanAlbumFields from '../components/PlanAlbumFields';
import PlanAlbumOperations from '../components/PlanAlbumOperations';
import PlanWorkflowForm, {PlanWorkflowSummary, planWorkflowLabel} from '../components/PlanWorkflowForm';
import PlanLyricReview from '../components/PlanLyricReview';
import QishuiPublisher from '../components/QishuiPublisher';
import LoadingIndicator from '../components/LoadingIndicator';
import {usePlanCenterData} from '../use-plan-center-data';
import type {PlanWorkflowPublicationStatus} from '../../shared/plan-workflow-publication';
import {musicAssetProgressLabel,planExecutionMessage as message,planStageLabels as stageLabels} from '../plan-execution-labels';
import {isLocalPublicationWorkflow,workflowPublicationPlatforms} from '../../shared/plan-workflow-graph';
import {browserMusicProviders,workflowBrowserMusic} from '../../shared/plan-workflow-fields';
import {planRunActive} from '../../shared/plan-center';
import {canResumeLyricResponse} from '../../shared/lyric-writing';
import {workflowNodesCatalog} from '../../shared/platform-directory';
import type {PlanCenterPlan, PlanCenterPlanInput, PlanCenterRunDetail, PlanCenterRun, PlanCenterStageAttempt, PlanRunSummary} from '../../shared/plan-center';

const runSources: Record<PlanCenterRun['source'], string> = {
 publication_task:'任务中心', scheduled:'定时', directory:'目录', debug:'调试', manual:'手动',
};
const timeFormat = new Intl.DateTimeFormat('zh-CN', {
 timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23',
});
const formatTime=(stamp:string)=>timeFormat.format(new Date(stamp));
const archiveSetupIssues = ['DOWNLOAD_ROOT_REQUIRED','DOWNLOAD_ROOT_INVALID','DOWNLOAD_ROOT_UNAVAILABLE','DOWNLOAD_ROOT_CHANGED'];
const modelSetupIssues = ['TEXT_ROUTE_REQUIRED','IMAGE_ROUTE_REQUIRED','MUSIC_ROUTE_REQUIRED','TEXT_PROFILE_OR_PRICE_REQUIRED','WORKFLOW_TEXT_PROVIDER_REQUIRED','WORKFLOW_MUSIC_PROVIDER_REQUIRED'];
type RetryConfirmation = {plan:PlanCenterPlan; run:PlanCenterRun; attempt:PlanCenterStageAttempt};
type PendingAction = {kind:'edit'; id:string} | {kind:'save'|'command'|'retry-cleanup'};
const errorCode=(error:unknown)=>error instanceof Error?(error as Error & {code?:string}).code??error.message:'';
const providerTextNeedsNewRun=(run:PlanCenterRun,attempt:PlanCenterStageAttempt)=>
 run.snapshot.material.source==='provider'&&['text_generate','text_score'].includes(attempt.stage);
const lyricScoreFailure=(attempt:PlanCenterStageAttempt)=>attempt.stage==='lyric_write'&&attempt.reason==='LYRIC_SCORE_BELOW_THRESHOLD';
const lyricReviewFailure=(attempt:PlanCenterStageAttempt)=>attempt.stage==='lyric_write'&&attempt.reason==='LYRIC_REVIEW_INVALID'&&!!attempt.externalTaskId;
const lyricResponseFailure=(attempt:PlanCenterStageAttempt)=>attempt.stage==='lyric_write'&&!!attempt.externalTaskId&&canResumeLyricResponse(attempt.reason);
function retryStageLabel(run:PlanCenterRun,attempt:PlanCenterStageAttempt){
 if(lyricReviewFailure(attempt))return '重新评分（按服务计费）';
 if(lyricResponseFailure(attempt))return '继续作词（按服务计费）';
 if(lyricScoreFailure(attempt))return '采用最高分稿并继续（按服务计费）';
 if(run.snapshot.workflow?.graph&&['lyric_write','music_submit'].includes(attempt.stage))return '重试（按服务计费）';
 return '重试此阶段';
}
function isLatestFailedStage(attempt:PlanCenterStageAttempt,attempts:PlanCenterStageAttempt[]){
 return ['failed','not_found'].includes(attempt.state)&&!attempts.some(other=>
  other.itemId===attempt.itemId&&other.stage===attempt.stage&&(other.ordinal>attempt.ordinal||other.state==='succeeded'));
}
function artistIdentity(artistId:string,catalog:any){return Object.entries(catalog?.dot?.artistRefs??{}).find(([,id])=>id===artistId)?.[0]??'';}
export default function PlanCenter({initialRunId=""}:{initialRunId?:string}){
 const {data,notify,go}=useStudio();
 const call=useStudioRequest();
 const workflowCatalog:typeof workflowNodesCatalog=data.platformWorkflow?.nodes??workflowNodesCatalog;
 const platformLabel=(platform:string)=>workflowCatalog.find(node=>node.id==='publish:'+platform)?.label??names[platform]??platform;
 const [editing,setEditing]=useState<PlanCenterPlan|null>(null),[catalog,setCatalog]=useState<any>();
 const [pending,setPending]=useState<PendingAction>(),[actionError,setError]=useState('');
 const [selected,setSelected]=useState(''),[dotExport,setDotExport]=useState<any>(null);
 const [workflowEditor,setWorkflowEditor]=useState<{plan?:PlanCenterPlan}|null>(null);
 const [search,setSearch]=useState('');
 const [detail,setDetail]=useState<PlanCenterPlan|null>(null);
 const [deleting,setDeleting]=useState<PlanCenterPlan|null>(null);
 const [retryConfirm,setRetryConfirm]=useState<RetryConfirmation|null>(null);
 const inFlight=useRef(false);
 const startRequests=useRef(new Map<string,{summaryHash:string;requestId:string}>());
 const detailDialog=useRef<HTMLElement>(null);
 const detailBody=useRef<HTMLDivElement>(null);
 const {dashboard,history,run:runQuery,refresh}=usePlanCenterData(detail?.id,selected);
 const runDetail=runQuery.value;
 const problem=actionError||errorCode(dashboard.error);
 const error=message(problem);
 const busy=!!pending;
 const saving=pending?.kind==='save';
 const openedLink=useRef('');
 useEffect(()=>{
  if(!initialRunId){openedLink.current='';return;}
  if(!dashboard.value||openedLink.current===initialRunId)return;
  const plan=dashboard.value.find(row=>row.plan.id===initialRunId)?.plan;
  openedLink.current=initialRunId;
  setDetail(plan??null);
  setSelected(plan?'':initialRunId);
 },[initialRunId,dashboard.value]);
 useEffect(()=>{
  if(detail||!initialRunId||selected!==initialRunId||runDetail?.run.id!==initialRunId)return;
  const run=runDetail.run;
  setDetail(dashboard.value?.find(row=>row.plan.id===run.planId)?.plan??run.snapshot);
 },[initialRunId,selected,detail,runDetail,dashboard.value]);
 useEffect(()=>{
  if(!detailDialog.current)return;
  if(detailBody.current)detailBody.current.scrollTop=0;
  detailDialog.current.focus({preventScroll:true});
 },[detail?.id,selected,deleting]);
 const act=async(fn:()=>Promise<unknown>, options:{pending?:PendingAction;reload?:boolean}={})=>{
  if(inFlight.current)return;
  inFlight.current=true;
  setPending(options.pending??{kind:'command'});setError('');
  try{await fn();if(options.reload!==false)await refresh()}catch(error){setError(errorCode(error)||'OPERATION_FAILED')}
  finally{inFlight.current=false;setPending(undefined)}
 };
 const readEditorCatalog=async()=>{
  const [catalog,identityBindings]=await Promise.all([call('planCenter.catalog',{includeWorks:false}),call('accountIdentity.list')]);
  return {...catalog,identityBindings};
 };
 const patch=(value:Partial<PlanCenterPlan>)=>setEditing(p=>p?{...p,...value}:p);
 const patchRoutes=(routing:any,profiles:any[],defaults:any)=>{if(!editing)return;const resolved=(role:string)=>profiles.find(p=>p.id===(routing[role].source==='default'?defaults.roles[role]:routing[role].profileId));const t=resolved('text'),m=resolved('music');patch({routing,text:{...editing.text,profileId:t?.id,profileRevision:t?.revision,modelId:t?.modelId??undefined,consent:false},music:{...editing.music,route:m?.providerId==='yourmusic'?'pule':m?.providerId==='suno'?'suno_official':'manual',profileId:m?.id,profileRevision:m?.revision,modelId:m?.modelId??undefined,consent:false},authorization:{...editing.authorization,text:false,music:false}})};
 const currentRun=runDetail?.run;
 const fanqieCleanup=runDetail?.fanqieCleanup;
 const cleanupNote=fanqieCleanup==='recycled'?'FANQIE_DOWNLOAD_CLEANUP_RECOVERED':
  fanqieCleanup==='queued'?'FANQIE_DOWNLOAD_CLEANUP_PENDING':undefined;
 const execution=runDetail?.execution;
 const currentBrowserMusic=workflowBrowserMusic(currentRun?.snapshot.workflow);
 const taskExecution=currentRun?.source==='publication_task';
 const localRun=isLocalPublicationWorkflow(currentRun?.snapshot.workflow?.graph);
 const workflowPublication:PlanWorkflowPublicationStatus|undefined=execution?.workflowPublications?.find((entry:PlanWorkflowPublicationStatus)=>entry.runId===selected);
 const graphFanqieIds=new Set(workflowPublication?.dispatch?.fanqieIds??[]);
 const fanqieBatch=execution?.fanqie?.filter((job:any)=>(job.runId===selected||graphFanqieIds.has(job.id))&&job.batchSize)??[];
 const awaitingSignature=fanqieBatch.filter((job:any)=>job.authorization==='awaiting_signature');
 const resumableBatches=[...new Set<string>(fanqieBatch.map((job:any)=>job.runId))].filter(id=>{
  const batch=fanqieBatch.filter((job:any)=>job.runId===id);
  return batch.length===batch[0].batchSize&&batch.every((job:any)=>job.state==='unknown');
 });
 const promptMode=editing?.material.source==='pule_prompt';
 const instrumental=editing?.songType==='instrumental';
 const editorArtist=localMusicians(data, editing?.artistId).find(a=>a.id===editing?.artistId);
 const selectSongType=(songType:'vocal'|'instrumental',changes:Partial<PlanCenterPlan>={})=>{
  if(!editing)return;
  const pure=songType==='instrumental';
  patch({...changes,songType,distinctLyrics:true,
   ...(pure?{material:{...editing.material,...changes.material,source:'provider' as const}}:{}),
   outputs:{...editing.outputs,lyrics:!pure,music:pure||editing.outputs.music,cover:pure||editing.outputs.cover},
   text:{...editing.text,consent:false},music:{...editing.music,consent:false},
   authorization:{...editing.authorization,text:false,music:false,publish:false},
  });
 };
 const runItems=runDetail?.items??[];
 const savePlan=(plan:PlanCenterPlanInput,expectedRevision:number|null,close:()=>void)=>act(async()=>{
  const {artistSnapshot: _artistSnapshot,workflowSnapshot: _workflowSnapshot,...draft}=plan;
  await call('planCenter.save',{plan:{...draft,enabled:false,needsConfiguration:[]},expectedRevision});
  await dashboard.refresh();
  close();notify('计划已保存');
 },{pending:{kind:'save'},reload:false});
 const save=()=>editing&&savePlan(editing,editing.revision,()=>setEditing(null));
 const editWorkflow=(plan?:PlanCenterPlan)=>{setError('');setWorkflowEditor({plan});};
 const saveWorkflow=(plan:PlanCenterPlanInput)=>savePlan(plan,workflowEditor?.plan?.revision??null,()=>setWorkflowEditor(null));
 const openEdit=(plan:PlanCenterPlan)=>act(async()=>{
  const current:PlanCenterPlan=await call('planCenter.read',{id:plan.id});
  setDetail(null);setSelected('');
  if(current.workflow){editWorkflow(current);return;}
  setCatalog(current.creationDraft?undefined:await readEditorCatalog());
  setEditing({...structuredClone(current),...(current.material.source==='provider'?{distinctLyrics:true as const}:{})});
 },{pending:{kind:'edit',id:plan.id},reload:false});
 const openDetail=(plan:PlanCenterPlan,runId='')=>act(async()=>{
  setDetail(await call('planCenter.read',{id:plan.id}));
  setSelected(runId);setDotExport(null);
 });
 const openBlockedExecution=(plan:PlanCenterPlan,summary:PlanRunSummary)=>act(async()=>{
  const {run,items,stageAttempts:attempts}:PlanCenterRunDetail=await call('planCenter.runDetail',{runId:summary.id});
  items.sort((a,b)=>a.ordinal-b.ordinal);
  const blockedItem=items.find(item=>['blocked','unknown','failed','not_found'].includes(item.state));
  const attempt=attempts.find(attempt=>attempt.itemId===blockedItem?.id&&
   attempt.state===blockedItem.state&&isLatestFailedStage(attempt,attempts)&&!providerTextNeedsNewRun(run,attempt));
  if(attempt)setRetryConfirm({plan,run,attempt});
  else {setDetail(plan);viewRun(run.id);}
 },{reload:false});
 const confirmBlockedExecution=(confirmation:RetryConfirmation)=>act(async()=>{
  await call('planCenter.retry',{attemptId:confirmation.attempt.id});
  setDetail(confirmation.plan);
  viewRun(confirmation.run.id);
  setRetryConfirm(null);
 });
 const startExecution=(plan:PlanCenterPlan)=>act(async()=>{
  const preview:{planRevision:number;summaryHash:string;summary:{routeIssue?:string}}=await call('planCenter.preview',{id:plan.id});
  if(preview.planRevision!==plan.revision){
   await dashboard.refresh();
   throw Error('PLAN_CONFIRMATION_STALE');
  }
  if((plan.material.source==='creation'||plan.workflow)&&preview.summary.routeIssue)throw Error(preview.summary.routeIssue);
  const graph=plan.workflow?.graph;
  const previous=startRequests.current.get(plan.id);
  const requestId=previous?.summaryHash===preview.summaryHash?previous.requestId:crypto.randomUUID();
  startRequests.current.set(plan.id,{summaryHash:preview.summaryHash,requestId});
  const run=await call('planCenter.run',{id:plan.id,expectedRevision:preview.planRevision,summaryHash:preview.summaryHash,
   requestId,source:plan.workflow&&!graph?'debug':'manual',
   ...(graph&&!isLocalPublicationWorkflow(graph)?{confirmGeneration:true}:{}),
   ...(workflowPublicationPlatforms(graph).length?{confirmPublication:true}:{})});
  startRequests.current.delete(plan.id);
  setDetail(plan);
  viewRun(run.id);
 });
 const addTarget=()=>{if(!editing)return;patch({publishTargets:[...editing.publishTargets,{platform:'qqmusic',accountId:'',enabled:true,album:{mode:'new',title:''}}]})};
 const query=search.trim().toLocaleLowerCase();
 const visiblePlans=dashboard.value?.filter(({plan})=>plan.title.toLocaleLowerCase().includes(query))
  .sort((a,b)=>Date.parse(b.plan.createdAt??'1970-01-01')-Date.parse(a.plan.createdAt??'1970-01-01'))??[];
 const detailRow=dashboard.value?.find(({plan})=>plan.id===detail?.id);
 const listedDetail=detailRow?.plan;
 const useListedDetail=detail&&listedDetail&&(listedDetail.revision>detail.revision||
  (listedDetail.revision===detail.revision&&(listedDetail.artistSnapshot?.revision??0)>(detail.artistSnapshot?.revision??0)));
 const detailPlan=useListedDetail?listedDetail:detail;
 const detailRuns=history.value?.runs??[];
 const runIndex=detailRuns.findIndex(run=>run.id===selected);
 const detailActive=detailRow?.active;
 const deletionRow=dashboard.value?.find(({plan})=>plan.id===deleting?.id);
 const deleteHasActive=deletionRow?.deleteBlocked;
 const deleteStopsRun=deletionRow?.stopsOnDelete;
 const legacyHistory=Object.entries(history.value?.legacyHistory??{})
  .filter(([,records])=>Array.isArray(records)&&records.length>0);
 const errorNotice=error&&<div role="alert" className="plan-error">
  <span>{error}</span>
  {archiveSetupIssues.includes(problem)&&<button type="button" onClick={()=>go('accounts','inbox')}>打开下载目录</button>}
  {problem==='DOWNLOAD_ACCOUNT_REQUIRED'&&<button type="button" onClick={()=>go('platform-accounts')}>打开账号管理</button>}
  {modelSetupIssues.includes(problem)&&<button type="button" onClick={()=>go('accounts','models')}>打开模型 API</button>}
 </div>;
 const viewRun=(id:string)=>{setSelected(id);setDotExport(null);setError('');};
 const closeDetail=()=>{setDetail(null);viewRun('');};
 const leaveRun=()=>{if(taskExecution)go('publish');else viewRun('');};
 const openDelete=(plan:PlanCenterPlan)=>{setError('');setDeleting(plan);};
 const cancelDelete=()=>{setError('');setDeleting(null);};
 const stopButton=(run:PlanRunSummary,label='停止后续步骤')=><button type="button" disabled={busy||run.stopRequested}
  onClick={()=>void act(()=>call('planCenter.stop',{runId:run.id}))}>{label}</button>;
 const showGenerationCost=visiblePlans.some(({plan})=>plan.workflow
  ?!isLocalPublicationWorkflow(plan.workflow.graph)
  :plan.authorization.text||plan.authorization.music);
 const showPublicationConsent=visiblePlans.some(({plan})=>workflowPublicationPlatforms(plan.workflow?.graph).length>0);
 return <section className="plan-center" aria-label="计划中心">
  <div className="plan-heading"><h1>计划中心</h1><button className="primary" disabled={busy} onClick={()=>editWorkflow()}>＋ 新建计划</button></div>
  <div className="plan-toolbar">
   <input type="search" aria-label="搜索计划名称" placeholder="搜索计划名称" value={search} onChange={event=>setSearch(event.target.value)}/>
   <HelpNote label="运行与停止">停止后续步骤后，已提交的外部请求仍会更新结果。</HelpNote>
   {(showGenerationCost||showPublicationConsent)&&<span className="muted" id="plan-execution-notice">
    {showGenerationCost&&'生成按服务计费。'}
    {showPublicationConsent&&'执行发布计划即确认已核对发布权、AI 标注和歌词。'}
   </span>}
  </div>
  {!workflowEditor&&!editing&&!detail&&!retryConfirm&&!deleting&&errorNotice}
  {!detail&&selected&&runQuery.loading&&<p role="status"><LoadingIndicator label="正在读取执行结果…" /></p>}
  {!detail&&selected&&!!runQuery.error&&<p className="plan-error" role="alert">{message(errorCode(runQuery.error))}</p>}
  <div className="plan-table-frame">
   <table className="plan-table" aria-label="计划列表" aria-busy={dashboard.loading}>
    <thead><tr><th scope="col">名称</th><th scope="col">创建时间</th><th scope="col">执行结果</th><th scope="col">操作</th></tr></thead>
    <tbody>
     {visiblePlans.map(({plan,active:running,latest:recent,deleteBlocked:locked})=>{
      const latest=running??recent;
      const blockedRun=running?.state==='blocked'&&!running.stopRequested?running:undefined;
      const opening=pending?.kind==='edit'&&pending.id===plan.id;
      return <tr key={plan.id} id={`plan-${plan.id}`}>
       <th scope="row">{plan.title}</th>
       <td>{plan.createdAt?<time dateTime={plan.createdAt} title="北京时间">{formatTime(plan.createdAt)}</time>:'—'}</td>
       <td><span className={latest?`plan-run-status is-${latest.state}`:'plan-run-status'}>{latest?message(latest.state):'未执行'}</span></td>
       <td><div className="plan-row-actions">
        {running&&!blockedRun?stopButton(running,'停止'):<button type="button" disabled={busy}
         aria-describedby={showGenerationCost||showPublicationConsent?'plan-execution-notice':undefined}
         onClick={()=>blockedRun?openBlockedExecution(plan,blockedRun):void startExecution(plan)}>立刻执行</button>}
        <button type="button" disabled={busy} aria-busy={opening} onClick={()=>void openEdit(plan)}>
         {opening?<LoadingIndicator label="正在读取…" />:'编辑'}
        </button>
        <button type="button" disabled={busy} onClick={()=>void openDetail(plan)}>详情</button>
        <button type="button" className="plan-delete-button" disabled={busy||locked}
         title={locked?'执行结束后可删除':undefined} onClick={()=>openDelete(plan)}>删除</button>
       </div></td>
      </tr>;
     })}
     {visiblePlans.length===0&&<tr><td colSpan={4} className="plan-table-empty" role="status">
      {dashboard.loading?<LoadingIndicator label="正在读取计划…" />:dashboard.value
       ?(dashboard.value.length===0?'暂无计划':'未找到匹配的计划')
       :<><span>计划列表读取失败</span> <button type="button" onClick={()=>void dashboard.refresh()}>重试</button></>}
     </td></tr>}
    </tbody>
   </table>
  </div>
  {detailPlan&&!deleting&&<div className="plan-modal-backdrop">
   <section ref={detailDialog} tabIndex={-1} className="plan-editor plan-detail-dialog scroll-panel" role="dialog"
    aria-modal="true" aria-labelledby="plan-detail-title"
    onKeyDown={event=>{
     if(event.key!=='Escape'||event.defaultPrevented||busy)return;
     if(event.target instanceof Element&&event.target.closest('[role="dialog"]')!==event.currentTarget)return;
     if(selected)leaveRun();else closeDetail();
    }}>
    <div className="section-title"><h2 id="plan-detail-title">计划详情</h2><button type="button" disabled={busy} onClick={closeDetail}>关闭</button></div>
    <div ref={detailBody} className="scroll-panel-body">
    <h3 className="plan-detail-name">{detailPlan.title}</h3>
    {errorNotice}
    {!selected&&<>
     <div className="plan-detail-meta">
      {detailPlan.createdAt&&<time dateTime={detailPlan.createdAt}>{formatTime(detailPlan.createdAt)}</time>}
      {!isLocalPublicationWorkflow(detailPlan.workflow?.graph)&&<span>{detailPlan.count} 首独立歌曲</span>}
      {detailPlan.outputs.cover&&<span>生成封面</span>}
      {detailPlan.authorization.publish&&<span>{detailPlan.workflow?.graph?'已授权计划发布':'自动发布已配置'}</span>}
     </div>
     <PlanWorkflowSummary plan={detailPlan} profiles={data.platformWorkflow?.profiles??[]}
      artistName={localMusicians(data,detailPlan.artistId).find(artist=>artist.id===detailPlan.artistId)?.name}/>
     {!!detailPlan.needsConfiguration.length&&<p className="plan-warning">{detailPlan.needsConfiguration.map(message).join(' · ')}</p>}
     <div className="plan-detail-history">
      <div className="section-title">
       <h3>执行记录（共 {detailRuns.length} 次）</h3>
       {detailActive&&stopButton(detailActive)}
      </div>
      {history.loading?<p role="status"><LoadingIndicator label="正在读取执行记录…" /></p>:
       history.error?<p role="alert">执行记录读取失败 <button type="button" onClick={()=>void history.refresh()}>重试</button></p>:
       detailRuns.length===0?<p className="muted">暂无执行记录</p>:<ol className="plan-run-list">
       {detailRuns.map((run,index)=><li key={run.id}><button type="button" className="plan-history" disabled={busy} onClick={()=>viewRun(run.id)}>
         <strong>第 {detailRuns.length-index} 次执行</strong>
         <span className={`plan-run-status is-${run.state}`}>{message(run.state)}</span>
         <time dateTime={run.createdAt}>{formatTime(run.createdAt)}</time>
         <span className="muted">{runSources[run.source]}{run.local?' · 目录上传':` · 已完成 ${run.completed}/${run.count}`}</span>
        </button></li>)}
      </ol>}
      {legacyHistory.length>0&&<details className="plan-migration">
       <summary>迁移前的记录</summary>
       {legacyHistory.map(([kind,records])=><details key={kind}>
        <summary>{({runs:'计划执行',steps:'执行步骤',occurrences:'触发记录',records:'生产记录'} as Record<string,string>)[kind]??kind}（{records.length}）</summary>
        <pre>{JSON.stringify(records,null,2)}</pre>
       </details>)}
      </details>}
     </div>
     {listedDetail&&<div className="plan-editor-footer">
      <button type="button" className="plan-delete-button" disabled={busy||detailRow?.deleteBlocked} onClick={()=>openDelete(detailPlan)}>删除</button>
     </div>}
    </>}
    {selected&&<div className="plan-run-navigation">
     <button type="button" disabled={busy} onClick={leaveRun}>{taskExecution?'返回任务中心':'返回执行记录'}</button>
    </div>}
    {selected&&runQuery.loading&&<p role="status"><LoadingIndicator label="正在读取执行结果…" /></p>}
    {selected&&!!runQuery.error&&<p role="alert">执行结果读取失败 <button type="button" onClick={()=>void runQuery.refresh()}>重试</button></p>}
    {currentRun&&<section className="plan-run-detail" aria-label="执行结果" key={currentRun.id}>
     <div className="section-title">
      <h3>{taskExecution?'任务执行记录':runIndex<0?'执行记录':`第 ${detailRuns.length-runIndex} 次执行`}</h3>
      {!taskExecution&&planRunActive(currentRun)&&stopButton(currentRun)}
     </div>
     <p className="plan-detail-meta"><time dateTime={currentRun.createdAt}>{formatTime(currentRun.createdAt)}</time>
      <span>{runSources[currentRun.source]}</span></p>
     <p>{message(currentRun.state)} · 配置快照 v{currentRun.planRevision}{!localRun&&` · ${currentRun.snapshot.count} 首`}</p>
     {cleanupNote?<p role="status">{message(cleanupNote)}</p>:currentRun.reason&&<p>{message(currentRun.reason)}</p>}
     {runDetail?.fanqieDiagnostics&&
      <button type="button" disabled={busy} onClick={()=>void act(()=>call('planCenter.openFanqieDiagnostics',{runId:currentRun.id}),{reload:false})}>
       打开执行日志
      </button>}
     {localRun&&currentRun.reason&&archiveSetupIssues.includes(currentRun.reason)&&
      <button type="button" onClick={()=>go('accounts','inbox')}>打开下载目录</button>}
     {fanqieCleanup==='pending'&&
      <button type="button" disabled={busy} onClick={()=>void act(()=>call('planCenter.retryFanqieCleanup',{runId:currentRun.id}),{pending:{kind:'retry-cleanup'}})}>
       {pending?.kind==='retry-cleanup'?<LoadingIndicator label="正在移入回收站…" />:'重试回收'}
      </button>}
     {localRun&&!fanqieCleanup&&!currentRun.stopRequested&&['waiting','blocked'].includes(currentRun.state)&&
      <button type="button" disabled={busy} onClick={()=>void act(()=>call('planCenter.retryFanqieDirectory',{runId:currentRun.id}))}>
       核对番茄回执并继续
      </button>}
     {currentRun.snapshot.workflow&&<p>{planWorkflowLabel(currentRun.snapshot.workflow.graph,workflowCatalog)}</p>}
     {!localRun&&currentRun.snapshot.publishTargets.some(target=>target.enabled)&&
      <PlanAlbumOperations run={currentRun} items={runItems} busy={busy} act={act}/>}
     {workflowPublication&&<div className="plan-workflow-publication" aria-label="发布节点状态">
      <p role="status">{currentRun.stopRequested?'已停止后续发布':message(workflowPublication.detail)}</p>
      {!!(workflowPublication.dispatch?.tmeIds.length||workflowPublication.dispatch?.fanqieIds.length)&&
       <button type="button" onClick={()=>go('publish')}>打开任务中心</button>}
     </div>}
     {awaitingSignature.length>0&&<p role="status">番茄合同待签署 · {awaitingSignature.length} 首</p>}
     {!currentRun.stopRequested&&resumableBatches.map(runId=><p key={runId} role="status">番茄批次待核对 · {message(fanqieBatch.find((job:any)=>job.runId===runId)?.reason)}
      <button disabled={busy} onClick={()=>void act(()=>call('planCenter.retryFanqie',{runId}))}>继续番茄批次</button>
     </p>)}
     {runItems.map(item=><div className="plan-item-detail" key={item.id}><h3>{currentRun.snapshot.creationDraft?.title??(typeof item.material?.title==='string'?item.material.title:'独立主题 '+item.ordinal)}</h3><p>{message(item.state)} {message(item.reason)}</p>
      {!currentRun.stopRequested&&workflowPublication?.qishui.filter(job=>job.workId===item.workId).map(job=>
       <QishuiPublisher key={`${job.runId}:${job.accountId}:${job.workId}`} plan={job} />)}
      {currentRun.snapshot.workflow&&item.material?.source==='workflow'&&<details><summary>AI作词结果</summary>
       <p>歌名一 · {String(item.material.title??'')}</p>
       <p>歌名二 · {String(item.material.alternateTitle??'')}</p>
       <strong>风格描述</strong><pre>{String(item.material.musicPrompt)}</pre>
       {currentRun.snapshot.songType!=='instrumental'&&<><strong>歌词</strong><pre>{String(item.material.lyrics)}</pre></>}
      </details>}
      <details><summary>材料与版本</summary>
      {currentRun.snapshot.creationDraft && <div className="plan-linked-assets">
       <h4>创作任务内容</h4>
       <p>{currentRun.snapshot.songType==='instrumental'?'纯音乐':'带歌词'}</p>
       <strong>风格描述</strong>
       <pre>{currentRun.snapshot.creationDraft.style}</pre>
       {currentRun.snapshot.songType!=='instrumental'&&<>
        <p>歌手性别 · {currentRun.snapshot.creationDraft.vocalGender==='male'?'男声':currentRun.snapshot.creationDraft.vocalGender==='female'?'女声':'不限'}</p>
        <strong>歌词</strong>
        <pre>{currentRun.snapshot.creationDraft.lyrics}</pre>
       </>}
      </div>}
      {currentRun.downloadFolders?.map(folder => <p key={folder.accountId + ":" + (folder.audioVersion ?? folder.name)}>
       下载目录 · <code>{folder.root.replace(/[\\/]+$/u,'')}{folder.root.includes('\\')?'\\':'/'}{folder.name}</code>
      </p>)}
      <code>{item.expectedExternalItemId}</code><pre>{JSON.stringify({artistSnapshot:currentRun.snapshot.artistSnapshot,storyContext:currentRun.snapshot.storyContext,routeSnapshot:currentRun.snapshot.routeSnapshot,theme:currentRun.snapshot.theme,styleTemplate:currentRun.snapshot.styleTemplate,independentThemeOrdinal:item.ordinal,outputs:currentRun.snapshot.outputs,externalItemId:item.expectedExternalItemId},null,2)}</pre><p>渠道：{currentRun.snapshot.material.source} · {currentRun.snapshot.material.channel||'待配置'}</p>{!!item.material?.finalDraftId&&<><h4>模型评估对应稿件</h4><p>{String(item.material.title??'')} · {String(item.material.finalDraftId)}</p><pre>{String(item.material.lyrics??'')}</pre></>}{item.versions.map(v=><p key={v.version}>版本 {v.version} · {v.assetId??v.externalId??'待返回'}</p>)}</details>{runDetail?.stageAttempts.filter(a=>a.itemId===item.id).map(a=>{
     const reviewFailure=lyricReviewFailure(a)||lyricResponseFailure(a);
     const reviewAvailable=a.stage==='lyric_write'&&currentRun.snapshot.songType!=='instrumental'&&
      (reviewFailure||lyricScoreFailure(a)||a.state==='succeeded'||a.state==='unknown'||a.reason==='TEXT_CONTENT_FILTERED');
       const mayRetry=!currentRun.stopRequested&&isLatestFailedStage(a,runDetail.stageAttempts);
       const assetProgress=a.stage==='music_assets'&&a.state==='waiting'&&musicAssetProgressLabel(a.reason);
       return <React.Fragment key={a.id}>
        <div className="plan-stage-row">
         <span>{stageLabels[a.stage]??a.stage} · {assetProgress||[message(a.state),message(a.reason)].filter(Boolean).join(' ')}
          {a.externalTaskId&&` · ${a.stage==='lyric_write'?'作词任务':'外部任务'} ${a.externalTaskId}`}</span>
         {mayRetry&&(providerTextNeedsNewRun(currentRun,a)
          ? <HelpNote label="重新执行">停止本次计划后重新执行。文本阶段暂不支持单独重试，新执行需重新核对额度。</HelpNote>
          : <button disabled={busy} onClick={()=>{
           if(reviewFailure){setError('');setRetryConfirm({plan:detailPlan,run:currentRun,attempt:a});}
           else void act(()=>call('planCenter.retry',{attemptId:a.id}));
          }}>
          {retryStageLabel(currentRun,a)}</button>)}
         {a.state==='unknown'&&(currentRun.snapshot.workflow?.graph&&a.stage==='music_submit'
          ? currentBrowserMusic
           ? <button type="button" onClick={()=>go('platform-accounts',currentBrowserMusic.provider)}>
              打开{browserMusicProviders[currentBrowserMusic.provider].label}账号管理</button>
           : <button disabled={busy} onClick={()=>void act(()=>call('planCenter.checkMusicReceipt',{attemptId:a.id}))}>核对生成回执</button>
          : <HelpNote label="等待对账">结果未知，请核对原供应商任务。</HelpNote>)}
        </div>
        {typeof a.result?.browserError==='string'&&<p className="muted">谱乐网页诊断 · {message(a.result.browserError)}</p>}
      {reviewAvailable&&a.externalTaskId&&<PlanLyricReview jobId={a.externalTaskId}/>}
       </React.Fragment>;
      })}{runDetail?.publishAttempts.filter(a=>a.itemId===item.id).map(a=><p key={a.id}>{a.platform} / {a.accountId} · {message(a.state)} {message(a.reason)}</p>)}<ProviderPlanStatus status={execution?.providerText?.find((job:any)=>job.itemId===item.id)}/><PlanRunAssets item={item} run={currentRun} catalog={runDetail?.catalog} status={execution} busy={busy} act={act}/></div>)}
     {currentRun.snapshot.material.source==='dot'&&<div className="plan-dot-export">
      <button disabled={busy} onClick={()=>void act(async()=>setDotExport(await call('planCenter.exportDotRequests')))}>导出 dot 请求清单</button>
      {dotExport&&<p role="status">本地请求清单：<code>{dotExport.file}</code> · {dotExport.requestCount} 项 · 桥投影 {dotExport.bridgeProjection?.state??'未配置'}</p>}
     </div>}
    </section>}
    </div>
   </section>
  </div>}
  {deleting&&<div className="plan-modal-backdrop">
   <section className="plan-confirm" role="dialog" aria-modal="true" aria-labelledby="plan-delete-title"
    onKeyDown={event=>{if(event.key==='Escape'&&!busy)cancelDelete();}}>
    <h2 id="plan-delete-title">删除计划？</h2>
    <p>删除「{deleting.title}」后{deleteStopsRun?'，本次阻塞的执行会停止':''}，计划将从列表移除。已有作品和执行记录会保留。</p>
    {errorNotice}
    {deleteHasActive&&<p className="plan-warning" role="status">执行结束后可删除。</p>}
    <div className="plan-editor-footer">
     <button autoFocus type="button" disabled={busy} onClick={cancelDelete}>取消</button>
     <button type="button" className="plan-delete-button" disabled={busy||deleteHasActive} onClick={()=>void act(async()=>{
      await call('planCenter.delete',{id:deleting.id,expectedRevision:deleting.revision});
      setDeleting(null);closeDetail();notify('计划已删除');
     })}>确认删除</button>
    </div>
   </section>
  </div>}
  {workflowEditor&&<PlanWorkflowForm key={workflowEditor.plan?.id??'new'} initial={workflowEditor.plan} busy={busy} error={error} onClose={()=>{setWorkflowEditor(null);setError('')}} onSave={plan=>void saveWorkflow(plan)}/>}
  {editing?.material.source==='creation'&&<div className="plan-modal-backdrop">
   <section role="dialog" aria-modal="true" aria-labelledby="plan-creation-edit-title" className="plan-editor plan-creation-editor scroll-panel">
    <div className="section-title"><h2 id="plan-creation-edit-title">编辑计划</h2><button type="button" disabled={busy} onClick={()=>setEditing(null)}>关闭</button></div>
    <form className="scroll-panel-body" onSubmit={event=>{event.preventDefault();void save();}}>
     <label>名称<input required maxLength={200} value={editing.title} onChange={event=>patch({title:event.target.value})}/></label>
     {errorNotice}
     <div className="plan-editor-footer"><button type="button" disabled={busy} onClick={()=>setEditing(null)}>取消</button><button type="submit" className="primary" disabled={busy||!editing.title.trim()} aria-busy={saving}>{saving?<LoadingIndicator label="正在保存…" />:'保存计划'}</button></div>
    </form>
   </section>
  </div>}
  {editing&&editing.material.source!=='creation'&&<div className="plan-modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="plan-edit-title" className="plan-editor scroll-panel"><div className="section-title"><h2 id="plan-edit-title">编辑计划</h2><button onClick={()=>setEditing(null)}>关闭</button></div><form className="scroll-panel-body" onSubmit={e=>{e.preventDefault();void save()}}>
   <div className="form-grid"><label>计划名称<input aria-label="计划名称" required maxLength={200} value={editing.title} onChange={e=>patch({title:e.target.value})}/></label><label>艺人<select aria-label="计划艺人" required value={editing.artistId} onChange={e=>{
 const artistId=e.target.value,material={...editing.material,identity:artistIdentity(artistId,catalog)};
 const artist=localMusicians(data, editing.artistId).find(a=>a.id===artistId);
 if(editing.material.source==='provider')selectSongType(artist?.defaults?.voice==='instrumental'?'instrumental':'vocal',{artistId,material});
 else patch({artistId,material,authorization:{...editing.authorization,publish:false}});
}}><option value="">请选择</option>{localMusicians(data, editing.artistId).map((a:any)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>独立歌曲数量<input aria-label="独立歌曲数量" type="number" min={1} max={20} value={editing.count} onChange={e=>patch({count:Number(e.target.value)})}/></label></div>
   {editing.routing&&<GenerationRoutes value={editing.routing} onChange={patchRoutes} disabled={busy}/>}
   <fieldset><legend>创作内容</legend>{(editing.material.source==='provider'||promptMode)&&<label>歌曲类型<select aria-label="计划歌曲类型" value={editing.songType??'vocal'} onChange={e=>selectSongType(e.target.value==='instrumental'?'instrumental':'vocal')}><option value="vocal">人声歌曲</option><option value="instrumental">纯音乐</option></select></label>}{editorArtist&&<small>发行艺人 {editorArtist.name} · 人声偏好 {({female:'女声',male:'男声',duet:'对唱',instrumental:'纯音乐'} as Record<string,string>)[editorArtist.defaults?.voice]??'未设置'}</small>}<div className="plan-checkboxes">{(['lyrics','cover','music'] as const).map((key,i)=><label key={key}><input aria-label={['生成歌词','生成封面','生成音乐'][i]} disabled={promptMode||instrumental||(key==="lyrics"&&editing.material.source==="provider")} type="checkbox" checked={key==="lyrics"&&instrumental?false:promptMode||editing.outputs[key]} onChange={e=>patch({outputs:{...editing.outputs,[key]:e.target.checked}})}/>{['歌词','封面','音乐'][i]}</label>)}</div><label>本次故事<textarea aria-label="计划本次故事" value={editing.storyContext?.storyBeat??''} maxLength={10000} onChange={e=>patch({storyContext:{storyStage:editing.storyContext?.storyStage??'',storyBeat:e.target.value}})}/></label><label>{promptMode?'主题方向（每行一项，按天轮换）':'主题方向'}<textarea aria-label="主题方向" value={editing.theme} onChange={e=>patch({theme:e.target.value})}/></label><MusicStylePicker label="曲风模板" value={editing.styleTemplate} inherited={editorArtist?.defaults?.genre} maxLength={4000} onChange={styleTemplate=>patch({styleTemplate})}/><div className="form-grid"><label>内容渠道<select aria-label="内容渠道" value={editing.material.source} onChange={e=>{
     const source=e.target.value as PlanCenterPlan['material']['source'];
     const usePule=source==='pule_prompt';
     const profile=catalog?.profiles.find((p:any)=>p.providerId==='yourmusic'&&p.id===editing.music.profileId)??catalog?.profiles.find((p:any)=>p.providerId==='yourmusic'&&p.kind==='music');
     patch({material:{...editing.material,source},songType:undefined,...(source==='provider'?{songType:'vocal' as const,distinctLyrics:true as const,outputs:{...editing.outputs,lyrics:true}}:{}),text:{...editing.text,consent:false},music:usePule?{...editing.music,route:'pule',profileId:profile?.id,profileRevision:profile?.revision,modelId:profile?.modelId??'chirp-v6',versionPolicy:'first',creditPolicy:undefined,consent:false}:{...editing.music,consent:false},
       ...(usePule?{outputs:{lyrics:true,music:true,cover:true},...(editing.routing&&profile?{routing:{...editing.routing,music:{source:'override',profileId:profile.id}}}:{})}:{}),authorization:{text:false,music:false,publish:false}});
   }}>{promptMode&&<option value="pule_prompt">谱乐 · 快速生成（旧计划）</option>}<option value="provider">文本提供商生成</option><option value="dot">dot · Drive 素材交付</option><option value="manual">手动导入</option></select></label><label hidden={editing.material.source==='provider'||promptMode}>收件通道<input aria-label="收件通道" value={editing.material.channel} onChange={e=>patch({material:{...editing.material,channel:e.target.value}})}/></label><label hidden={editing.material.source==='provider'||promptMode}>收件艺人身份<select aria-label="收件艺人身份" value={editing.material.identity} onChange={e=>patch({material:{...editing.material,identity:e.target.value}})}><option value="">请选择配置中的身份</option>{Object.entries(catalog?.dot?.artistRefs??{}).filter(([,artist])=>artist===editing.artistId).map(([ref])=><option key={ref} value={ref}>{ref}</option>)}</select></label></div>{editing.material.source!=='provider'&&!promptMode&&<HelpNote label="dot 桥接">客户端目前不能直接触发外部 dot 任务。执行后会显示准确请求 ID；由所选 dot 渠道生成并写入已授权 incoming，再通过 receipts 确认。不会替换成 Work 生成。</HelpNote>}</fieldset>
   {!promptMode&&!instrumental&&<fieldset><legend>自动质量评估</legend><div className="form-grid"><label hidden={!!editing.routing}>文本模型配置<select aria-label="文本模型配置" value={editing.text.profileId??''} onChange={e=>{const p=catalog?.profiles.find((p:any)=>p.id===e.target.value);patch({text:{...editing.text,profileId:p?.id,profileRevision:p?.revision,modelId:p?.modelId??undefined,maxOutputTokens:2048,consent:false},authorization:{...editing.authorization,text:false}})}}><option value="">待配置</option>{catalog?.profiles.filter((p:any)=>p.kind==='text'&&(editing.material.source==='provider'?['deepseek','doubao'].includes(p.providerId):p.providerId==='deepseek')).map((p:any)=><option key={p.id} value={p.id}>{p.label} · {p.modelId??'未选模型'}</option>)}</select></label><label>及格分<input aria-label="及格分" type="number" min={0} max={100} value={editing.text.threshold} onChange={e=>patch({text:{...editing.text,threshold:Number(e.target.value)}})}/></label><label>最多改写<input aria-label="最多改写" type="number" min={0} max={2} value={editing.text.maxRewrites} onChange={e=>patch({text:{...editing.text,maxRewrites:Number(e.target.value)}})}/></label><label>评分错误重试<input aria-label="评分错误重试" type="number" min={0} max={2} value={editing.text.maxScoreRetries} onChange={e=>patch({text:{...editing.text,maxScoreRetries:Number(e.target.value)}})}/></label><label>{editing.material.source==='provider'?'本次计划总额度（'+(catalog?.profiles.find((p:any)=>p.id===editing.text.profileId)?.textPricing?.currency??'配置币种未设置')+'，所有歌曲共享）':'每日文本总额度（USD 估算）'}<input aria-label="文本额度" type="number" min={0.000001} max={100} step={0.000001} value={editing.text.budgetMicros?editing.text.budgetMicros/1e6:''} onChange={e=>patch({text:{...editing.text,budgetMicros:e.target.value?Math.round(Number(e.target.value)*1e6):undefined,consent:false},authorization:{...editing.authorization,text:false}})}/></label></div><label className="check"><input aria-label="授权文本模型额度" type="checkbox" checked={editing.authorization.text} onChange={e=>patch({text:{...editing.text,consent:e.target.checked},authorization:{...editing.authorization,text:e.target.checked}})}/>{editing.material.source==='provider'?'允许所选文本提供商在本次计划共享额度内生成歌词、提示词、评分和有限改写':'允许导入歌词在此每日额度内自动评分和有限改写'}</label><HelpNote label="评分范围">歌词40%、曲风提示词30%、两者一致性30%。结构规则与模型质量分分开。模型分是自动意见，不是客观保证，也不评价音频审美或代替平台审核。改写不覆盖原稿，封面将标记需更新。</HelpNote></fieldset>}
   {editing.outputs.music&&<PlanMusicFields plan={editing} catalog={catalog} patch={changes=>{if(editing.routing&&changes.music?.profileId&&changes.music.profileId!==editing.music.profileId)patch({...changes,routing:{...editing.routing,music:{source:'override',profileId:changes.music.profileId}}});else patch(changes)}} busy={busy} refreshModels={()=>void act(async()=>{await call('planCenter.refreshModels',{profileId:editing.music.profileId,expectedRevision:editing.music.profileRevision});setCatalog(await readEditorCatalog());notify('账号历史证据已刷新；当前可用性仍待供应商确认')})}/>}
   <PlanFanqieFields key={data.mode + ":" + editing.id} plan={editing} patch={patch}/><details><summary>其他平台设置</summary><fieldset><legend>平台发布</legend><label className="check"><input aria-label="自动发布" type="checkbox" checked={editing.authorization.publish} onChange={e=>patch({authorization:{...editing.authorization,publish:e.target.checked}})}/>自动发布</label><HelpNote label="发布要求">按平台及账号核对专辑目录与能力；追加准备复用原发布队列，版权、条款与正式提交仍在原流程确认。缺少校准合同或账号会话时展示具体原因。</HelpNote>{editing.publishTargets.map((target,index)=>{const pc=catalog?.platforms.find((p:any)=>p.id===target.platform);const update=(changes:any)=>patch({publishTargets:editing.publishTargets.map((t,i)=>i===index?{...t,...changes}:t)});return <div className="plan-publish-target" key={index}><div className="form-grid"><label>发布平台<select aria-label={`发布平台 ${index+1}`} value={target.platform} onChange={e=>update({platform:e.target.value,accountId:'',album:{mode:'new',title:''}})}>{catalog?.platforms.map((p:any)=><option key={p.id} value={p.id} disabled={p.albumAdapterImplemented===false}>{p.label}{p.albumAdapterImplemented===false?' · 未实现，已禁用':''}{p.delivery==='video'?' · 视频':''}</option>)}</select></label><label>平台账号<select aria-label={`平台账号 ${index+1}`} required value={target.accountId} onChange={e=>update({accountId:e.target.value,album:{mode:'new',title:''}})}><option value="">请选择</option>{catalog?.accounts.filter((a:any)=>pc?.accountProviders.includes(a.provider)).map((a:any)=><option key={a.id} value={a.id}>{a.label} · {a.authStatus??'状态待核实'}</option>)}</select></label><label>远端艺人身份映射<select aria-label={`身份映射 ${index+1}`} value={target.identityBindingId??''} onChange={e=>update({identityBindingId:e.target.value||undefined})}><option value="">未绑定 · 自动发布保持阻塞</option>{catalog?.identityBindings?.filter((b:any)=>b.artistId===editing.artistId&&b.accountId===target.accountId&&b.bindingState==='bound').map((b:any)=><option key={b.id} value={b.id}>{b.artistDisplayName} · {b.remoteArtistId} · {b.loginState==='valid'?'近期核对有效':'登录待核对'}</option>)}</select></label></div>{pc?.albumAdapterImplemented===false&&<p className="plan-warning" role="status">此平台专辑适配器尚未实现，查询、新建和追加均已禁用。</p>}<PlanAlbumFields target={target} index={index} update={update} busy={busy}/><button type="button" onClick={()=>patch({publishTargets:editing.publishTargets.filter((_,i)=>i!==index)})}>移除此账号</button></div>})}<button type="button" onClick={addTarget}>＋ 添加平台账号与专辑</button></fieldset></details>
   {errorNotice}
   <div className="plan-editor-footer"><button type="button" disabled={busy} onClick={()=>setEditing(null)}>取消</button><button className="primary" disabled={busy||!editing.artistId} aria-busy={saving} type="submit">{saving?<LoadingIndicator label="正在保存…" />:'保存计划'}</button></div>
  </form></section></div>}
  {retryConfirm&&<div className="plan-modal-backdrop">
   <section className="plan-confirm" role="dialog" aria-modal="true" aria-labelledby="plan-retry-title">
    <h2 id="plan-retry-title">继续本次执行？</h2>
    <h3>{retryConfirm.plan.title}</h3>
    <p>{stageLabels[retryConfirm.attempt.stage]??retryConfirm.attempt.stage} · {message(retryConfirm.attempt.reason??retryConfirm.attempt.state)}</p>
    {lyricReviewFailure(retryConfirm.attempt)&&<p>将使用已保存的歌词重新评分。</p>}
    {lyricResponseFailure(retryConfirm.attempt)&&<p>从本次失败的作词步骤继续，保留已有稿件和评分。</p>}
    {(retryConfirm.run.snapshot.authorization.text||retryConfirm.run.snapshot.authorization.music||
      retryConfirm.run.snapshot.routeSnapshot?.image.capability==='image_api')&&<p>继续执行可能产生服务费用。</p>}
    {errorNotice}
    <div className="plan-editor-footer">
     <button type="button" disabled={busy} onClick={()=>{setRetryConfirm(null);setError('');}}>取消</button>
     <button type="button" className="primary" disabled={busy} onClick={()=>void confirmBlockedExecution(retryConfirm)}>
      {retryStageLabel(retryConfirm.run,retryConfirm.attempt)}</button>
    </div>
   </section>
  </div>}
 </section>;
}
