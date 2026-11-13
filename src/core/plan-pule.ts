import fs from 'node:fs';
import path from 'node:path';
import {DateTime} from 'luxon';
import {z} from 'zod';
import type {Studio} from './studio';
import {CenterStore,digest} from './plan-center/storage';
import type {PlanCenterItem,PlanCenterRun} from '../shared/plan-center';
import {planPuleAttempt,planPuleReceipt,planPuleReleaseIndex,planPuleScope,type PlanPuleTask} from '../shared/plan-pule';

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

function planTask(s:Studio,scope:PlanPuleTask) {
  const service=s.planCenterService(),rows=service.list();
  const run=rows.runs.find(row=>row.id===scope.runId),item=rows.items.find(row=>row.id===scope.itemId);
  if(!run||!item||item.runId!==run.id||run.snapshot.material.source!=='pule_prompt')
    throw Error('PLAN_MUSIC_SCOPE');
  const plan=run.snapshot,music=plan.music;
  if(!plan.authorization.music||!music.consent||music.creditPolicy?.mode!=='uncapped_existing_credits'||
      !music.profileId||!music.profileRevision||!music.modelId)
    throw Error('MUSIC_GRANT_REQUIRED');
  const profile=s.repo.maybe('settings','api-profile:'+music.profileId);
  if(profile?.providerId!=='yourmusic'||profile.revision!==music.profileRevision)
    throw Error('PROFILE_REVISION_CHANGED');
  const brief=makeBrief(run,item);
  const next=service.next({runId:run.id,itemId:item.id});
  const attempt=rows.stageAttempts.filter(row=>row.itemId===item.id&&row.stage===scope.stage).at(-1);
  const original=rows.stageAttempts.find(row=>row.itemId===item.id&&row.stage==='music_submit'&&row.state==='succeeded');
  const receipt=scope.stage==='music_assets'?planPuleReceipt.parse(original?.result):undefined;
  return {service,run,item,next,attempt,brief,receipt,
    profileId:music.profileId,profileRevision:music.profileRevision,modelId:music.modelId};
}

const content=z.instanceof(Uint8Array).refine(data=>data.byteLength>0&&data.byteLength<=50*1024*1024);
const planSong=z.strictObject({
  id:z.string().min(1).max(200),title:z.string().max(1000),lyrics:z.string().max(100000),
  mime:z.enum(['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/flac','audio/ogg','audio/mp4']),
  bytes:content,
});
const extensions={'audio/mpeg':'mp3','audio/mp3':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/flac':'flac','audio/ogg':'ogg','audio/mp4':'m4a'} as const;
const planSongs=z.tuple([planSong.nullable(),planSong.nullable()]);

async function saveSong(s:Studio,input:z.infer<typeof planPuleAttempt>&{songs:z.infer<typeof planSongs>}) {
  const verify=()=>{
    const task=planTask(s,input);
    if(input.stage!=='music_assets'||task.run.stopRequested||task.next?.stage!=='music_assets'||
      task.attempt?.id!==input.attemptId||task.attempt.state!=='waiting'||
      input.songs.some((song,index)=>song&&song.id!==task.receipt?.songIds[index]))
      throw Error('PLAN_MUSIC_ASSET_SCOPE');
    return task;
  };
  const {service,run,item,brief,modelId,receipt}=verify();
  const chosenIndex=planPuleReleaseIndex(input.songs),chosen=input.songs[chosenIndex];
  if(!chosen)throw Error('MUSIC_OUTPUT_TEXT_INVALID');
  const selectedVersion=chosenIndex===0?'A':'B';
  const title=chosen.title.trim();
  const titleKey=(value:string)=>value.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
  const assertNewTitle=()=>{
    if(s.all('works').some(work=>titleKey(work.title)===titleKey(title)))throw Error('MUSIC_OUTPUT_TITLE_EXISTS');
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
      const work=s.saveWork({title,artistId:run.snapshot.artistId,story:brief.theme+' · '+brief.scene,lyrics:chosen.lyrics,
        prompt:brief.prompt,parameters:{},rights:'歌词和音乐由谱乐生成，按计划已保存的发行授权设置使用。',ai:'generated',
        source:'external',provider:'yourmusic',providerSongIds:receipt!.songIds,model:modelId,
        selectedAudioVariant:selectedVersion},{kind:'generation_input'});
      const versions=audio.map(({lyrics,...version})=>version);
      const assets=Object.fromEntries(versions.map(({version,assetId})=>['audio_'+version,assetId]));
      s.save('works',{...work,assets,assetHistory:Object.values(assets),
        audioVersions:audio.map(({lyrics,...version})=>({...version,providerSongId:version.externalId,actualLyrics:lyrics?{text:lyrics,version:null}:null}))});
      new CenterStore(s.repo).put('item',{...item,workId:work.id,selectedVersion,versions,
        material:{source:'yourmusic',title,lyrics:chosen.lyrics,theme:brief.theme,scene:brief.scene},updatedAt:s.now().toISOString()});
      return service.record({attemptId:input.attemptId,status:'succeeded',evidenceId:work.id,result:{versions,workId:work.id}});
    });
  }finally{
    for(const file of files)if(fs.existsSync(file))fs.unlinkSync(file);
    fs.rmdirSync(folder);
  }
}

