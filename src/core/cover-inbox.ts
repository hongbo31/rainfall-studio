import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import type {Studio} from './studio';
import type {PlanCenterRun} from '../shared/plan-center';
import {digest} from './assets';
import {paidCoverModelId,supportsImageApiModel,supportsManualCover} from '../shared/api-profiles';
import {frozenRouteModelMatches} from '../shared/generation-config';
import {GenerateCoverSchema,RetryCoverSchema,COVER_API_IMAGE_MAX_BYTES,coverAssetRole,type CoverVariant} from '../shared/cover-handoff';
const prefix='cover-inbox:';
const names=['cover.png','cover.jpg','cover.jpeg','cover.webp'];
const generatedFile='generated.jpg';
type ImageAttempt=
 | {state:'dispatching'}
 | {state:'downloaded';model:string;sha256:string}
 | {state:'failed'|'unknown';reason:string};
type InboxEntry={
 requestId:string;workId:string;directory:string;
 state:'waiting'|'received'|'superseded';expectedNames:string[];createdAt:string;
 planItemId?:string;variant?:CoverVariant;manualGeneration?:boolean;coverResolution?:number;reason?:string|null;assetId?:string;generation?:ImageAttempt;
};
function saveEntry(s:Studio,value:InboxEntry){s.save('settings',{id:prefix+value.requestId,value});}

export function versionBCoverRequired(_snapshot:PlanCenterRun['snapshot']|undefined,_work:{assets?:{audio_B?:string}}|null|undefined){
 // A/B are versions of one work and share its cover. Keep the legacy snapshot
 // field readable, but never schedule a second cover for the same work.
 return false;
}

export function requestImageCover(s:Studio,raw:unknown){
 if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
 const {confirmedModelId,...input}=GenerateCoverSchema.parse(raw);
 const pending=coverInboxStatus(s,input.workId).find(entry=>entry.variant===input.variant&&entry.manualGeneration&&entry.state==='waiting'&&
  !entry.reason&&(!entry.generation||entry.generation.state==='dispatching'||entry.generation.state==='downloaded'));
 if(pending&&pending.requestId!==input.requestId)throw Error('COVER_GENERATION_PENDING');
 const request=s.coverHandoff().request(input,true,confirmedModelId);
 return watchCoverInbox(s,request.id);
}

