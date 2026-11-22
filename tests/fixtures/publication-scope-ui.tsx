import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Context} from '../../src/renderer/context';
import PublishCenter from '../../src/renderer/pages/PublishCenter';
import Pipeline from '../../src/renderer/components/PublicationPipelineProgress';
import type {PublicationTask, PublicationTaskRun} from '../../src/shared/publication-tasks';
const workId='00000000-0000-4000-8000-000000000001',taskA='00000000-0000-4000-8000-000000000011',taskB='00000000-0000-4000-8000-000000000012',accountA='00000000-0000-4000-8000-000000000021',accountB='00000000-0000-4000-8000-000000000022';
const w=window as any;
w.ui={calls:[],workId,taskA,taskB,accountA,accountB};
const scope=(task:string)=>({publicationTaskId:task,accountId:task===taskA?accountA:accountB});
const prepareGrant={id:'grant-b',revision:1,workId,...scope(taskB),identity:{qqDisplayName:'Account B',artistName:'Fixture artist',maskedKugouId:'***2222'}};
const prepareJob={id:'prepare-b',revision:1,workId,grantId:'grant-b',...scope(taskB),state:'ready',updatedAt:'2026-10-19T00:00:00Z'};
const inspection={authorizationNonce:'00000000-0000-4000-8000-000000000090',identity:{qqDisplayName:'Inspected fixture',artistName:'Fixture artist',maskedKugouId:'***1111',observedAt:'2026-10-19T00:00:00Z'},binding:{transport:'cloud-playwright',sessionId:'offline',pageId:'offline',started:'2026-10-19T00:00:00Z'},page:{mode:'editor',route:'offline'},registered:false};
const submissionJob=(input:any)=>({id:input.publicationTaskId===taskB?'submission-b':'submission-a',workId,...(input.publicationTaskId?scope(input.publicationTaskId):{}),state:'reviewed',revision:1,termsHash:'a'.repeat(64),termsText:input.publicationTaskId===taskB?'Terms for task B':'Terms for task A'});
const recordedAt='2026-10-19T00:00:00Z';
const plan={id:'00000000-0000-4000-8000-000000000031',title:'关联测试计划',revision:1};
const publicationTask: PublicationTask={
 id:taskA,title:'已保存的发布任务',revision:1,enabled:true,consent:true,cursor:recordedAt,
 execution:{kind:'manual'},steps:[{kind:'plans',planIds:[plan.id]}, {kind:'publish',targets:[{platform:'qqmusic',accountId:accountA}]}],
};
const run: PublicationTaskRun={
 id:'recorded-run',taskId:taskA,requestId:'recorded-request',source:'manual',snapshot:publicationTask,plans:[plan],linked:[],
 dispatch:{tmeIds:[taskA],fanqieIds:[]},state:'completed',detail:'测试投稿已记录',startedAt:recordedAt,updatedAt:recordedAt,
 logs:[{at:recordedAt,state:'completed',detail:'测试投稿已记录'}],
};
const call=async(method:string)=>{
 if(method==='publicationTasks.list')return {tasks:[{task:publicationTask,run}],plans:[plan]};
 if(method==='publicationTasks.history')return [run];
 return {};
};
w.rainfall={
 tmeAiPrepare:async(action:string,input:any)=>{w.ui.calls.push({kind:'prepare',action,input});if(action==='list')return {ok:true,value:{grants:[prepareGrant],jobs:[prepareJob]}};if(action==='context')return {ok:true,value:{grant:prepareGrant,job:prepareJob}};if(action==='inspect'){if(w.ui.deferInspect)return new Promise(resolve=>w.ui.resolveInspect=()=>resolve({ok:true,value:inspection}));return {ok:true,value:inspection};}return {ok:true,value:{}};},
 tmeAiSubmission:async(action:string,input:any)=>{w.ui.calls.push({kind:'submission',action,input});const job=submissionJob(input);return {ok:true,value:action==='authorizeAndSubmit'||action==='reconcile'?job:{ready:true,capability:{available:true},job,jobs:[job,{...submissionJob({publicationTaskId:taskB}),id:'foreign-job',termsText:'Foreign terms must stay hidden'}]}};},
};
function Fixture(){
 const [kind,setKind]=useState('prepare'),[task,setTask]=useState(taskA),[legacy,setLegacy]=useState(false);
 w.ui.setKind=setKind;w.ui.setTask=setTask;w.ui.setLegacy=setLegacy;
 const data={mode:'production',works:[{id:workId,title:'Same fixture work',assets:{audio_A:'a'}}],artists:[],accounts:[{id:accountA,name:'Account A',provider:'tme'},{id:accountB,name:'Account B',provider:'tme'},{id:'fixture-fanqie',name:'测试番茄账号',provider:'fanqie'}],platformConfigurations:[],publicationRequests:[],publicationPipelineJobs:[{id:taskA,workId,title:'Task A',accountId:accountA,state:'awaiting_authorization',targets:['qqmusic']},{id:taskB,workId,title:'Task B',accountId:accountB,state:'needs_configuration',targets:['qqmusic']}]};
 const job={id:legacy?'legacy-task':task,workId,title:legacy?'Legacy task':task===taskA?'Task A':'Task B',...(!legacy?{accountId:scope(task).accountId}:{}),targets:['qqmusic'],state:kind==='submission'?'awaiting_confirmation':'awaiting_authorization'};
 return <Context.Provider value={{data,selected:[workId],publishSelection:{workIds:[workId],targets:[],accountOverrides:{}},setPublishSelection:async()=>{},refresh:async()=>{},call,go:(...args: string[])=>{w.ui.navigation=args;},notify:()=>{}} as any}>
  {kind==='center'||kind==='center-browser'
   ?<PublishCenter key={kind} browser={kind==='center-browser'}/>
   :<Pipeline jobs={[job]} data={data} onRefresh={async()=>{}} onTrack={()=>{}} onConfigure={()=>{}}/>}
 </Context.Provider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
