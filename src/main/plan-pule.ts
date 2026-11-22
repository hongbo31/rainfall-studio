import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import type {Page} from 'playwright-core';
import type {ApiCredentials} from './api-credentials';
import {planPuleAudioLimit,planPuleReceipt,planPuleReleaseIndex,type PlanPuleCustomDraft,type PlanPuleReceipt,type PlanPuleRetention,type PlanPuleTask} from '../shared/plan-pule';
import type {BrowserMusicProvider} from '../shared/plan-workflow-fields';
import type {PuleVersion} from '../shared/pule-browser';
import {workVersionTitle} from '../shared/work-versions';
import type { YourMusicAdapter } from '../core/workflow/yourmusic';
import type {CreativeDraft} from '../shared/creation';
import {runPuleBrowser,withPuleDownloadRetry,type PulePageHooks,type PulePagePhase} from './pule-browser-page';
import {readPlanPuleWave} from './pule-browser';
import {runSunoCnBrowser} from './suno-cn-browser-page';
import {scopedDirectory} from './browser-accounts';
import type {TaskMusicWindowScope} from './task-music-windows';

type ClaimedTask=PlanPuleTask&{
  attemptId:string;
  prompt:string;receipt?:PlanPuleReceipt;draft?:CreativeDraft;custom?:PlanPuleCustomDraft;retention?:PlanPuleRetention;
}&({browser?:never;profileId:string;profileRevision:number;modelId:string}
  |{browser:{accountId:string;artistId:string;provider?:BrowserMusicProvider;coverProfileId?:string;
    timbre?:string;timbreWeight?:number;styleWeight?:number};custom:PlanPuleCustomDraft});
type BrowserTask = Extract<ClaimedTask, {browser: object}>;
type SongAsset={id:string;title:string;lyrics:string;bytes:Uint8Array;mime:string};
type BrowserPort={
  stagingDirectory:string;
  run?:typeof runPuleBrowser;
  runSuno?:typeof runSunoCnBrowser;
  withTaskPage:<T>(scope:TaskMusicWindowScope,signal:AbortSignal,run:(page:Page)=>Promise<T>)=>Promise<T>;
  closeTaskWindow?:(runId:string)=>Promise<void>;
};
type Options={
  rpc:(method:string,input?:unknown)=>Promise<any>;
  credentials:ApiCredentials;
  available:()=>boolean;
  generation:()=>number;
  browser?:BrowserPort;
};

function sunoWaveDirectory(staging: string, requestId: string) {
  if (fs.lstatSync(staging, { throwIfNoEntry: false })?.isSymbolicLink()) throw Error('SUNO_CN_WAV_STAGING_INVALID');
  return scopedDirectory(staging, 'suno-cn', requestId);
}

const waveDigest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function withMusicPage<T>(browser:BrowserPort,task:BrowserTask,signal:AbortSignal,run:(page:Page)=>Promise<T>) {
  const {accountId,provider='yourmusic'}=task.browser;
  return browser.withTaskPage({runId:task.runId,accountId,provider},signal,run);
}