export function preparePlanCoverInbox(s:Studio,itemId:string,workId:string,activePlanOnly:boolean,variant?:CoverVariant){
 const key='plan-cover-inbox:'+itemId+(variant?':'+variant:'');
 const planItemId=activePlanOnly?itemId:undefined;
 let binding=s.repo.maybe('settings',key)?.value;
 if(!binding){binding={workId,requestId:randomUUID()};s.save('settings',{id:key,value:binding});}
 if(binding.workId!==workId)throw Error('COVER_SCOPE_MISMATCH');
 const request={workId,brief:'',...(variant?{variant}:{})};
 s.coverHandoff().request({...request,requestId:binding.requestId});
 try{return bindPlanInbox(s,watchCoverInbox(s,binding.requestId,planItemId),itemId,activePlanOnly);}
 catch(error){
  if(!(error instanceof Error)||error.message!=='COVER_CONTEXT_CHANGED')throw error;
  const previous=s.repo.maybe('settings',prefix+binding.requestId)?.value as InboxEntry|undefined;
  if(previous?.generation){
   const rows=s.planCenterService().list(),item=rows.items.find(row=>row.id===itemId&&row.workId===workId);
   if(versionBCoverRequired(rows.runs.find(run=>run.id===item?.runId)?.snapshot,s.repo.maybe('works',workId))){
    const stale={...previous,reason:'COVER_CONTEXT_CHANGED'};
    if(previous.reason!==stale.reason)saveEntry(s,stale);
    return stale;
   }
  }
  const requestId=randomUUID();
  s.coverHandoff().request({...request,requestId});
  const entry=bindPlanInbox(s,watchCoverInbox(s,requestId,planItemId),itemId,activePlanOnly);
  s.save('settings',{id:key,value:{workId,requestId}});
  return entry;
 }
}
function bindPlanInbox(s:Studio,entry:InboxEntry,itemId:string,activePlanOnly:boolean){
 if(!activePlanOnly||entry.planItemId===itemId)return entry;
 const bound={...entry,planItemId:itemId};
 saveEntry(s,bound);
 return bound;
}
function folder(s:Studio,workId:string,requestId:string){
  z.uuid().parse(workId);z.uuid().parse(requestId);
  let current=s.root;
  for(const part of ['cover-inbox',workId,requestId]){
    current=path.join(current,part);
    if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('COVER_INBOX_LINK_REJECTED');
    fs.mkdirSync(current,{recursive:true});
  }
  return current;
}
export function watchCoverInbox(s:Studio,requestId:string,planItemId?:string):InboxEntry{
  const request=s.coverHandoff().exportRequest(requestId);
  const directory=folder(s,request.workId,request.id);
  const old=s.repo.maybe('settings',prefix+request.id)?.value;
  if(old)return old;
  fs.writeFileSync(path.join(directory,'request.json'),JSON.stringify(request,null,2));
  fs.writeFileSync(path.join(directory,'保存图片说明.txt'),[
    `作品：${request.context.title}`,`作品 ID：${request.workId}`,
    ...(request.variant?['封面版本：B']:[]),
    '将这一首的正方形封面保存到本目录，文件名为 cover.png（也支持 cover.jpg / cover.jpeg / cover.webp）。',
   request.context?.coverResolution
    ? `只放一张方形图片，目标尺寸 ${request.context.coverResolution}×${request.context.coverResolution} 像素。客户端运行时自动接收。`
    : '只放一张图片，建议 2048×2048 以上。客户端运行时自动接收并选为本首封面。',
    '匹配依据是本目录对应的作品 ID 与请求 ID，不按相似歌名猜测。不要把其他作品图片放入这里。',
    '保存过程中请先用其他文件名，写完后再改成 cover.png。源图片保留；更新歌词后需重新创建目录。',
    '生图服务或外部工具也可将最终图片写入这里；request.json 内含本首提示词。',
  ].join('\r\n'));
  const manualGeneration=request.manualGeneration===true;
  for(const row of s.repo.all('settings').filter(r=>r.id.startsWith(prefix)&&r.value?.workId===request.workId&&r.value?.state==='waiting'&&r.value.variant===request.variant&&r.value.planItemId===planItemId&&!!r.value.manualGeneration===manualGeneration))
    s.save('settings',{...row,value:{...row.value,state:'superseded'}});
  const value:InboxEntry={requestId:request.id,workId:request.workId,directory,state:'waiting',expectedNames:names,createdAt:s.now().toISOString(),
    ...(request.variant?{variant:request.variant}:{}),...(planItemId?{planItemId}:{}),
    ...(manualGeneration?{manualGeneration}:{}),...(request.context?.coverResolution?{coverResolution:request.context.coverResolution}:{})};
  saveEntry(s,value);return value;
}
export function coverInboxStatus(s:Studio,workId?:string):InboxEntry[]{
  return s.repo.all('settings').filter(r=>r.id.startsWith(prefix)&&(!workId||r.value?.workId===workId)).map(r=>r.value);
}
function activeCover(s:Studio,entry:InboxEntry,work:{assets?:{audio_A?:string;audio_B?:string}}){
 if(!entry.planItemId)return false;
 const center=s.planCenterService(),rows=center.list(),item=rows.items.find(row=>row.id===entry.planItemId&&row.workId===entry.workId);
 const needsB=versionBCoverRequired(rows.runs.find(run=>run.id===item?.runId)?.snapshot,work);
 if(entry.variant?!needsB:needsB&&!work.assets?.audio_A)return false;
 const next=item&&center.next({runId:item.runId,itemId:item.id});
 return next?.stage==='cover'&&next.state==='waiting';
}
export function recoverCoverImages(s:Studio){
 for(const entry of coverInboxStatus(s)){
  if(entry.generation?.state==='dispatching')
   saveEntry(s,{...entry,generation:{state:'unknown',reason:'IMAGE_OUTCOME_UNKNOWN'}});
 }
}