export function planPuleAction(s:Studio,action:string,raw:unknown) {
  if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
  const service=s.planCenterService();
  if(action==='list'){
    z.strictObject({}).parse(raw);
    const rows=service.list(),tasks:PlanPuleTask[]=[];
    for(const run of rows.runs){
      if(run.stopRequested||['completed','stopped','failed'].includes(run.state)||run.snapshot.material.source!=='pule_prompt')continue;
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
    const scope=planPuleScope.parse(raw),task=planTask(s,scope);
    if(task.run.stopRequested||task.next?.stage!==scope.stage)throw Error('STOP_REQUESTED');
    let attempt=task.attempt;
    if(!attempt){
      const claimed=service.claim({...scope,requestHash:digest({scope,brief:task.brief,profileId:task.profileId,modelId:task.modelId})});
      if(!('id' in claimed))throw Error(claimed.reason??'MUSIC_GRANT_REQUIRED');
      attempt=claimed;
    }else if(!(scope.stage==='music_assets'&&['dispatching','waiting'].includes(attempt.state))&&
      !(scope.stage==='music_submit'&&attempt.state==='dispatching'&&attempt.ordinal>1))
      throw Error('MUSIC_OUTCOME_UNKNOWN');
    if(scope.stage==='music_assets'&&attempt.state==='dispatching')
      attempt=service.record({attemptId:attempt.id,status:'waiting',reason:'ORIGINAL_ASSETS_PENDING'});
    return {...scope,attemptId:attempt.id,prompt:task.brief.prompt,receipt:task.receipt,
      profileId:task.profileId,profileRevision:task.profileRevision,modelId:task.modelId};
  }
  if(action==='current'){
    const input=planPuleAttempt.parse(raw),task=planTask(s,input);
    if(task.run.stopRequested||task.attempt?.id!==input.attemptId||task.next?.stage!==input.stage||
        task.attempt.state!==(input.stage==='music_submit'?'dispatching':'waiting'))throw Error('STOP_REQUESTED');
    return true;
  }
  if(action==='assets'){
    const input=planPuleAttempt.extend({songs:planSongs}).parse(raw);
    return saveSong(s,input);
  }
  if(action==='record'){
    const input=planPuleAttempt.extend({status:z.enum(['waiting','failed','unknown','succeeded']),reason:z.string().max(200).optional(),receipt:planPuleReceipt.optional()}).parse(raw);
    const task=planTask(s,input);
    if(task.attempt?.id!==input.attemptId||!['dispatching','waiting'].includes(task.attempt.state))
      throw Error('PLAN_MUSIC_SCOPE');
    if(input.status==='succeeded'&&(input.stage!=='music_submit'||!input.receipt?.trackingId))throw Error('MUSIC_RECEIPT_REQUIRED');
    return service.record({attemptId:input.attemptId,status:input.status,reason:input.reason,
      ...(input.receipt?{externalTaskId:input.receipt.trackingId,evidenceId:input.receipt.trackingId,result:input.receipt}:{})});
  }
  throw Error('METHOD_NOT_ALLOWED');
}
