import type {Studio} from './studio';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {CreativeDraftSchema} from '../shared/creation';
import {z} from 'zod';
const identity=z.strictObject({jobId:z.uuid()});
const digest=(p:string)=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
export function selectPublicationAudio(s:Studio,input:{workId:string;expectedRevision:number;version:'A'|'B'}){
 return s.repo.transaction(()=>{
  const work=s.get('works',input.workId);
  if(work.revision!==input.expectedRevision)throw Error('REVISION_CONFLICT');
  const assetId=work.assets?.['audio_'+input.version];if(!assetId)throw Error('AUDIO_REQUIRED');
  const asset=s.get('assets',assetId);if(asset.kind!=='audio')throw Error('ASSET_ROLE');s.locate(assetId);
  if(work.selectedAudioVariant===input.version)return work;
  const saved=s.save('works',{...work,selectedAudioVariant:input.version,revision:work.revision+1,lyricsConfirmation:null,updatedAt:s.now().toISOString()});
  s.repo.audit('work.audioVersion.select',work.id,{version:input.version,assetId});
  return saved;
 });
}

export function materialDraft(material:{number:string;title:string;lyrics:string;style:string},artist:any){
 const voice=artist.defaults?.voice,duration=artist.defaults?.duration;
 if(!['male','female'].includes(voice))throw Error('MUSIC_VOICE_CONFIGURATION_REQUIRED');
 if(!Number.isInteger(duration)||duration<10||duration>360)throw Error('MUSIC_DURATION_CONFIGURATION_REQUIRED');
 const sections:Array<{id:string;kind:string;lines:string[]}>=[];let current:{id:string;kind:string;lines:string[]}|undefined;
 for(const line of material.lyrics.replace(/\r\n/g,'\n').split('\n')){
  const head=line.match(/^\s*\[([^\]]+)\]\s*$/);if(head){current={id:'section-'+sections.length,kind:head[1],lines:[]};sections.push(current);continue;}
  if(!line.trim())continue;
  if(!current){const titleLine=new RegExp('^0*'+Number(material.number)+'\\s+').test(line)&&line.trim().endsWith(material.title);if(titleLine||line.trim()===material.title)continue;throw Error('LYRICS_SECTIONS_REQUIRED');}
  current.lines.push(line);
 }
 const nonempty=sections.filter(s=>s.lines.length);if(!nonempty.length)throw Error('LYRICS_REQUIRED');const hook=nonempty.find(s=>/副歌|chorus/i.test(s.kind))??nonempty[0];
 const prompt={positiveStyle:material.style,negativeStyle:'',durationTarget:duration,voiceArrangement:voice};
 return CreativeDraftSchema.parse({title:material.title,topic:material.title,storyBeat:'用户导入素材',language:artist.defaults?.language??'中文',style:'原素材 Style',instrumental:false,sections:nonempty,hook:{sectionId:hook.id,startLine:0,endLine:hook.lines.length},vocalPlan:nonempty.map(s=>({sectionId:s.id,voice})),musicPrompts:{suno:prompt,yourmusic:prompt},continuityNotes:'使用已核对的素材版本，不生成替代歌词或Style'});
}

export async function prepareMaterialWork(s:Studio,raw:unknown){
 const {jobId}=identity.parse(raw),service=s.materialWorkbench(),{job,material}=service.getJobContext({jobId});
 const artist=s.repo.maybe('settings','material-job-artist:'+jobId)?.value??s.get('artists',job.artistId);
 const draft=materialDraft(material,artist);
 const old=s.repo.maybe('settings','material-job-work:'+jobId)?.value;
 if(old){const work=s.get('works',old.workId),cover=s.get('assets',old.coverAssetId);if(cover.sha256!==material.checks.cover.sha256||work.assets?.cover!==cover.id)throw Error('FROZEN_COVER_MISMATCH');s.locate(cover.id);return{workId:work.id,draft};}
 const source=service.list().sources.find(x=>x.id===material.sourceId);if(!source)throw Error('SOURCE_NOT_FOUND');
 const coverPath=fs.realpathSync(material.checks.cover.path),root=fs.realpathSync(source.root),relative=path.relative(root,coverPath);
 if(relative.startsWith('..')||path.isAbsolute(relative)||digest(coverPath)!==material.checks.cover.sha256)throw Error('FROZEN_COVER_CHANGED');
 let work=s.all('works').find(w=>w.materialGenerationJobId===jobId);
 if(!work)work=s.saveWork({title:material.title,artistId:job.artistId,story:'从只读素材列表导入',lyrics:material.lyrics,prompt:material.style,parameters:{},rights:'',ai:'unknown',materialId:material.id,materialRevision:material.revision,materialContentHash:material.contentHash,materialGenerationJobId:jobId,materialSourceKey:material.sourceKey},{kind:'generation_input',provider:'user-import'});
 if(!work)throw Error('MATERIAL_WORK_REQUIRED');
 const asset=await s.importFile(coverPath,'cover',work.id,()=>{if(digest(coverPath)!==material.checks.cover.sha256)throw Error('FROZEN_COVER_CHANGED');});
 if(asset.sha256!==material.checks.cover.sha256)throw Error('FROZEN_COVER_MISMATCH');
 s.save('settings',{id:'material-job-work:'+jobId,value:{workId:work.id,coverAssetId:asset.id,coverSha256:asset.sha256,materialId:material.id,materialRevision:material.revision}});
 return{workId:work.id,draft};
}

