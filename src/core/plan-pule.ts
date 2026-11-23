import fs from 'node:fs';
import path from 'node:path';
import {DateTime} from 'luxon';
import {z} from 'zod';
import type {Studio} from './studio';
import {CenterStore,digest} from './plan-center/storage';
import type {PlanCenterItem,PlanCenterRun} from '../shared/plan-center';
import {planPuleAttempt,planPuleAssetProgress,planPuleAudioLimit,planPuleHistoryMatch,planPuleReceipt,planPuleReleaseIndex,planPuleScope,
  puleBrowserBeforeSongIds,puleBrowserLookupStates,puleBrowserSongPair,puleSubmissionText,readSunoBrowserReceipt,sunoBrowserWavsComplete,
  withinPuleSubmissionWindow,type PlanPuleCustomDraft,type PlanPuleReceipt,type PlanPuleRetention,type PlanPuleTask} from '../shared/plan-pule';
import {parseDraft} from '../shared/creation';
import {workVersionTitle} from '../shared/work-versions';
import {creationWorkFields} from './creation-tasks';
import {workflowCreationDraft} from './plan-workflow';
import {browserMusicProviders,workflowBrowserMusic} from '../shared/plan-workflow-fields';

const scenes=[
  '小雨停后的街角', '清晨刚开门的花店', '轮渡末班船的甲板', '旧影院门口的海报',
  '公交车让座后的一小段路', '厨房窗沿刚熟的番茄', '下班后无人的车站',
  '收起露营帐篷时的风', '菜市场收摊前的橘子摊', '楼顶晒着的白衬衣',
  '夜间修自行车的小店', '便利店里借用的一把伞', '排练室门外的琴声',
  '长途火车停靠的小站', '午休归还的一本书', '搬家前留下的纸条',
  '新学会的那道家常菜', '临别前的一张拍立得', '深夜烘干机转动的声音',
  '晨练路上遇到的第一束光',
];
const arrangements=['木吉他与钢琴','轻快放克贝斯','温柔民谣指弹','弦乐与刷鼓','柔和电子鼓与合成器'];

function makeBrief(run:PlanCenterRun,item:PlanCenterItem) {
  const date=DateTime.fromISO(run.createdAt).setZone('Asia/Shanghai').toISODate()!;
  const days=Math.round((Date.parse(date)-Date.UTC(2026,10,12))/86400000);
  const themes=run.snapshot.theme.split(/\r?\n/).map(theme=>theme.trim()).filter(Boolean);
  if(!themes.length&&run.snapshot.storyContext?.storyBeat.trim())themes.push(run.snapshot.storyContext.storyBeat);
  if(!themes.length)throw Error('THEME_REQUIRED');
  const index=(length:number,offset=0)=>((days+offset)%length+length)%length;
  const theme=themes[index(themes.length)];
  const scene=scenes[index(scenes.length,item.ordinal-1)];
  const style=run.snapshot.styleTemplate.trim()||'华语流行';
  const sound=arrangements[index(arrangements.length,item.ordinal)];
  return {
    theme,scene,
    prompt:'创作一首原创完整简体中文人声歌曲。主题是'+theme.slice(0,90)+'，场景是'+scene+
      '，写一个具体动作和一个情绪变化。风格为'+style.slice(0,100)+'，编曲采用'+sound+
      '。有清晰主歌和可传唱副歌，歌名简短，歌词适合演唱。',
  };
}

const usesPuleRunner=(run:PlanCenterRun)=>['pule_prompt','creation','workflow'].includes(run.snapshot.material.source)||run.snapshot.songType==='instrumental';

const recoveryScope=planPuleAttempt.extend({stage:z.literal('music_submit')});
const recoveryBackoff=[5000,30000,120000,300000];
const browserRecoveryBackoff=[5000,25000,60000,120000];
const finishedBrowserRuns=new Set(['completed','stopped','failed']);
const musicAssetScope=planPuleScope.extend({stage:z.literal('music_assets')});
const musicAssetAttempt=planPuleAttempt.extend({stage:z.literal('music_assets')});
const assetWaitLimit=20*60_000;
const assetQueryErrorLimit=5;
const assetClaimFailures=new Set(['PROFILE_REVISION_CHANGED','MUSIC_RECEIPT_INVALID','MUSIC_GRANT_REQUIRED',
  'WORKFLOW_SUNO_CN_ACCOUNT_REQUIRED','WORKFLOW_PULE_ACCOUNT_REQUIRED']);