async function stageSunoWaves(browser: BrowserPort, task: BrowserTask, signal: AbortSignal, check: () => Promise<void>,
  beforeGeneration: PulePageHooks['beforeGeneration'],
  markPaid: () => void, identify: (receipt: PlanPuleReceipt) => void) {
  const requestId=randomUUID();
  const custom=task.custom;
  const versions: readonly PuleVersion[]=task.retention?.kind==='single'?[task.retention.preferredIndex===0?'A':'B']:['A','B'];
  const sum: [string|null,string|null]=[null,null];
  let receipt: PlanPuleReceipt|undefined;
  await withMusicPage(browser,task,signal,page => (browser.runSuno??runSunoCnBrowser)(page,{
    requestId, accountId:task.browser.accountId, artistId:task.browser.artistId, mode:'custom',
    ...custom, gender:custom.vocalGender, timbre:task.browser.timbre,
    timbreWeight:task.browser.timbreWeight,styleWeight:task.browser.styleWeight,
  },{
    guard:check,beforeGeneration,validateAudio:()=>{},step:()=>{},approveCover:async()=>{throw Error('PULE_PROCESSING_NOT_AUTHORIZED');},
    beforeCharge:async kind=>{
      if(kind!=='generation')throw Error('PULE_GENERATION_NOT_AUTHORIZED');
      await check();markPaid();
    },
    identify:songIds=>{
      if(songIds.length!==2||songIds[0]!==requestId+':A'||songIds[1]!==requestId+':B')throw Error('MUSIC_RECEIPT_INVALID');
      receipt={trackingId:'suno-cn:'+requestId,songIds};
      identify(receipt);
    },
    saveWave:async(version,id,download,title)=>{
      const index=version==='B'?1:0;
      if(!receipt||id!==receipt.songIds[index]||sum[index]||!versions.includes(version)||
        title!==workVersionTitle(custom,index===0?'audio_A':'audio_B'))throw Error('PLAN_MUSIC_ASSET_SCOPE');
      await check();
      const directory=sunoWaveDirectory(browser.stagingDirectory,requestId);
      fs.mkdirSync(directory,{recursive:true});
      const bytes=await readPlanPuleWave(download,directory,check);
      await check();
      const target=scopedDirectory(sunoWaveDirectory(browser.stagingDirectory,requestId),version+'.wav');
      fs.writeFileSync(target,bytes,{flag:'wx',flush:true});
      sum[index]=waveDigest(bytes);
      receipt={...receipt,sunoWavs:{requestId,sha256:[...sum]}};
      identify(receipt);
    },
    generateCover:async()=>{},
  },{versions}));
  if(!receipt||versions.some(version=>!sum[version==='B'?1:0]))throw Error('MUSIC_RECEIPT_INVALID');
  return planPuleReceipt.parse(receipt);
}

function readSunoWaves(browser: BrowserPort, task: BrowserTask) {
  const receipt = planPuleReceipt.parse(task.receipt), waves = receipt.sunoWavs;
  if(!waves)throw Error('SUNO_CN_WAV_STAGING_INVALID');
  const directory=sunoWaveDirectory(browser.stagingDirectory,waves.requestId);
  const songs=waves.sha256.map((hash,index):SongAsset|null=>{
    if(!hash)return null;
    const file=scopedDirectory(directory,(index===0?'A':'B')+'.wav');
    const stat=fs.lstatSync(file,{throwIfNoEntry:false});
    if(!stat?.isFile()||stat.size>planPuleAudioLimit)throw Error('SUNO_CN_WAV_STAGING_INVALID');
    const bytes=fs.readFileSync(file);
    if(waveDigest(bytes)!==hash)throw Error('SUNO_CN_WAV_STAGING_INVALID');
    return {id:receipt.songIds[index],title:workVersionTitle(task.custom,index===0?'audio_A':'audio_B'),lyrics:'',bytes,mime:'audio/wav'};
  });
  return {songs,requestId:waves.requestId};
}

// The provider's song list is shared across the account's windows. Submission and receipt identification stay together.
function accountSubmissionQueue(){
  const queues=new Map<string,Promise<void>>();
  return {async acquire(accountId:string,signal:AbortSignal){
    signal.throwIfAborted();
    const previous=queues.get(accountId)??Promise.resolve();
    let unlock!:()=>void;
    const ready=new Promise<void>(resolve=>{unlock=resolve;});
    const tail=previous.then(()=>ready);
    queues.set(accountId,tail);
    const release=()=>{
      unlock();
      void tail.then(()=>{if(queues.get(accountId)===tail)queues.delete(accountId);});
    };
    let abort!:()=>void;
    const cancelled=new Promise<never>((_,reject)=>{
      abort=()=>reject(signal.reason);
      signal.addEventListener('abort',abort,{once:true});
    });
    try{
      await Promise.race([previous,cancelled]);
      signal.throwIfAborted();
      return release;
    }catch(error){release();throw error;}
    finally{signal.removeEventListener('abort',abort);}
  }};
}