const coverScope=z.strictObject({requestId:z.uuid()});
const coverBytes=coverScope.extend({bytes:z.instanceof(Uint8Array).refine(v=>v.byteLength>0&&v.byteLength<=COVER_API_IMAGE_MAX_BYTES)});
const coverFailure=coverScope.extend({reason:z.string().regex(/^[A-Z0-9_]+$/).max(200),unknown:z.boolean()});
export function planCoverImage(s:Studio,action:string,raw:unknown){
 if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
 const service=s.planCenterService(),rows=service.list();
 const context=(entry:InboxEntry)=>{
  const work=s.repo.maybe('works',entry.workId);
  if(entry.state!=='waiting'||!work||(entry.variant&&!work.assets?.audio_B))return;
  const request=s.coverHandoff().get(entry.requestId);
  const route=request.generationRoute;
  const model=route?.modelId;
  if(request.workId!==entry.workId||request.variant!==entry.variant||!supportsImageApiModel(request.provider,model)||
    route?.capability!=='image_api'||request.provider!==route.providerId||!route.profileId||!route.profileRevision)return;
  if(entry.manualGeneration){
   if(!request.manualGeneration||!supportsManualCover(request.provider)||rows.items.some(item=>item.workId===entry.workId))return;
  }else{
   if(!entry.planItemId||work.assets?.[coverAssetRole(entry.variant)])return;
   const item=rows.items.find(row=>row.id===entry.planItemId&&row.workId===entry.workId);
   const run=rows.runs.find(row=>row.id===item?.runId);
   const needsB=versionBCoverRequired(run?.snapshot,work);
   if(entry.variant?!needsB:needsB&&!work.assets?.audio_A)return;
   const next=item&&service.next({runId:item.runId,itemId:item.id});
   if(next?.stage!=='cover'||next.state!=='waiting'||next.reason!=='COVER_REQUIRED')return;
   const frozen=run?.snapshot.routeSnapshot?.image;
   if(frozen?.profileId!==route.profileId||frozen?.profileRevision!==route.profileRevision||
      frozen?.providerId!==route.providerId||frozen?.modelId!==route.modelId)return;
  }
  const profile=s.repo.maybe('settings','api-profile:'+route.profileId);
  if(!profile||profile.providerId!==route.providerId||profile.revision!==route.profileRevision||
    !frozenRouteModelMatches(route,profile.providerId,profile.modelId))return;
  return {requestId:entry.requestId,profileId:route.profileId,expectedRevision:route.profileRevision,model,
   ...(route.modelOverride?{modelId:model}:{}),...(entry.manualGeneration?{manualGeneration:true}:{})};
 };
 if(action==='list'){
  z.strictObject({}).parse(raw);
  return coverInboxStatus(s).flatMap(entry=>{
   if(entry.state!=='waiting'||entry.generation||(!entry.manualGeneration&&!entry.planItemId))return [];
   const task=context(entry);
   if(!task&&entry.manualGeneration)saveEntry(s,{...entry,generation:{state:'failed',reason:'COVER_GENERATION_CONFIG_CHANGED'}});
   return task?[task]:[];
  });
 }
 const {requestId}=coverScope.passthrough().parse(raw);
 const entry=s.repo.maybe('settings',prefix+requestId)?.value as InboxEntry|undefined;
 if(!entry)throw Error('COVER_SCOPE_MISMATCH');
 if(action==='failure'){
  const input=coverFailure.parse(raw);
  if(entry.state==='waiting'&&(!entry.generation||entry.generation.state==='dispatching'))
   saveEntry(s,{...entry,generation:{state:input.unknown?'unknown':'failed',reason:input.reason}});
  return;
 }
 const task=context(entry);
 if(!task)throw Error('COVER_SCOPE_MISMATCH');
 const request=s.coverHandoff().exportRequest(entry.requestId);
 if(action==='retryImage'||action==='retryZhipu'){
  const {workId,confirmedModelId}=RetryCoverSchema.parse(raw);
  if(entry.workId!==workId||!entry.planItemId||!supportsManualCover(request.provider)||
    (action==='retryZhipu'&&request.provider!=='zhipu_image'))throw Error('COVER_SCOPE_MISMATCH');
  if(paidCoverModelId(task.model)!==confirmedModelId)throw Error('IMAGE_MODEL_CONFIRMATION_REQUIRED');
  if(entry.generation?.state!=='failed'&&entry.generation?.state!=='unknown')throw Error('COVER_GENERATION_PENDING');
  const directory=folder(s,entry.workId,entry.requestId);
  if([...names,generatedFile].some(name=>fs.existsSync(path.join(directory,name))))throw Error('COVER_IMPORT_PENDING');
  const queued={...entry,generation:undefined,reason:null};
  saveEntry(s,queued);
  return queued;
 }
 const directory=folder(s,entry.workId,entry.requestId);
 if(!entry.manualGeneration&&names.some(name=>fs.existsSync(path.join(directory,name))))throw Error('COVER_IMPORT_PENDING');
 if(action==='receive'&&entry.generation?.state==='dispatching'){
  const file=path.join(directory,generatedFile);
  fs.writeFileSync(file,coverBytes.parse(raw).bytes,{flag:'wx'});
  saveEntry(s,{...entry,generation:{state:'downloaded',model:task.model,sha256:digest(file)}});
  return;
 }
 coverScope.parse(raw);
 if(action==='prepare'&&!entry.generation)return{...task,prompt:request.prompt,coverResolution:request.context?.coverResolution};
 if(action==='dispatch'&&!entry.generation){
  saveEntry(s,{...entry,generation:{state:'dispatching'}});
  return;
 }
 throw Error('COVER_SCOPE_MISMATCH');
}