const recoveryChecks=(result?:Record<string,unknown>)=>Number.isInteger(result?.recoveryChecks)?Number(result!.recoveryChecks):0;
const recoveryReasons={
  not_found:'MUSIC_HISTORY_NOT_FOUND',ambiguous:'MUSIC_HISTORY_AMBIGUOUS',unavailable:'MUSIC_HISTORY_UNAVAILABLE',
  credential_required:'CREDENTIAL_REQUIRED',pair_order_unavailable:'MUSIC_HISTORY_PAIR_ORDER_UNAVAILABLE',
};
const browserRecoveryReasons={
  not_found:'PULE_BROWSER_HISTORY_NOT_FOUND',ambiguous:'PULE_BROWSER_HISTORY_AMBIGUOUS',
  unavailable:'PULE_BROWSER_HISTORY_UNAVAILABLE',login_required:'PULE_BROWSER_HISTORY_LOGIN_REQUIRED',
  missing_baseline:'PULE_BROWSER_HISTORY_BASELINE_MISSING',
};
const stageRecoveryScope=(attempt:{runId:string;itemId:string;id:string})=>
  recoveryScope.parse({runId:attempt.runId,itemId:attempt.itemId,stage:'music_submit',attemptId:attempt.id});

function recoveryDraft(run:PlanCenterRun,item:PlanCenterItem) {
  if(run.snapshot.workflow&&item.material?.source!=='workflow')return;
  return workflowCreationDraft(run,item);
}

export function requestPlanPuleRecovery(s:Studio,id:string,scope:'creation'|'graph'='creation') {
  if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
  return s.repo.transaction(()=>{
    const service=s.planCenterService(),rows=service.list();
    const attempt=rows.stageAttempts.find(row=>row.stage==='music_submit'&&row.state==='unknown'&&
      (scope==='graph'?row.id===id:row.runId===id));
    const run=rows.runs.find(row=>row.id===attempt?.runId);
    if(!run||!attempt||(scope==='graph'?!run.snapshot.workflow?.graph:run.snapshot.material.source!=='creation'))
      throw Error('RECONCILE_NOT_REQUIRED');
    const browser=workflowBrowserMusic(run.snapshot.workflow);
    if(browser)throw Error(browser.provider==='suno_cn'?'WORKFLOW_SUNO_CN_BROWSER_RECEIPT_UNKNOWN':'WORKFLOW_PULE_BROWSER_RECEIPT_UNKNOWN');
    service.record({attemptId:attempt.id,status:'unknown',reason:'MUSIC_HISTORY_CHECK_REQUESTED',result:{recoveryChecks:0}});
    return {runId:run.id};
  });
}

function takeRecovery(s:Studio,browserOnly:boolean) {
  const store=new CenterStore(s.repo),now=s.now().getTime();
  for(const attempt of store.all('stage',{field:'state',values:['unknown']}).filter(row=>row.stage==='music_submit')
    .sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt))){
    const run=store.get('run',attempt.runId),item=store.get('item',attempt.itemId);
    if(!run||item?.runId!==run.id)continue;
    const browser=workflowBrowserMusic(run.snapshot.workflow);
    if(browser){
      if(browser.provider!=='yourmusic'||!browser.accountId||run.stopRequested||
          finishedBrowserRuns.has(run.state)||attempt.result?.browserRecoveryExhausted)continue;
      const before=puleBrowserBeforeSongIds.safeParse(attempt.result?.beforeSongIds);
      const check=recoveryChecks(attempt.result), wait=browserRecoveryBackoff[check];
      if(wait===undefined||before.success&&now-Date.parse(attempt.updatedAt)<wait)continue;
      const draft=before.success&&recoveryDraft(run,item);
      return {scope:stageRecoveryScope(attempt),check,browser:{accountId:browser.accountId,
        match:before.success&&draft?{title:draft.title,beforeSongIds:before.data}:null}};
    }
    if(browserOnly)continue;
    const draft=recoveryDraft(run,item);
    if(!draft)continue;
    const wait=recoveryBackoff[recoveryChecks(attempt.result)];
    if(attempt.reason!=='MUSIC_HISTORY_CHECK_REQUESTED'&&(wait===undefined||now-Date.parse(attempt.updatedAt)<wait))continue;
    const {profileId,profileRevision,modelId}=run.snapshot.music;
    if(!profileId||!profileRevision||!modelId||!['pule','yourmusic'].includes(run.snapshot.music.route))continue;
    return {
      scope:stageRecoveryScope(attempt),
      profileId,profileRevision,match:{title:draft.title,lyrics:draft.lyrics,tags:draft.style,
        instrumental:run.snapshot.songType==='instrumental',model:modelId,createdAt:attempt.createdAt},
    };
  }
  return null;
}

