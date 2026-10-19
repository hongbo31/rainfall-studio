import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Context} from '../../src/renderer/context';
import PublishCenter from '../../src/renderer/pages/PublishCenter';
import Pipeline from '../../src/renderer/components/PublicationPipelineProgress';
const workId='00000000-0000-4000-8000-000000000001',taskA='00000000-0000-4000-8000-000000000011',taskB='00000000-0000-4000-8000-000000000012',accountA='00000000-0000-4000-8000-000000000021',accountB='00000000-0000-4000-8000-000000000022';
const w=window as any;
w.ui={calls:[],workId,taskA,taskB,accountA,accountB};
const scope=(task:string)=>({publicationTaskId:task,accountId:task===taskA?accountA:accountB});
const prepareGrant={id:'grant-b',revision:1,workId,...scope(taskB),identity:{qqDisplayName:'Account B',artistName:'Fixture artist',maskedKugouId:'***2222'}};
const prepareJob={id:'prepare-b',revision:1,workId,grantId:'grant-b',...scope(taskB),state:'ready',updatedAt:'2026-10-19T00:00:00Z'};
const inspection={authorizationNonce:'00000000-0000-4000-8000-000000000090',identity:{qqDisplayName:'Inspected fixture',artistName:'Fixture artist',maskedKugouId:'***1111',observedAt:'2026-10-19T00:00:00Z'},binding:{transport:'cloud-playwright',sessionId:'offline',pageId:'offline',started:'2026-10-19T00:00:00Z'},page:{mode:'editor',route:'offline'},registered:false};
const submissionJob=(input:any)=>({id:input.publicationTaskId===taskB?'submission-b':'submission-a',workId,...(input.publicationTaskId?scope(input.publicationTaskId):{}),state:'reviewed',revision:1,termsHash:'a'.repeat(64),termsText:input.publicationTaskId===taskB?'Terms for task B':'Terms for task A'});
w.rainfall={
 tmeAiPrepare:async(action:string,input:any)=>{w.ui.calls.push({kind:'prepare',action,input});if(action==='list')return {ok:true,value:{grants:[prepareGrant],jobs:[prepareJob]}};if(action==='context')return {ok:true,value:{grant:prepareGrant,job:prepareJob}};if(action==='inspect'){if(w.ui.deferInspect)return new Promise(resolve=>w.ui.resolveInspect=()=>resolve({ok:true,value:inspection}));return {ok:true,value:inspection};}return {ok:true,value:{}};},
 tmeAiSubmission:async(action:string,input:any)=>{w.ui.calls.push({kind:'submission',action,input});const job=submissionJob(input);return {ok:true,value:action==='authorizeAndSubmit'||action==='reconcile'?job:{ready:true,capability:{available:true},job,jobs:[job,{...submissionJob({publicationTaskId:taskB}),id:'foreign-job',termsText:'Foreign terms must stay hidden'}]}};},
};
function Fixture(){
 const [kind,setKind]=useState('prepare'),[task,setTask]=useState(taskA),[legacy,setLegacy]=useState(false);
 w.ui.setKind=setKind;w.ui.setTask=setTask;w.ui.setLegacy=setLegacy;
 const data={mode:'production',works:[{id:workId,title:'Same fixture work',assets:{audio_A:'a'}}],artists:[],accounts:[{id:accountA,name:'Account A',provider:'tme'},{id:accountB,name:'Account B',provider:'tme'}],platformConfigurations:[],publicationRequests:[],publicationPipelineJobs:[{id:taskA,workId,title:'Task A',accountId:accountA,state:'awaiting_authorization',targets:['qqmusic']},{id:taskB,workId,title:'Task B',accountId:accountB,state:'awaiting_authorization',targets:['qqmusic']}]};
 const job={id:legacy?'legacy-task':task,workId,title:legacy?'Legacy task':task===taskA?'Task A':'Task B',...(!legacy?{accountId:scope(task).accountId}:{}),targets:['qqmusic'],state:kind==='submission'?'awaiting_confirmation':'awaiting_authorization'};
 return <Context.Provider value={{data,selected:[workId],publishSelection:{workIds:[workId],targets:[],accountOverrides:{}},setPublishSelection:async()=>{},refresh:async()=>{},call:async()=>({}),go:()=>{},notify:()=>{}} as any}>{kind==='center'?<PublishCenter/>:<Pipeline jobs={[job]} data={data} onRefresh={async()=>{}} onTrack={()=>{}} onConfigure={()=>{}}/>}</Context.Provider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