export async function scanCoverInbox(s:Studio){
  for(const state of coverInboxStatus(s).filter(r=>r.state==='waiting')){
    try{
      const directory=folder(s,state.workId,state.requestId);
      const files=state.manualGeneration?[]:names.filter(name=>fs.existsSync(path.join(directory,name)));
      if(files.length>1)throw Error('COVER_INBOX_MULTIPLE_IMAGES');
      const generation=state.generation;
      const generated=!files.length&&generation?.state==='downloaded'
       ? {model:generation.model,sha256:generation.sha256}:undefined;
      if(!files.length&&!generated)continue;
      const work=s.get('works',state.workId);
      const role=coverAssetRole(state.variant);
      if(state.planItemId&&(!activeCover(s,state,work)||work.assets?.[role])){
       saveEntry(s,{...state,state:'superseded'});
       continue;
      }
      const file=path.join(directory,files[0]??generatedFile),info=fs.lstatSync(file);
      if(!info.isFile()||info.isSymbolicLink())throw Error('COVER_INBOX_FILE_REJECTED');
      if(Date.now()-info.mtimeMs<2000)continue;
      if(info.size>50*1024**2)throw Error('COVER_INBOX_FILE_TOO_LARGE');
      if(state.planItemId){
       const sha256=digest(file);
       if(s.all('works').some(work=>work.id!==state.workId&&[work.assets?.cover,state.variant&&work.assets?.cover_B].some(id=>id&&s.repo.maybe('assets',id)?.sha256===sha256)))
        throw Error('COVER_INBOX_DUPLICATE_IMAGE');
      }
      const assertWaiting=()=>{
       const current=s.repo.maybe('settings',prefix+state.requestId)?.value as InboxEntry|undefined;
       const latest=s.get('works',state.workId);
       if(current?.state!=='waiting'||(current.planItemId&&(!activeCover(s,current,latest)||latest.assets?.[role])))
        throw Error('COVER_INBOX_SUPERSEDED');
      };
      const receipt=await s.coverHandoff().receiveFile(file,state.workId,state.requestId,'image',generated,assertWaiting);
      assertWaiting();
      if(!state.manualGeneration)await s.call('work.selectAsset',{workId:state.workId,role,assetId:receipt.assetId});
      s.save('settings',{id:prefix+state.requestId,value:{...state,state:'received',assetId:receipt.assetId,receiptId:receipt.id,reason:null,receivedAt:s.now().toISOString()}});
    }catch(e){
      const reason=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'COVER_INBOX_IMAGE_INVALID';
      const current=s.repo.maybe('settings',prefix+state.requestId)?.value as InboxEntry|undefined;
      if(current?.state==='waiting'&&reason==='COVER_INBOX_SUPERSEDED')saveEntry(s,{...current,state:'superseded'});
      else if(current?.state==='waiting'&&current.reason!==reason)saveEntry(s,{...current,reason});
    }
  }
}