function recordBrowserRecovery(s:Studio,raw:unknown){
  const input=recoveryScope.extend({
    check:z.number().int().min(0).max(browserRecoveryBackoff.length-1),
    outcome:z.enum(['found','missing_baseline',...puleBrowserLookupStates]),
    songIds:puleBrowserSongPair.optional(),
  }).parse(raw);
  return s.repo.transaction(()=>{
    const service=s.planCenterService(),store=new CenterStore(s.repo);
    const run=store.get('run',input.runId), attempt=store.get('stage',input.attemptId);
    if(!run||run.stopRequested||finishedBrowserRuns.has(run.state)||workflowBrowserMusic(run.snapshot.workflow)?.provider!=='yourmusic'||
        attempt?.runId!==input.runId||attempt.itemId!==input.itemId||attempt.stage!==input.stage||
        attempt.state!=='unknown'||attempt.result?.browserRecoveryExhausted||recoveryChecks(attempt.result)!==input.check)
      throw Error('RECONCILE_NOT_REQUIRED');
    const before=puleBrowserBeforeSongIds.safeParse(attempt.result?.beforeSongIds);
    const note=(outcome:keyof typeof browserRecoveryReasons)=>{
      const checks=input.check+1, exhausted=outcome==='missing_baseline'||checks>=browserRecoveryBackoff.length;
      return service.record({attemptId:attempt.id,status:'unknown',
        reason:exhausted?browserRecoveryReasons[outcome]:'PULE_BROWSER_HISTORY_CHECKING',
        result:{...attempt.result,recoveryChecks:checks,browserRecoveryExhausted:exhausted}});
    };
    if(input.outcome!=='found')return note(input.outcome);
    const songIds=input.songIds;
    if(!before.success)return note('missing_baseline');
    if(!songIds||songIds.some(id=>before.data.includes(id)))return note('ambiguous');
    const trackingId='pule-browser:'+songIds[0], receipt=planPuleReceipt.parse({trackingId,songIds});
    try{assertNewBrowserReceipt(planTask(s,input),receipt);}
    catch(error){if(error instanceof Error&&error.message==='MUSIC_RECEIPT_INVALID')return note('ambiguous');throw error;}
    const recovered=service.reconcile({attemptId:attempt.id,status:'succeeded',evidenceId:trackingId,externalTaskId:trackingId,result:receipt});
    s.repo.audit('planCenter.puleBrowser.recovered',attempt.id,{runId:run.id,checks:input.check+1,
      reason:attempt.result?.browserError,evidenceId:trackingId});
    return recovered;
  });
}

function recordRecovery(s:Studio,raw:unknown){
  const input=recoveryScope.extend({outcome:z.enum(['found','not_found','ambiguous','unavailable','credential_required']),
    songs:planPuleHistoryMatch.optional()}).parse(raw);
  return s.repo.transaction(()=>{
    const service=s.planCenterService(),rows=service.list();
    const run=rows.runs.find(row=>row.id===input.runId),item=rows.items.find(row=>row.id===input.itemId&&row.runId===run?.id);
    const attempt=rows.stageAttempts.find(row=>row.id===input.attemptId&&row.itemId===item?.id&&row.runId===run?.id&&row.stage==='music_submit');
    const draft=run&&item&&recoveryDraft(run,item);
    if(!run||!draft||workflowBrowserMusic(run.snapshot.workflow)||attempt?.state!=='unknown')throw Error('RECONCILE_NOT_REQUIRED');
    const note=(outcome:keyof typeof recoveryReasons)=>service.record({
      attemptId:attempt.id,status:'unknown',reason:recoveryReasons[outcome],
      result:{recoveryChecks:recoveryChecks(attempt.result)+1},
    });
    if(input.outcome!=='found')return note(input.outcome);
    const songs=input.songs;
    if(!songs||!songs.every(song=>withinPuleSubmissionWindow(attempt.createdAt,song.createdAt)))throw Error('MUSIC_HISTORY_SCOPE');
    const ids=songs.map(song=>song.id);
    const conflict=rows.stageAttempts.some(other=>{
      if(other.stage!=='music_submit'||other.id===attempt.id)return false;
      if(Array.isArray(other.result?.songIds)&&ids.some(id=>(other.result!.songIds as unknown[]).includes(id)))return true;
      if(!['unknown','dispatching'].includes(other.state)||!songs.every(song=>withinPuleSubmissionWindow(other.createdAt,song.createdAt)))return false;
      const owner=rows.runs.find(row=>row.id===other.runId),otherItem=rows.items.find(row=>row.id===other.itemId&&row.runId===owner?.id);
      if(!owner||!otherItem||owner.snapshot.music.modelId!==run.snapshot.music.modelId||owner.snapshot.songType!==run.snapshot.songType)return false;
      const otherDraft=recoveryDraft(owner,otherItem);
      return otherDraft?.title===draft.title&&puleSubmissionText(otherDraft.lyrics)===puleSubmissionText(draft.lyrics)&&
        puleSubmissionText(otherDraft.style)===puleSubmissionText(draft.style);
    });
    if(conflict)return note('ambiguous');
    if(run.snapshot.workflow?.graph&&run.snapshot.workflowSnapshot?.secondSinger)return note('pair_order_unavailable');
    return service.reconcile({attemptId:attempt.id,status:'succeeded',evidenceId:'yourmusic-history:'+digest([...ids].sort()),
      result:planPuleReceipt.parse({songIds:ids})});
  });
}