/** Plan Center records every paid dispatch. A lost response pauses that run. */
export function createPlanPuleRunner(options:Options){
  const active=new Map<string,AbortController>();
  const submissions=accountSubmissionQueue();
  let scanning=false,recovering=false;
  const rpc=async(action:string,input:unknown={})=>{
    const result=await options.rpc('internal.planPule.'+action,input);
    if(!result.ok)throw Error(result.error?.code??'PLAN_MUSIC_RPC_FAILED');
    return result.value;
  };
  const recover=async(guard:()=>void)=>{
    const task=await rpc('takeRecovery') as null|{
      scope:PlanPuleTask&{attemptId:string};profileId:string;profileRevision:number;
      match:Parameters<YourMusicAdapter['recoverCustom']>[0];
    };
    if(!task)return;
    guard();
    let result;
    try{
      const configured=await options.credentials.apiCredentialStatus({profileId:task.profileId});
      result=configured.configured
        ? await options.credentials.withMusicAdapter({profileId:task.profileId,expectedRevision:task.profileRevision},
          adapter=>adapter.recoverCustom(task.match),guard)
        : {state:'credential_required' as const};
    }catch{result={state:'unavailable' as const};}
    guard();
    await rpc('recordRecovery',{...task.scope,outcome:result.state,...('songs' in result?{songs:result.songs}:{})});
  };
  const execute=async(next:PlanPuleTask,signal:AbortSignal,current:()=>boolean)=>{
    const guard=()=>{if(!current())throw Error('WORKSPACE_CHANGED');signal.throwIfAborted();};
    guard();
    const task:ClaimedTask=await rpc('claim',next);
    const scope={...next,attemptId:task.attemptId};
    const check=async()=>{guard();await rpc('current',scope);guard();};
    const record=(status:string,reason?:string,receipt?:PlanPuleReceipt)=>rpc('record',{...scope,status,reason,receipt});
    let paid=false,retainWindow=false;
    let releaseGeneration:(()=>void)|undefined;
    let sunoReceipt:PlanPuleReceipt|undefined;
    try{
      if(task.browser){
        const browser=options.browser;
        if(!browser)throw Error('PULE_BROWSER_UNAVAILABLE');
        const {accountId,artistId}=task.browser;
        await check();
        if(task.stage==='music_submit'&&task.browser.coverProfileId){
          const status=await options.credentials.apiCredentialStatus({profileId:task.browser.coverProfileId});
          if(!status.configured)throw Error('WORKFLOW_COVER_KEY_REQUIRED');
          await check();
        }
        const beforeGeneration=async()=>{
          await check();
          releaseGeneration=await submissions.acquire(accountId,signal);
          guard();
          await rpc('authorizeBrowserSubmission',scope);
          guard();
        };
        if(task.browser.provider==='suno_cn'){
          if(task.stage==='music_submit'){
            const receipt=await stageSunoWaves(browser,task,signal,check,beforeGeneration,()=>{paid=true;},value=>{sunoReceipt=value;});
            if(!paid)throw Error('MUSIC_RECEIPT_INVALID');
            await check();
            await record('succeeded',undefined,receipt);
          }else{
            const {songs,requestId}=readSunoWaves(browser,task);
            await check();
            await rpc('assets',{...scope,songs});
            try{
              const directory=sunoWaveDirectory(browser.stagingDirectory,requestId);
              for(const version of ['A','B'])fs.rmSync(scopedDirectory(directory,version+'.wav'),{force:true});
              fs.rmdirSync(directory);
            }catch{/* Assets and the original receipt have already been committed. */}
          }
          return;
        }
        const custom=task.custom;
        const versions=task.retention?.kind==='single'?[task.retention.preferredIndex===0?'A' as const:'B' as const]:['A','B'] as const;
        const phase:PulePagePhase=task.stage==='music_submit'?{kind:'submit'}:
          {kind:'download',songIds:task.receipt!.songIds,versions};
        const songs: (SongAsset|null)[]=[null,null];
        if(phase.kind==='download')fs.mkdirSync(browser.stagingDirectory,{recursive:true});
        const runPage=(pagePhase:PulePagePhase=phase,useDownloadRetry?:PulePageHooks['useDownloadRetry'])=>withMusicPage(browser,task,signal,page=>(browser.run??runPuleBrowser)(page,{
          accountId,artistId,requestId:task.runId,mode:'custom',title:custom.title,alternateTitle:custom.alternateTitle,
          lyrics:custom.lyrics,style:custom.style,instrumental:custom.instrumental,gender:custom.vocalGender,
          ...(task.browser?.timbre?{timbre:task.browser.timbre}:{}),
        },{
          guard:check,beforeGeneration,validateAudio:()=>{},step:()=>{},approveCover:async()=>{throw Error('PULE_PROCESSING_NOT_AUTHORIZED');},
          beforeCharge:async kind=>{
            if(pagePhase.kind!=='submit'||kind!=='generation')throw Error('PULE_GENERATION_NOT_AUTHORIZED');
            await check();paid=true;
          },
          identify:async songIds=>{
            if(pagePhase.kind!=='submit'||!paid)throw Error('MUSIC_RECEIPT_INVALID');
            guard();
            await record('succeeded',undefined,{trackingId:'pule-browser:'+songIds[0],songIds});
          },
          useDownloadRetry,
          saveWave:async(version,id,download,title,deadline)=>{
            const index=version==='B'?1:0;
            if(pagePhase.kind!=='download'||!pagePhase.versions.includes(version)||id!==pagePhase.songIds[index]||songs[index])throw Error('PLAN_MUSIC_ASSET_SCOPE');
            const bytes=await readPlanPuleWave(download,browser.stagingDirectory,check,deadline);
            songs[index]={id,title,lyrics:'',bytes:new Uint8Array(bytes),mime:'audio/wav'};
          },
          generateCover:async()=>{},
        },{},pagePhase));
        await withPuleDownloadRetry(runPage,phase,()=>phase.kind==='download'
          ?{...phase,versions:phase.versions.filter(version=>!songs[version==='B'?1:0])}:undefined,check);
        if(phase.kind==='download'){await check();await rpc('assets',{...scope,songs});}
        retainWindow=phase.kind==='submit'&&!signal.aborted;
        return;
      }
      const identity={profileId:task.profileId,expectedRevision:task.profileRevision};
      const status=await options.credentials.apiCredentialStatus({profileId:task.profileId});
      if(!status.configured){await record('failed','CREDENTIAL_REQUIRED');return;}
      await options.credentials.withMusicAdapter(identity,async adapter=>{
        await check();
        if(task.stage==='music_submit'){
          const dispatch=async()=>{
            await check();paid=true;
          };
          const custom=task.custom;
          const result=custom
            ?await adapter.submitCustom({title:custom.title,lyrics:custom.lyrics,tags:custom.style,negative_tags:custom.instrumental?'vocals, spoken word':'',
               model:task.modelId,instrumental:custom.instrumental,duration:custom.duration,is_max_mode:false,
               ...(custom.vocalGender?{vocal_gender:custom.vocalGender}:{})},dispatch)
            :task.draft
            ?await adapter.submit({draft:task.draft,modelId:task.modelId,operationId:task.attemptId},dispatch)
            :await adapter.submitPrompt({prompt:task.prompt,modelId:task.modelId},dispatch);
          if(result.state==='accepted'&&result.songIds?.length===2)
            await record('succeeded',undefined,{trackingId:result.trackingId,songIds:result.songIds});
          else if(result.state==='accepted')await record('unknown','MUSIC_RECEIPT_INVALID');
          else await record(paid?result.state:'failed',result.reason);
          return;
        }
        const {songIds}=task.receipt!;
        const result=await adapter.query(songIds);
        const songs=songIds.map(id=>result.songs?.find((song:any)=>song.id===id));
        if(result.state!=='known'||songs.some(song=>song?.status!=='succeeded'&&song?.status!=='failed')){
          await record('waiting','ORIGINAL_ASSETS_PENDING');return;
        }
        const originals=songs.map(song=>song?.status==='succeeded'&&song.audio_url&&!song.has_watermark&&
          (!song.audio_delivery_status||song.audio_delivery_status==='original')?
          {...song,lyrics:song.lyric??''}:null);
        const instrumental=!!task.draft||task.custom?.instrumental===true;
        const eligible=instrumental?originals.map(song=>song&&planPuleReleaseIndex([song],true)>=0?song:null):originals;
        const initial=planPuleReleaseIndex(eligible,task.custom&&!instrumental?'provided':instrumental);
        if(initial<0){
          await record('failed',originals.some(Boolean)?'MUSIC_OUTPUT_TEXT_INVALID':'MUSIC_PROVIDER_FAILED');
          return;
        }
        if(task.retention?.kind==='pair'&&eligible.some(song=>!song)){
          await record('failed','WORKFLOW_TWO_RECORDINGS_REQUIRED');return;
        }
        const preferred=task.retention?.kind==='single'?task.retention.preferredIndex:undefined;
        const selected=preferred!==undefined&&eligible[preferred]?preferred:initial;
        const assets=[];
        for(const [index,song] of eligible.entries()){
          if(!song||(task.retention?.kind==='single'&&index!==selected)){assets.push(null);continue;}
          await check();
          const audio=await adapter.download(song.audio_url!,{retry:true});
          assets.push({id:song.id,title:song.title??'',lyrics:song.lyrics,bytes:new Uint8Array(audio.bytes),mime:audio.mime});
        }
        await check();
        await rpc('assets',{...scope,songs:assets});
      },guard);
    }catch(error){
      if(!current())return;
      const reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'PLAN_MUSIC_FAILED';
      const browserUnknown=task.browser?.provider==='suno_cn'?'WORKFLOW_SUNO_CN_BROWSER_RECEIPT_UNKNOWN':'WORKFLOW_PULE_BROWSER_RECEIPT_UNKNOWN';
      const failure=paid&&!sunoReceipt?(task.browser?browserUnknown:'MUSIC_OUTCOME_UNKNOWN'):reason;
      await record(paid?'unknown':'failed',failure,sunoReceipt);
    }finally{
      releaseGeneration?.();
      if(task.browser&&!retainWindow)await options.browser?.closeTaskWindow?.(task.runId).catch(()=>undefined);
    }
  };

  return {
    async pump(){
      if(scanning||!options.available())return;
      scanning=true;
      const generation=options.generation();
      const current=()=>options.available()&&generation===options.generation();
      const started:Promise<void>[]=[];
      try{
        const tasks:PlanPuleTask[]=await rpc('list');
        if(!current())return;
        for(const task of tasks){
          if(active.has(task.runId))continue;
          const controller=new AbortController();
          active.set(task.runId,controller);
          started.push(execute(task,controller.signal,current).finally(()=>active.delete(task.runId)));
        }
        if(!tasks.length&&!active.size&&!recovering){
          recovering=true;
          started.push(recover(()=>{if(!current())throw Error('WORKSPACE_CHANGED');}).finally(()=>{recovering=false;}));
        }
      }finally{scanning=false;}
      await Promise.allSettled(started);
    },
    stop(runId:string){
      active.get(runId)?.abort(Error('STOP_REQUESTED'));
      void options.browser?.closeTaskWindow?.(runId).catch(()=>undefined);
    },
    invalidate(){
      for(const controller of active.values())controller.abort(Error('WORKSPACE_CHANGED'));
    },
  };
}
