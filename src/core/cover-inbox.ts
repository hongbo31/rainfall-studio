import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import type {Studio} from './studio';
import {digest} from './assets';
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
 planItemId?:string;reason?:string|null;assetId?:string;generation?:ImageAttempt;
};
function saveEntry(s:Studio,value:InboxEntry){s.save('settings',{id:prefix+value.requestId,value});}

export function preparePlanCoverInbox(s:Studio,itemId:string,workId:string,activePlanOnly:boolean){
 const key='plan-cover-inbox:'+itemId;
 let binding=s.repo.maybe('settings',key)?.value;
 if(!binding){binding={workId,requestId:randomUUID()};s.save('settings',{id:key,value:binding});}
 if(binding.workId!==workId)throw Error('COVER_SCOPE_MISMATCH');
 s.coverHandoff().request({workId,requestId:binding.requestId,brief:''});
 try{return bindPlanInbox(s,watchCoverInbox(s,binding.requestId),itemId,activePlanOnly);}
 catch(error){
  if(!(error instanceof Error)||error.message!=='COVER_CONTEXT_CHANGED')throw error;
  const requestId=randomUUID();
  s.coverHandoff().request({workId,requestId,brief:''});
  const entry=bindPlanInbox(s,watchCoverInbox(s,requestId),itemId,activePlanOnly);
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
export function watchCoverInbox(s:Studio,requestId:string):InboxEntry{
  const request=s.coverHandoff().exportRequest(requestId);
  const directory=folder(s,request.workId,request.id);
  const old=s.repo.maybe('settings',prefix+request.id)?.value;
  if(old)return old;
  fs.writeFileSync(path.join(directory,'request.json'),JSON.stringify(request,null,2));
  fs.writeFileSync(path.join(directory,'保存图片说明.txt'),[
    `作品：${request.context.title}`,`作品 ID：${request.workId}`,
    '将这一首的正方形封面保存到本目录，文件名为 cover.png（也支持 cover.jpg / cover.jpeg / cover.webp）。',
    '只放一张图片，建议 2048×2048 以上。客户端运行时自动接收并选为本首封面。',
    '匹配依据是本目录对应的作品 ID 与请求 ID，不按相似歌名猜测。不要把其他作品图片放入这里。',
    '保存过程中请先用其他文件名，写完后再改成 cover.png。源图片保留；更新歌词后需重新创建目录。',
    '生图服务或外部工具也可将最终图片写入这里；request.json 内含本首提示词。',
  ].join('\r\n'));
  for(const row of s.repo.all('settings').filter(r=>r.id.startsWith(prefix)&&r.value?.workId===request.workId&&r.value?.state==='waiting'))
    s.save('settings',{...row,value:{...row.value,state:'superseded'}});
  const value:InboxEntry={requestId:request.id,workId:request.workId,directory,state:'waiting',expectedNames:names,createdAt:s.now().toISOString()};
  saveEntry(s,value);return value;
}
export function coverInboxStatus(s:Studio,workId?:string):InboxEntry[]{
  return s.repo.all('settings').filter(r=>r.id.startsWith(prefix)&&(!workId||r.value?.workId===workId)).map(r=>r.value);
}
function activeCover(s:Studio,entry:InboxEntry){
 if(!entry.planItemId)return false;
 const center=s.planCenterService(),item=center.list().items.find(row=>row.id===entry.planItemId&&row.workId===entry.workId);
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
const coverBytes=coverScope.extend({bytes:z.instanceof(Uint8Array).refine(v=>v.byteLength>0&&v.byteLength<=8*1024**2)});
const coverFailure=coverScope.extend({reason:z.string().regex(/^[A-Z0-9_]+$/).max(200),unknown:z.boolean()});
export function planCoverImage(s:Studio,action:string,raw:unknown){
 if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
 const service=s.planCenterService(),rows=service.list();
 const context=(entry:InboxEntry)=>{
  const work=s.repo.maybe('works',entry.workId);
  if(entry.state!=='waiting'||!entry.planItemId||!work||work.assets?.cover)return;
  const item=rows.items.find(row=>row.id===entry.planItemId&&row.workId===entry.workId);
  const run=rows.runs.find(row=>row.id===item?.runId);
  const next=item&&service.next({runId:item.runId,itemId:item.id});
  if(next?.stage!=='cover'||next.state!=='waiting'||next.reason!=='COVER_REQUIRED')return;
  const request=s.coverHandoff().get(entry.requestId);
  const route=request.generationRoute;
  const frozen=run?.snapshot.routeSnapshot?.image;
  if(request.workId!==entry.workId||request.provider!=='openai_image'||route?.capability!=='image_api'||
    frozen?.profileId!==route.profileId||frozen?.profileRevision!==route.profileRevision||
    !route.profileId||!route.profileRevision||!route.modelId)return;
  const profile=s.repo.maybe('settings','api-profile:'+route.profileId);
  if(!profile||profile.providerId!==route.providerId||profile.revision!==route.profileRevision||profile.modelId!==route.modelId)return;
  return {requestId:entry.requestId,profileId:route.profileId,expectedRevision:route.profileRevision,model:route.modelId};
 };
 if(action==='list'){
  z.strictObject({}).parse(raw);
  return coverInboxStatus(s).flatMap(entry=>{
   const task=!entry.generation&&context(entry);
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
 const directory=folder(s,entry.workId,entry.requestId);
 if(names.some(name=>fs.existsSync(path.join(directory,name))))throw Error('COVER_IMPORT_PENDING');
 if(action==='receive'&&entry.generation?.state==='dispatching'){
  const file=path.join(directory,generatedFile);
  fs.writeFileSync(file,coverBytes.parse(raw).bytes,{flag:'wx'});
  saveEntry(s,{...entry,generation:{state:'downloaded',model:task.model,sha256:digest(file)}});
  return;
 }
 coverScope.parse(raw);
 if(action==='prepare'&&!entry.generation)return{...task,prompt:request.prompt};
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
      const files=names.filter(name=>fs.existsSync(path.join(directory,name)));
      if(files.length>1)throw Error('COVER_INBOX_MULTIPLE_IMAGES');
      const generation=state.generation;
      const generated=!files.length&&generation?.state==='downloaded'
       ? {model:generation.model,sha256:generation.sha256}:undefined;
      if(!files.length&&!generated)continue;
      const work=s.get('works',state.workId);
      if(state.planItemId&&(!activeCover(s,state)||work.assets?.cover)){
       saveEntry(s,{...state,state:'superseded'});
       continue;
      }
      const file=path.join(directory,files[0]??generatedFile),info=fs.lstatSync(file);
      if(!info.isFile()||info.isSymbolicLink())throw Error('COVER_INBOX_FILE_REJECTED');
      if(Date.now()-info.mtimeMs<2000)continue;
      if(info.size>50*1024**2)throw Error('COVER_INBOX_FILE_TOO_LARGE');
      if(state.planItemId){
       const sha256=digest(file);
       if(s.all('works').some(work=>work.id!==state.workId&&work.assets?.cover&&s.repo.maybe('assets',work.assets.cover)?.sha256===sha256))
        throw Error('COVER_INBOX_DUPLICATE_IMAGE');
      }
      const receipt=await s.coverHandoff().receiveFile(file,state.workId,state.requestId,'image',generated);
      await s.call('work.selectAsset',{workId:state.workId,role:'cover',assetId:receipt.assetId});
      s.save('settings',{id:prefix+state.requestId,value:{...state,state:'received',assetId:receipt.assetId,receiptId:receipt.id,reason:null,receivedAt:s.now().toISOString()}});
    }catch(e){
      const reason=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'COVER_INBOX_IMAGE_INVALID';
      if(state.reason!==reason)s.save('settings',{id:prefix+state.requestId,value:{...state,reason}});
    }
  }
}