function planTask(s:Studio,scope:PlanPuleTask) {
  const service=s.planCenterService(),store=new CenterStore(s.repo);
  const run=store.get('run',scope.runId),item=store.get('item',scope.itemId);
  if(!run||!item||item.runId!==run.id||!usesPuleRunner(run))
    throw Error('PLAN_MUSIC_SCOPE');
  const plan=run.snapshot,music=plan.music;
  if(!plan.authorization.music||!music.consent||music.creditPolicy?.mode!=='uncapped_existing_credits')
    throw Error('MUSIC_GRANT_REQUIRED');
  const configured=workflowBrowserMusic(plan.workflow),artist=plan.workflowSnapshot?.artist;
  const browser=configured?.accountId?{accountId:configured.accountId,artistId:plan.artistId,
    ...(plan.workflow?.browserMusic?{provider:configured.provider,
      timbre:artist?.voicePersona?.trim(),timbreWeight:artist?.timbreWeight,styleWeight:artist?.styleWeight,
      coverProfileId:plan.routeSnapshot?.image.profileId??undefined}:{})}:undefined;
  if(configured){
    if(!browser||music.route!==browserMusicProviders[configured.provider].route)
      throw Error(configured.provider==='suno_cn'?'WORKFLOW_SUNO_CN_ACCOUNT_REQUIRED':'WORKFLOW_PULE_ACCOUNT_REQUIRED');
  }else{
    if(!['pule','yourmusic'].includes(music.route)||!music.profileId||!music.profileRevision||!music.modelId)throw Error('MUSIC_GRANT_REQUIRED');
    const profile=s.repo.maybe('settings','api-profile:'+music.profileId);
    if(profile?.providerId!=='yourmusic'||profile.revision!==music.profileRevision)throw Error('PROFILE_REVISION_CHANGED');
  }
  const instrumental=plan.songType==='instrumental';
  const defaults=plan.artistSnapshot?.defaults;
  const inputDraft=workflowCreationDraft(run,item);
  const custom:PlanPuleCustomDraft|undefined=inputDraft&&{
    ...inputDraft,instrumental,duration:Math.min(360,Number(defaults?.duration??180)),
  };
  const brief=custom?{theme:custom.title,scene:'',prompt:custom.style}:makeBrief(run,item);
  const style=plan.styleTemplate.trim()||String(defaults?.genre||'华语流行');
  const instrumentalPrompt={positiveStyle:[style,defaults?.instruments,defaults?.mood,brief.theme.slice(0,120),brief.scene,'纯器乐演奏']
    .filter(Boolean).join('，').slice(0,1000),negativeStyle:'vocals, spoken word',durationTarget:Math.min(360,Number(defaults?.duration??180)),voiceArrangement:'instrumental'};
  const draft=instrumental&&!custom?parseDraft({
    title:Array.from(Array.from(brief.theme).slice(0,18).join('')+' · '+brief.scene).slice(0,40).join(''),
    topic:brief.theme.slice(0,500),storyBeat:brief.scene,language:String(defaults?.language||'中文'),
    style:style.slice(0,200),instrumental:true,sections:[],hook:null,vocalPlan:[],continuityNotes:'',
    musicPrompts:{yourmusic:instrumentalPrompt,suno:instrumentalPrompt},
  }):undefined;
  const next=service.next({runId:run.id,itemId:item.id});
  const stages=store.all('stage',{field:'runId',values:[run.id]}).filter(row=>row.itemId===item.id);
  const attempt=stages.filter(row=>row.stage===scope.stage).at(-1);
  const original=stages.find(row=>row.stage==='music_submit'&&row.state==='succeeded');
  const knownReceipt=scope.stage==='music_assets'?planPuleReceipt.safeParse(original?.result):undefined;
  if(knownReceipt&&!knownReceipt.success)throw Error('MUSIC_RECEIPT_INVALID');
  const receipt=knownReceipt?.data;
  // The item ID is randomly seeded when the run starts, so a resumed download makes the same choice.
  const retention:PlanPuleRetention|undefined=plan.workflow?.graph
    ? plan.workflowSnapshot?.secondSinger ? {kind:'pair'}
      : {kind:'single',preferredIndex:parseInt(digest(item.id).slice(0,2),16)%2===0?0:1}
    : undefined;
  return {service,store,run,item,next,attempt,brief,receipt,draft,custom,retention,browser,
    profileId:music.profileId,profileRevision:music.profileRevision,modelId:music.modelId};
}

