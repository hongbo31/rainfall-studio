import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import type {Page} from 'playwright-core';
import type {ApiCredentials} from './api-credentials';
import {planPuleAudioLimit,planPuleReceipt,planPuleReleaseIndex,sunoBrowserWavsComplete,type PlanPuleCustomDraft,type PlanPuleReceipt,
  type PlanPuleAssetProgress,type PlanPuleRetention,type PlanPuleTask,type PuleBrowserReceiptLookup,type PuleBrowserReceiptMatch} from '../shared/plan-pule';
import type {BrowserMusicProvider} from '../shared/plan-workflow-fields';
import {sunoCnPreflightBlocked,type PuleVersion} from '../shared/pule-browser';
import {workVersionTitle} from '../shared/work-versions';
import type { YourMusicAdapter } from '../core/workflow/yourmusic';
import type {CreativeDraft} from '../shared/creation';
import {readPuleBrowserReceipt,runPuleBrowser,withPuleDownloadRetry,type PulePageHooks,type PulePagePhase} from './pule-browser-page';
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
  readReceipt?:typeof readPuleBrowserReceipt;
  withTaskPage:<T>(scope:TaskMusicWindowScope,signal:AbortSignal,run:(page:Page)=>Promise<T>)=>Promise<T>;
  withHistoryPage?:<T>(accountId:string,signal:AbortSignal,read:(page:Page)=>Promise<T>)=>Promise<T>;
  closeTaskWindow?:(runId:string)=>Promise<void>;
};
type RecoveryScope=PlanPuleTask&{attemptId:string};
type BrowserRecovery={scope:RecoveryScope;check:number;browser:{accountId:string;match:PuleBrowserReceiptMatch|null}};
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
  markPaid: () => void, checkpoint: (receipt: PlanPuleReceipt) => Promise<void>) {
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
    identify:async songIds=>{
      if(songIds.length!==2||songIds[0]!==requestId+':A'||songIds[1]!==requestId+':B')throw Error('MUSIC_RECEIPT_INVALID');
      receipt={trackingId:'suno-cn:'+requestId,songIds};
      await checkpoint(receipt);
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
      await checkpoint(receipt);
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
  const recoverBrowser=async(task:BrowserRecovery,guard:()=>void)=>{
    const {scope,check,browser:{accountId,match}}=task;
    if(active.has(scope.runId))return;
    const controller=new AbortController();
    active.set(scope.runId,controller);
    try{
      const browser=options.browser, signal=AbortSignal.any([controller.signal,AbortSignal.timeout(45_000)]);
      let result:PuleBrowserReceiptLookup|{state:'missing_baseline'};
      if(!match)result={state:'missing_baseline'};
      else if(!browser?.withHistoryPage)result={state:'unavailable'};
      else {
        try{
          const read=browser.readReceipt??readPuleBrowserReceipt;
          result=await browser.withHistoryPage(accountId,signal,page=>read(page,match,()=>{
            guard();
            signal.throwIfAborted();
          }));
        }catch(error){
          result={state:error instanceof Error&&error.message==='PULE_LOGIN_REQUIRED'?'login_required':'unavailable'};
        }
      }
      guard();
      controller.signal.throwIfAborted();
      await rpc('recordBrowserRecovery',{...scope,check,outcome:result.state,...('songIds' in result?{songIds:result.songIds}:{})});
    }finally{active.delete(scope.runId);}
  };
  const recover=async(guard:()=>void,browserOnly:boolean)=>{
    const task=await rpc('takeRecovery',browserOnly?{browserOnly}: {}) as null|BrowserRecovery|{
      scope:RecoveryScope;profileId:string;profileRevision:number;
      match:Parameters<YourMusicAdapter['recoverCustom']>[0];
    };
    if(!task)return;
    guard();
    if('browser' in task){await recoverBrowser(task,guard);return;}
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
    const task:ClaimedTask|null=await rpc('claim',next);
    if(!task)return;
    const scope={...next,attemptId:task.attemptId};
    const check=async()=>{guard();await rpc('current',scope);guard();};
    const record=(status:string,reason?:string,receipt?:PlanPuleReceipt,browserError?:string)=>
      rpc('record',{...scope,status,reason,receipt,...(browserError?{browserError}:{})});
    const progress=async(reason:PlanPuleAssetProgress)=>{
      guard();
      await rpc('assetProgress',{...scope,reason});
      guard();
    };
    const poll=async(outcome:'pending'|'error',hasFallback=false)=>{
      await check();
      return rpc('assetPoll',{...scope,outcome,hasFallback}) as Promise<boolean>;
    };
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
            const receipt=await stageSunoWaves(browser,task,signal,check,beforeGeneration,()=>{paid=true;},async value=>{
              sunoReceipt=value;
              await rpc('checkpointSunoReceipt',{...scope,receipt:value});
            });
            if(!paid)throw Error('MUSIC_RECEIPT_INVALID');
            await check();
            await record('succeeded',undefined,receipt);
          }else{
            await progress('MUSIC_ASSETS_ARCHIVING');
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
        if(phase.kind==='download'){
          await progress('MUSIC_ASSETS_CHECKING');
          fs.mkdirSync(browser.stagingDirectory,{recursive:true});
        }
        const runPage=(pagePhase:PulePagePhase=phase,useDownloadRetry?:PulePageHooks['useDownloadRetry'])=>withMusicPage(browser,task,signal,page=>(browser.run??runPuleBrowser)(page,{
          accountId,artistId,requestId:task.runId,mode:'custom',title:custom.title,alternateTitle:custom.alternateTitle,
          lyrics:custom.lyrics,style:custom.style,instrumental:custom.instrumental,gender:custom.vocalGender,
          ...(task.browser?.timbre?{timbre:task.browser.timbre}:{}),
        },{
          guard:check,beforeGeneration,validateAudio:()=>{},step:()=>{},approveCover:async()=>{throw Error('PULE_PROCESSING_NOT_AUTHORIZED');},
          beforeCharge:async(kind,_credits,beforeSongIds)=>{
            if(pagePhase.kind!=='submit'||kind!=='generation')throw Error('PULE_GENERATION_NOT_AUTHORIZED');
            await check();
            if(beforeSongIds)await rpc('rememberBrowserSubmission',{...scope,beforeSongIds});
            guard();
            paid=true;
          },
          identify:async songIds=>{
            if(pagePhase.kind!=='submit'||!paid)throw Error('MUSIC_RECEIPT_INVALID');
            guard();
            await record('succeeded',undefined,{trackingId:'pule-browser:'+songIds[0],songIds});
          },
          useDownloadRetry,
          ...(pagePhase.kind==='download'?{audioProgress:async(state:'preparing'|'downloading',version:PuleVersion)=>{
            if(!pagePhase.versions.includes(version))throw Error('PLAN_MUSIC_ASSET_SCOPE');
            await progress(state==='preparing'?`MUSIC_ASSETS_PREPARING_${version}`:`MUSIC_ASSETS_DOWNLOADING_${version}`);
          }}:{}),
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
        if(phase.kind==='download'){
          await check();
          await progress('MUSIC_ASSETS_ARCHIVING');
          await rpc('assets',{...scope,songs});
        }
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
        let result;
        try{result=await adapter.query(songIds);}
        catch{await poll('error');return;}
        if(result?.state!=='known'||!Array.isArray(result.songs)){
          await poll(result?.state==='pending'?'pending':'error');
          return;
        }
        const catalog=result.songs;
        const songs=songIds.map(id=>catalog.find(song=>song.id===id));
        const originals=songs.map(song=>song?.status==='succeeded'&&song.audio_url&&!song.has_watermark&&
          (!song.audio_delivery_status||song.audio_delivery_status==='original')?
          {...song,lyrics:song.lyric??''}:null);
        const instrumental=!!task.draft||task.custom?.instrumental===true;
        const eligible=instrumental?originals.map(song=>song&&planPuleReleaseIndex([song],true)>=0?song:null):originals;
        const initial=planPuleReleaseIndex(eligible,task.custom&&!instrumental?'provided':instrumental);
        const preferred=task.retention?.kind==='single'?task.retention.preferredIndex:undefined;
        const preferredReady=preferred!==undefined&&!!eligible[preferred]&&
          planPuleReleaseIndex([eligible[preferred]],task.custom&&!instrumental?'provided':instrumental)>=0;
        const incomplete=songs.some((song,index)=>song?.status!=='failed'&&!originals[index]);
        if(incomplete&&!preferredReady&&!(await poll('pending',initial>=0&&task.retention?.kind!=='pair')))return;
        if(initial<0){
          await record('failed',originals.some(Boolean)?'MUSIC_OUTPUT_TEXT_INVALID':'MUSIC_PROVIDER_FAILED');
          return;
        }
        if(task.retention?.kind==='pair'&&eligible.some(song=>!song)){
          await record('failed','WORKFLOW_TWO_RECORDINGS_REQUIRED');return;
        }
        const selected=preferredReady?preferred:initial;
        const assets=[];
        for(const [index,song] of eligible.entries()){
          if(!song||(task.retention?.kind==='single'&&index!==selected)){assets.push(null);continue;}
          await check();
          await progress(index===0?'MUSIC_ASSETS_DOWNLOADING_A':'MUSIC_ASSETS_DOWNLOADING_B');
          const audio=await adapter.download(song.audio_url!,{retry:true});
          assets.push({id:song.id,title:song.title??'',lyrics:song.lyrics,bytes:new Uint8Array(audio.bytes),mime:audio.mime});
        }
        await check();
        await progress('MUSIC_ASSETS_ARCHIVING');
        await rpc('assets',{...scope,songs:assets});
      },guard);
    }catch(error){
      if(!current())return;
      const reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'PLAN_MUSIC_FAILED';
      if(task.browser?.provider==='suno_cn'&&task.stage==='music_submit'){
        if(!signal.aborted&&sunoBrowserWavsComplete(sunoReceipt,task.retention?.kind!=='single')){
          await record('succeeded',undefined,sunoReceipt);
          return;
        }
        const uncertain=paid&&(!!sunoReceipt||!sunoCnPreflightBlocked(reason));
        await record(uncertain?'unknown':'failed',reason==='PLAN_MUSIC_FAILED'?'SUNO_CN_BROWSER_INTERRUPTED':reason,sunoReceipt);
        return;
      }
      const failure=paid?(task.browser?'WORKFLOW_PULE_BROWSER_RECEIPT_UNKNOWN':'MUSIC_OUTCOME_UNKNOWN'):reason;
      const browserError=paid&&task.browser
        ? error instanceof Error&&error.name==='TimeoutError'?'PULE_BROWSER_CONTROL_TIMEOUT':
          reason==='PLAN_MUSIC_FAILED'?'PULE_BROWSER_INTERRUPTED':reason
        : undefined;
      await record(paid?'unknown':'failed',failure,undefined,browserError);
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
        const browserOnly=!!tasks.length||!!active.size;
        if(!recovering&&(!browserOnly||options.browser?.withHistoryPage)){
          recovering=true;
          started.push(recover(()=>{if(!current())throw Error('WORKSPACE_CHANGED');},browserOnly).finally(()=>{recovering=false;}));
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
