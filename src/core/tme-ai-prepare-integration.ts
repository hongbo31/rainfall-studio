import {resolveTmeAiPrepareScope} from './tme-ai-scope';
import {publishSimple} from './simple-publication';
import {unifiedPublicationService} from './unified-publication-integration';
import {TmeAiPrepareGrantSchema} from '../shared/tme-ai-prepare';
import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import type {Studio} from './studio';
import {hash} from './database';
import {digest} from './assets';
import {cleanLyricText} from '../shared/tme-lyrics';
import type {TmeAiPrepareGrant} from '../shared/tme-ai-prepare';
import {TmeAiPrepareService} from './tme-ai-prepare';

function assertPcmWav(file:string){
 const fd=fs.openSync(file,'r');
 try{
  const size=fs.fstatSync(fd).size,header=Buffer.alloc(12);
  if(size<44||size>1024*1024*1024||fs.readSync(fd,header,0,12,0)!==12||header.toString('ascii',0,4)!=='RIFF'||header.toString('ascii',8,12)!=='WAVE'||header.readUInt32LE(4)+8!==size)throw Error('UPLOAD_PCM_REQUIRED');
  let format=false,data=false,alignment=0;
  for(let offset=12,count=0;offset+8<=size&&count<10000;count++){
   const chunk=Buffer.alloc(8);fs.readSync(fd,chunk,0,8,offset);const length=chunk.readUInt32LE(4),kind=chunk.toString('ascii',0,4);offset+=8;
   if(offset+length>size)throw Error('UPLOAD_PCM_REQUIRED');
   if(kind==='fmt '){
    if(length<16||length>1000)throw Error('UPLOAD_PCM_REQUIRED');const fmt=Buffer.alloc(length);fs.readSync(fd,fmt,0,length,offset);
    const tag=fmt.readUInt16LE(0),channels=fmt.readUInt16LE(2),rate=fmt.readUInt32LE(4),bits=fmt.readUInt16LE(14);alignment=fmt.readUInt16LE(12);
    const pcm=tag===1||(tag===65534&&length>=40&&fmt.subarray(24,40).toString('hex')==='0100000000001000800000aa00389b71');
    if(!pcm||channels<1||channels>2||rate<8000||rate>192000||![16,24,32].includes(bits)||alignment!==channels*bits/8||fmt.readUInt32LE(8)!==rate*alignment)throw Error('UPLOAD_PCM_REQUIRED');format=true;
   }
   if(kind==='data'){if(!format||!length||length%alignment!==0)throw Error('UPLOAD_PCM_REQUIRED');data=true;}
   offset+=length+(length%2);
  }
  if(!format||!data)throw Error('UPLOAD_PCM_REQUIRED');
 }finally{fs.closeSync(fd)}
}
export function verifyCurrentTmeAiScope(s:Studio,g:TmeAiPrepareGrant){
 const current=resolveTmeAiPrepareScope(s,{workId:g.workId});
 const material=(v:any)=>({workId:v.workId,sourceAudio:v.sourceAudio,upload:v.upload,cover:v.cover,lyricsHash:v.lyricsHash,metadata:v.metadata,...(v.existingAlbum?{existingAlbum:v.existingAlbum}:{})});
 if(hash(material(current))!==hash(material(g)))throw Error('PREPARATION_GRANT_STALE');
}
export function verifyTmeAiPrepareAssets(s:Studio,g:TmeAiPrepareGrant){
 if(s.repo.maybe('settings','tme-ai-prepare:grant:'+g.id)?.value?.scopeSource==='current-work')verifyCurrentTmeAiScope(s,g);
 const work=s.get('works',g.workId);
 if(work.assets?.audio_A!==g.sourceAudio.assetId||g.sourceAudio.variant!=='A')throw Error('SOURCE_AUDIO_SCOPE');
 const audio=s.get('assets',g.sourceAudio.assetId);
 if(audio.kind!=='audio'||audio.sha256!==g.sourceAudio.sha256||g.upload.derivedFromSha256!==audio.sha256)throw Error('SOURCE_AUDIO_SCOPE');
 const source=s.locate(audio.id);
 if(work.assets?.cover!==g.cover.assetId)throw Error('COVER_ASSET_SCOPE');
 const cover=s.get('assets',g.cover.assetId);
 if(cover.kind!=='image'||cover.sha256!==g.cover.sha256)throw Error('COVER_ASSET_SCOPE');s.locate(cover.id);
 if(hash(cleanLyricText(work.lyrics??'').cleaned)!==g.lyricsHash)throw Error('LYRICS_HASH_CHANGED');
 if(work.title!==g.metadata.title)throw Error('WORK_METADATA_SCOPE');
 // The approved official artist identity may differ from a legacy local placeholder.
 // registerGrant binds metadata.artistName to the trusted official identity; never rename the artist row.
 if(!path.isAbsolute(g.upload.path)||!fs.existsSync(g.upload.path)||fs.lstatSync(g.upload.path).isSymbolicLink()||!fs.statSync(g.upload.path).isFile()||fs.realpathSync(g.upload.path)===fs.realpathSync(source.file))throw Error('UPLOAD_PATH_SCOPE');
 if(digest(g.upload.path)!==g.upload.sha256)throw Error('UPLOAD_HASH_CHANGED');
 assertPcmWav(g.upload.path);
 // These hashes bind approved local originals and the approved derived PCM intent.
 // They do not assert that the official site exposes a remotely verified byte hash.
}
export function createTmeAiPrepareService(s:Studio){return new TmeAiPrepareService(s.repo,{now:s.now,verifyAssets:g=>verifyTmeAiPrepareAssets(s,g),verifyResumePicker:(g,dialog)=>{
 const expected=path.dirname(s.locate(g.cover.assetId).file),same=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
 if(!path.isAbsolute(dialog.actualDirectory)||!same(path.resolve(dialog.actualDirectory),path.resolve(expected))||!same(fs.realpathSync(dialog.actualDirectory),fs.realpathSync(expected)))throw Error('PICKER_DIRECTORY_SCOPE');
},verifyResumeCrop:(g,selection)=>{
 const expected=s.locate(g.cover.assetId).file,same=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
 if(!path.isAbsolute(selection.path)||!same(path.resolve(selection.path),path.resolve(expected))||!same(fs.realpathSync(selection.path),fs.realpathSync(expected))||selection.sha256!==g.cover.sha256)throw Error('CROP_SELECTION_SCOPE');
}})}
const idSchema=z.strictObject({id:z.uuid()}),empty=z.strictObject({});
/** Only the parent Core port routes here; renderer RPC has no corresponding methods. */
export function executeTmeAiPrepare(s:Studio,action:string,input:unknown={}){
 if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
 if(action==='resolveScope')return resolveTmeAiPrepareScope(s,z.strictObject({workId:z.uuid(),createDerivative:z.boolean().optional()}).parse(input));
 if(action==='grantContext'){const id=idSchema.parse(input).id;const grant=s.repo.maybe('settings','tme-ai-prepare:grant:'+id)?.value;if(!grant)throw Error('NOT_FOUND');return grant;}
 if(action==='registerScopedGrant'){
  const i=z.strictObject({grant:TmeAiPrepareGrantSchema,accountId:z.uuid()}).parse(input);
  return s.repo.transaction(()=>{
   const tasks=unifiedPublicationService(s).list().filter(t=>t.workId===i.grant.workId&&t.targets.some((target:string)=>['qqmusic','kugou'].includes(target))&&!['published','reviewing','rejected'].includes(t.state));
   const ids=[...new Set(tasks.map(t=>t.accountId))];
   if(ids.length!==1||ids[0]!==i.accountId||tasks.some(t=>t.dispatchedAt||t.reason==='PROTECTED_PUBLISHED_WORK'))throw Error('PREPARATION_ACCOUNT_SCOPE');
   const account=s.get('accounts',i.accountId);
   if(!['tme','qqmusic','kugou'].includes(account.provider)||account.remoteSubject&&account.remoteSubject!==i.grant.identity.subjectHash)throw Error('IDENTITY_SCOPE');
   verifyCurrentTmeAiScope(s,i.grant);
   const grant=s.tmeAiPrepareService().registerGrant(i.grant);
   const saved=s.get('settings','tme-ai-prepare:grant:'+grant.id);s.save('settings',{...saved,value:{...saved.value,scopeSource:'current-work'}});
   if(!account.remoteSubject)s.save('accounts',{...account,remoteSubject:i.grant.identity.subjectHash});
   for(const task of tasks)publishSimple(s,{workIds:[task.workId],targets:task.targets,accountOverrides:Object.fromEntries(task.targets.map((t:string)=>[t,i.accountId]))});
   return grant;
  });
 }
 const service=s.tmeAiPrepareService();
 switch(action){
  case 'registerGrant':return service.registerGrant(input);
  case 'start':return service.start(input);
  case 'claim':return service.claim(input);
  case 'record':return service.record(input);
  case 'block':return service.block(input);
  case 'interrupt':return service.interrupt(input);
  case 'resumeInterruptedPicker':return service.resumeInterruptedPicker(input);
  case 'resumeInterruptedCrop':return service.resumeInterruptedCrop(input);
  case 'reconcileAppliedCover':return service.reconcileAppliedCover(input);
  case 'reconcileAlbumSnapshot':return service.reconcileAlbumSnapshot(input);
  case 'reconcileTermsPreview':return service.reconcileTermsPreview(input);
  case 'reconcile':return service.reconcile(input);
  case 'context':{const c=service.context(idSchema.parse(input).id);return{...c,lyricsText:cleanLyricText(s.get('works',c.job.workId).lyrics??'').cleaned,coverPath:s.locate(c.grant.input.cover.assetId).file,sourceAudioPath:s.locate(c.grant.input.sourceAudio.assetId).file};}
  case 'contextPublic':return service.contextPublic(idSchema.parse(input).id);
  case 'listPublic':empty.parse(input);return service.listPublic();
  default:throw Error('METHOD_NOT_ALLOWED');
 }
}