function browserAccountRuns({store,browser}:ReturnType<typeof planTask>) {
  const runs=new Map<string,PlanCenterRun>();
  for(const run of store.all('run')){
    const account=workflowBrowserMusic(run.snapshot.workflow);
    if(account?.accountId===browser?.accountId&&account?.provider===(browser?.provider??'yourmusic'))runs.set(run.id,run);
  }
  return runs;
}

function assertNoPendingBrowserSong(task:ReturnType<typeof planTask>) {
  const normalize=(title:string)=>title.normalize('NFKC').trim();
  const title=normalize(task.custom?.title??'');
  const runs=browserAccountRuns(task);
  for(const previous of task.store.all('stage',{field:'runId',values:[...runs.keys()]})){
    if(previous.stage!=='music_submit'||previous.state!=='unknown'||previous.id===task.attempt?.id)continue;
    const run=runs.get(previous.runId);
    if(!run)continue;
    const item=task.store.get('item',previous.itemId);
    let previousTitle:string|undefined;
    try{previousTitle=item?.runId===run.id?workflowCreationDraft(run,item)?.title:undefined;}catch{/* Keep unresolved receipts when their inputs cannot be verified. */}
    if(!previousTitle||normalize(previousTitle)===title)throw Error('WORKFLOW_MUSIC_PRIOR_RECEIPT_REQUIRED');
  }
}

function assertNewBrowserReceipt(task:ReturnType<typeof planTask>,receipt:PlanPuleReceipt) {
  const runs=browserAccountRuns(task);
  for(const previous of task.store.all('stage',{field:'runId',values:[...runs.keys()]})){
    if(previous.stage!=='music_submit'||previous.id===task.attempt?.id)continue;
    const songIds=previous.result?.songIds;
    if(Array.isArray(songIds)&&receipt.songIds.some(id=>songIds.includes(id)))throw Error('MUSIC_RECEIPT_INVALID');
  }
}