export async function importMaterialAudio(s:Studio,raw:unknown){
 const input=z.strictObject({jobId:z.uuid(),providerSongId:z.string().min(1).max(500),providerMetadata:z.record(z.string(),z.unknown()),bytes:z.instanceof(Uint8Array).refine(b=>b.byteLength>0&&b.byteLength<=256*1024*1024),mime:z.string().min(1).max(100)}).parse(raw);
 const {job}=s.materialWorkbench().getJobContext(input);
 if(!['accepted','polling','downloading','failed'].includes(job.state)||!job.providerSongIds.includes(input.providerSongId)||input.providerMetadata.id!==input.providerSongId)throw Error('ORIGINAL_ASSET_SCOPE');
 const key='material-audio:'+job.id+':'+createHash('sha256').update(input.providerSongId).digest('hex'),old=s.repo.maybe('settings',key)?.value;
 if(old){s.locate(old.assetId);return old;}
 const filename=path.join(s.root,'staging',randomUUID()+'.provider-audio');fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,input.bytes,{flag:'wx'});
 try{const asset=await s.importFile(filename,'audio_A');s.locate(asset.id);const value={assetId:asset.id,sha256:asset.sha256,providerSongId:input.providerSongId,jobId:job.id,providerMetadata:input.providerMetadata};s.save('settings',{id:key,value});return value;}finally{fs.unlinkSync(filename);}
}

export function completeMaterialJob(s:Studio,raw:unknown){
 const input=z.strictObject({jobId:z.uuid(),actualCredits:z.number().finite().nonnegative().optional()}).parse(raw),service=s.materialWorkbench(),{job,material}=service.getJobContext(input),binding=s.repo.get('settings','material-job-work:'+job.id).value;
 const work=s.get('works',binding.workId);s.locate(binding.coverAssetId);if(work.assets?.cover!==binding.coverAssetId||s.get('assets',binding.coverAssetId).sha256!==material.checks.cover.sha256)throw Error('FROZEN_COVER_MISMATCH');
 const versions=job.providerSongIds.map((providerSongId,i)=>{
  const value=s.repo.get('settings','material-audio:'+job.id+':'+createHash('sha256').update(providerSongId).digest('hex')).value,asset=s.get('assets',value.assetId);s.locate(asset.id);if(asset.kind!=='audio'||asset.sha256!==value.sha256||i>1)throw Error('ORIGINAL_ASSET_SCOPE');
  return{id:randomUUID(),jobId:job.id,workId:work.id,assetId:asset.id,version:(i?'B':'A') as 'A'|'B',providerSongId,sha256:asset.sha256,createdAt:s.now().toISOString()};
 });
 return s.repo.transaction(()=>{
  s.save('works',{...work,assets:{...work.assets,audio_A:versions[0]?.assetId,...(versions[1]?{audio_B:versions[1].assetId}:{})},assetHistory:[...new Set([...(work.assetHistory??[]),...versions.map(v=>v.assetId)])],audioVersions:versions.map(v=>({...v,provider:'yourmusic',operationId:job.id,submittedLyrics:{text:material.lyrics}})),provider:'yourmusic',providerTaskId:job.trackingId,providerSongIds:job.providerSongIds,ai:'generated',lyricsConfirmation:null});
  return service.recordAssets({jobId:job.id,workId:work.id,versions,...(input.actualCredits!==undefined?{actualCredits:input.actualCredits}:{})});
 });
}