const content=z.instanceof(Uint8Array).refine(data=>data.byteLength>0&&data.byteLength<=planPuleAudioLimit);
const planSong=z.strictObject({
  id:z.string().min(1).max(200),title:z.string().max(1000),lyrics:z.string().max(100000),
  mime:z.enum(['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/flac','audio/ogg','audio/mp4']),
  bytes:content,
});
const extensions={'audio/mpeg':'mp3','audio/mp3':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/flac':'flac','audio/ogg':'ogg','audio/mp4':'m4a'} as const;
const planSongs=z.tuple([planSong.nullable(),planSong.nullable()]);

function currentAssetAttempt(s:Studio,scope:z.infer<typeof musicAssetScope>,attemptId?:string) {
  const next=s.planCenterService().next({runId:scope.runId,itemId:scope.itemId});
  if(next?.stage!=='music_assets'||!next.attemptId||(attemptId&&next.attemptId!==attemptId))return;
  const attempt=new CenterStore(s.repo).get('stage',next.attemptId);
  if(attempt?.runId===scope.runId&&attempt.itemId===scope.itemId&&attempt.stage===scope.stage&&
      ['dispatching','waiting'].includes(attempt.state))return attempt;
}

async function saveSong(s:Studio,input:z.infer<typeof planPuleAttempt>&{songs:z.infer<typeof planSongs>}) {
  const verify=()=>{
    const task=planTask(s,input);
    if(input.stage!=='music_assets'||task.run.stopRequested||task.next?.stage!=='music_assets'||
      task.attempt?.id!==input.attemptId||task.attempt.state!=='waiting'||
      input.songs.some((song,index)=>song&&song.id!==task.receipt?.songIds[index]))
      throw Error('PLAN_MUSIC_ASSET_SCOPE');
    const custom=task.custom;
    if(task.browser&&custom&&input.songs.some((song,index)=>song&&song.title!==workVersionTitle(custom,index===0?'audio_A':'audio_B')))
      throw Error('PULE_SAVED_SONG_TITLE_CHANGED');
    return task;
  };
  const {service,run,item,brief,modelId,receipt,draft,custom,retention,browser}=verify();
  const count=input.songs.filter(Boolean).length;
  if(retention?.kind==='pair'&&count!==2)throw Error('WORKFLOW_TWO_RECORDINGS_REQUIRED');
  if(retention?.kind==='single'&&count!==1)throw Error('WORKFLOW_RECORDING_SELECTION_INVALID');
  const chosenIndex=planPuleReleaseIndex(input.songs,custom?(custom.instrumental?true:'provided'):!!draft),chosen=input.songs[chosenIndex];
  if(!chosen)throw Error('MUSIC_OUTPUT_TEXT_INVALID');
  const selectedVersion=chosenIndex===0?'A':'B';
  const title=custom?.title??draft?.title??chosen.title.trim(),lyrics=custom?.lyrics??(draft?'':chosen.lyrics);
  const titleKey=(value:string)=>value.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
  const assertNewTitle=()=>{
    if(!custom&&s.all('works').some(work=>titleKey(work.title)===titleKey(title)))throw Error('MUSIC_OUTPUT_TITLE_EXISTS');
  };
  assertNewTitle();
  const staging=path.join(s.root,'staging');
  fs.mkdirSync(staging,{recursive:true});
  const folder=fs.mkdtempSync(path.join(staging,'plan-pule-')),files:string[]=[];
  try{
    const audio:Array<{version:'A'|'B';assetId:string;sha256:string;externalId:string;lyrics:string}>=[];
    for(const [index,song] of input.songs.entries()){
      if(!song)continue;
      const version=index===0?'A':'B',role='audio_'+version;
      const file=path.join(folder,role+'.'+extensions[song.mime]);files.push(file);
      fs.writeFileSync(file,song.bytes,{flag:'wx'});
      const asset=await s.importFile(file,role,undefined,()=>{verify();});
      audio.push({version,assetId:asset.id,sha256:asset.sha256,externalId:song.id,lyrics:song.lyrics});
    }
    return s.repo.transaction(()=>{
      verify();
      assertNewTitle();
      const fields=custom?creationWorkFields(run,custom):{title,artistId:run.snapshot.artistId,story:brief.theme+' · '+brief.scene,lyrics,
        prompt:draft?.musicPrompts.yourmusic.positiveStyle??brief.prompt,
        parameters:draft?{...run.snapshot.artistSnapshot?.defaults,genre:draft.style,voice:'instrumental',duration:draft.musicPrompts.yourmusic.durationTarget}:{},
        rights:draft?'音频由谱乐生成，按计划已保存的发行授权设置使用。':'歌词和音乐由谱乐生成，按计划已保存的发行授权设置使用。'};
      const work=s.saveWork({...fields,ai:custom&&!custom.instrumental&&!run.snapshot.workflow?'assisted':'generated',
        source:'external',provider:browser?.provider??'yourmusic',providerSongIds:retention?audio.map(version=>version.externalId):receipt!.songIds,
        model:modelId??(browser?.provider==='suno_cn'?'suno_cn_browser':'pule_browser'),
        selectedAudioVariant:selectedVersion},{kind:'generation_input'});
      const versions=audio.map(({lyrics,...version})=>version);
      const assets=Object.fromEntries(versions.map(({version,assetId})=>['audio_'+version,assetId]));
      s.save('works',{...work,assets,assetHistory:Object.values(assets),artistSnapshot:run.snapshot.artistSnapshot,
        storyContext:run.snapshot.storyContext,routeSnapshot:run.snapshot.routeSnapshot,
        audioVersions:audio.map(({lyrics,...version})=>({...version,providerSongId:version.externalId,actualLyrics:lyrics?{text:lyrics,version:null}:null}))});
      new CenterStore(s.repo).put('item',{...item,workId:work.id,selectedVersion,versions,
        material:custom?item.material:{source:'yourmusic',title,lyrics,theme:brief.theme,scene:brief.scene},updatedAt:s.now().toISOString()});
      return service.record({attemptId:input.attemptId,status:'succeeded',evidenceId:work.id,result:{versions,workId:work.id}});
    });
  }finally{
    for(const file of files)if(fs.existsSync(file))fs.unlinkSync(file);
    fs.rmdirSync(folder);
  }
}

export function planPuleAction(s:Studio,action:string,raw:unknown) {
  if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
  if(action==='takeRecovery')return takeRecovery(s,z.strictObject({browserOnly:z.boolean().default(false)}).parse(raw).browserOnly);
  if(action==='recordRecovery')return recordRecovery(s,raw);
  if(action==='recordBrowserRecovery')return recordBrowserRecovery(s,raw);
  const service=s.planCenterService();
  if(action==='list'){
    z.strictObject({}).parse(raw);
    const rows=service.list(),tasks:PlanPuleTask[]=[];
    for(const run of rows.runs){
      if(run.stopRequested||['completed','stopped','failed'].includes(run.state)||!usesPuleRunner(run))continue;
      const submits=new Map(rows.stageAttempts.filter(row=>row.runId===run.id&&row.stage==='music_submit').map(row=>[row.itemId,row]));
      const unresolved=[...submits.values()].some(row=>['unknown','failed'].includes(row.state));
      for(const item of rows.items.filter(row=>row.runId===run.id)){
        const next=service.next({runId:run.id,itemId:item.id});
        if(!next)continue;
        const submit=submits.get(item.id);
        if(next.stage==='music_submit'&&(next.state==='ready'&&!unresolved||
          next.state==='dispatching'&&submit?.state==='dispatching'&&submit.ordinal>1))
          tasks.push({runId:run.id,itemId:item.id,stage:'music_submit'});
        if(next.stage==='music_assets'&&['ready','waiting','dispatching'].includes(next.state)){
          const attempt=rows.stageAttempts.find(row=>row.id===next.attemptId);
          if(!attempt||s.now().getTime()-Date.parse(attempt.updatedAt)>=15000)
            tasks.push({runId:run.id,itemId:item.id,stage:'music_assets'});
        }
      }
    }
    return tasks;
  }
  if(action==='claim'){
    const scope=planPuleScope.parse(raw);
    return s.repo.transaction(()=>{
      let task:ReturnType<typeof planTask>;
      try{task=planTask(s,scope);}
      catch(error){
        if(scope.stage!=='music_assets'||!(error instanceof Error)||!assetClaimFailures.has(error.message))throw error;
        let attempt=currentAssetAttempt(s,{...scope,stage:scope.stage});
        if(!attempt){
          const next=service.next({runId:scope.runId,itemId:scope.itemId});
          if(next?.stage!==scope.stage||next.state!=='ready'||next.attemptId)throw error;
          const claimed=service.claim(scope);
          if(!('id' in claimed))throw error;
          attempt=claimed;
        }
        service.record({attemptId:attempt.id,status:'failed',reason:error.message});
        return null;
      }
      if(task.run.stopRequested||task.next?.stage!==scope.stage)throw Error('STOP_REQUESTED');
      let attempt=task.attempt;
      if(!attempt){
        const claimed=service.claim({...scope,requestHash:digest({scope,brief:task.brief,draft:task.draft,custom:task.custom,
          profileId:task.profileId,modelId:task.modelId,browser:task.browser})});
        if(!('id' in claimed))throw Error(claimed.reason??'MUSIC_GRANT_REQUIRED');
        attempt=claimed;
      }else if(!(scope.stage==='music_assets'&&['dispatching','waiting'].includes(attempt.state))&&
        !(scope.stage==='music_submit'&&attempt.state==='dispatching'&&attempt.ordinal>1))
        throw Error('MUSIC_OUTCOME_UNKNOWN');
      if(scope.stage==='music_assets'&&attempt.state==='dispatching')
        attempt=service.record({attemptId:attempt.id,status:'waiting',reason:'MUSIC_ASSETS_CHECKING'});
      return {...scope,attemptId:attempt.id,prompt:task.brief.prompt,receipt:task.receipt,draft:task.draft,custom:task.custom,retention:task.retention,
        ...(task.browser?{browser:task.browser}:{}),
        profileId:task.profileId,profileRevision:task.profileRevision,modelId:task.modelId};
    });
  }
  if(action==='assetProgress'){
    const {reason,attemptId,...scope}=musicAssetAttempt.extend({reason:planPuleAssetProgress}).parse(raw);
    return s.repo.transaction(()=>{
      const attempt=currentAssetAttempt(s,scope,attemptId);
      if(attempt?.state!=='waiting')throw Error('STOP_REQUESTED');
      const queried=attempt.result?.assetQueryErrors && reason.startsWith('MUSIC_ASSETS_DOWNLOADING_');
      if(attempt.reason!==reason||queried)service.record({attemptId,status:'waiting',reason,
        ...(queried?{result:{...attempt.result,assetQueryErrors:0}}:{})});
      return true;
    });
  }
  if(action==='assetPoll'){
    const {outcome,hasFallback,attemptId,...scope}=musicAssetAttempt.extend({
      outcome:z.enum(['pending','error']),hasFallback:z.boolean().default(false),
    }).parse(raw);
    return s.repo.transaction(()=>{
      const attempt=currentAssetAttempt(s,scope,attemptId);
      if(attempt?.state!=='waiting')throw Error('STOP_REQUESTED');
      const run=new CenterStore(s.repo).get('run',scope.runId);
      if(!run||workflowBrowserMusic(run.snapshot.workflow))throw Error('PLAN_MUSIC_SCOPE');
      const previous=attempt.result?.assetQueryErrors;
      const errors=outcome==='error'?(typeof previous==='number'&&Number.isInteger(previous)&&previous>=0?previous:0)+1:0;
      const expired=outcome==='pending'&&s.now().getTime()-Date.parse(attempt.createdAt)>=assetWaitLimit;
      if(expired&&hasFallback)return true;
      const exhausted=errors>=assetQueryErrorLimit;
      service.record({attemptId,status:expired||exhausted?'failed':'waiting',
        reason:expired?'MUSIC_ORIGINAL_WAIT_EXPIRED':exhausted?'MUSIC_ORIGINAL_QUERY_FAILED':
          outcome==='error'?'MUSIC_ORIGINAL_QUERY_RETRY':'MUSIC_ORIGINAL_PENDING',
        result:{...attempt.result,assetQueryErrors:errors}});
      return false;
    });
  }
  if(action==='current'||action==='authorizeBrowserSubmission'){
    const input=planPuleAttempt.parse(raw),task=planTask(s,input);
    if(task.run.stopRequested||task.attempt?.id!==input.attemptId||task.next?.stage!==input.stage||
        task.attempt.state!==(input.stage==='music_submit'?'dispatching':'waiting'))throw Error('STOP_REQUESTED');
    const provider=task.browser?.provider??'yourmusic';
    if(task.browser&&s.repo.maybe('accounts',task.browser.accountId)?.provider!==provider)
      throw Error(provider==='suno_cn'?'WORKFLOW_SUNO_CN_ACCOUNT_REQUIRED':'WORKFLOW_PULE_ACCOUNT_REQUIRED');
    if(action==='authorizeBrowserSubmission'){
      if(!task.browser||input.stage!=='music_submit')throw Error('PLAN_MUSIC_SCOPE');
      assertNoPendingBrowserSong(task);
    }
    return true;
  }
  if(action==='rememberBrowserSubmission'){
    const input=recoveryScope.extend({beforeSongIds:puleBrowserBeforeSongIds}).parse(raw);
    return s.repo.transaction(()=>{
      const task=planTask(s,input), attempt=task.attempt;
      if(task.run.stopRequested||task.next?.stage!==input.stage||attempt?.id!==input.attemptId||attempt.state!=='dispatching'||
          !task.browser||task.browser.provider==='suno_cn')throw Error('PLAN_MUSIC_SCOPE');
      if(attempt.result?.beforeSongIds!==undefined)throw Error('MUSIC_SUBMISSION_ALREADY_RECORDED');
      new CenterStore(s.repo).put('stage',{...attempt,result:{...attempt.result,beforeSongIds:input.beforeSongIds}});
      return true;
    });
  }
  if(action==='checkpointSunoReceipt'){
    const input=recoveryScope.extend({receipt:planPuleReceipt}).parse(raw);
    return s.repo.transaction(()=>{
      const task=planTask(s,input), attempt=task.attempt;
      const receipt=readSunoBrowserReceipt(input.receipt);
      if(!receipt||task.browser?.provider!=='suno_cn'||task.run.stopRequested||task.next?.stage!==input.stage||
          attempt?.id!==input.attemptId||attempt.state!=='dispatching')throw Error('PLAN_MUSIC_SCOPE');
      const previous=readSunoBrowserReceipt(attempt.result);
      if(previous&&(previous.trackingId!==receipt.trackingId||
          previous.sunoWavs?.sha256.some((hash,index)=>hash&&hash!==receipt.sunoWavs?.sha256[index])))
        throw Error('MUSIC_RECEIPT_INVALID');
      if(!previous)assertNewBrowserReceipt(task,receipt);
      return new CenterStore(s.repo).put('stage',{...attempt,externalTaskId:receipt.trackingId,
        evidenceId:receipt.trackingId,result:receipt});
    });
  }
  if(action==='assets'){
    const input=planPuleAttempt.extend({songs:planSongs}).parse(raw);
    return saveSong(s,input);
  }
  if(action==='record'){
    const input=planPuleAttempt.extend({status:z.enum(['waiting','failed','unknown','succeeded']),reason:z.string().max(200).optional(),
      receipt:planPuleReceipt.optional(),browserError:z.string().regex(/^[A-Z0-9_]{1,160}$/u).optional()}).parse(raw);
    const task=planTask(s,input);
    if(task.attempt?.id!==input.attemptId||!['dispatching','waiting'].includes(task.attempt.state))
      throw Error('PLAN_MUSIC_SCOPE');
    if(input.status==='succeeded'){
      if(input.stage!=='music_submit'||!input.receipt?.trackingId)throw Error('MUSIC_RECEIPT_REQUIRED');
      if((task.browser?.provider==='suno_cn')!==!!input.receipt.sunoWavs)throw Error('MUSIC_RECEIPT_INVALID');
      if(task.browser?.provider==='suno_cn'&&!sunoBrowserWavsComplete(input.receipt,task.retention?.kind!=='single'))
        throw Error('MUSIC_RECEIPT_INVALID');
      if(task.browser)assertNewBrowserReceipt(task,input.receipt);
    }
    return service.record({attemptId:input.attemptId,status:input.status,reason:input.reason,
      ...(input.browserError&&!input.receipt?{result:{...task.attempt.result,browserError:input.browserError}}:{}),
      ...(input.receipt?{externalTaskId:input.receipt.trackingId,evidenceId:input.receipt.trackingId,result:input.receipt}:{})});
  }
  throw Error('METHOD_NOT_ALLOWED');
}
