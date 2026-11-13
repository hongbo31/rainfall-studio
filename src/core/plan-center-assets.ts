import {z} from 'zod';
import type {Studio} from './studio';
import type {PlanCenterRun,PlanCenterItem} from '../shared/plan-center';
import {PlanCenterBindWorkSchema,PlanCenterSelectVersionSchema,PlanCenterConfirmMaterialsSchema} from '../shared/plan-center';
import {cleanLyricText} from '../shared/tme-lyrics';
import {hash} from './database';
import {publicationPayload} from './publication-payload';
import {resolveFanqieWork} from './fanqie-work';

const normalized=(value:string)=>cleanLyricText(value).cleaned.normalize('NFKC').replace(/\s+/g,' ').trim();
const bindingKey=(id:string)=>'plan-assets:binding:'+id;
const consentKey=(id:string)=>'plan-assets:consent:'+id;
function scope(s:Studio,itemId:string){
 const rows=s.planCenterService().list(),item=rows.items.find(i=>i.id===itemId),run=rows.runs.find(r=>r.id===item?.runId);
 if(!item||!run)throw Error('NOT_FOUND');return{item,run};
}
function assertCurrent(s:Studio,run:PlanCenterRun,item:PlanCenterItem,workId:string){
 const work=s.get('works',workId);
 if(work.artistId!==run.snapshot.artistId)throw Error('ARTIST_MISMATCH');
 if(!item.material?.lyrics||normalized(work.lyrics??'')!==normalized(String(item.material.lyrics)))throw Error('LYRICS_MISMATCH');
 if(work.title.normalize('NFKC').trim()!==String(item.material.title??'').normalize('NFKC').trim())throw Error('TITLE_MISMATCH');
 return work;
}
function versions(s:Studio,work:Record<string,any>):PlanCenterItem['versions']{
 return (['A','B'] as const).flatMap(version=>{
  const assetId=work.assets?.['audio_'+version];if(!assetId)return[];
  const asset=s.get('assets',assetId);if(asset.kind!=='audio')throw Error('ASSET_ROLE');s.locate(asset.id);
  const source=work.audioVersions?.find((v:any)=>v.assetId===assetId);
  return[{version,assetId,sha256:asset.sha256,...(source?.providerSongId?{externalId:source.providerSongId}:{})}];
 });
}
function assertEditable(s:Studio,item:PlanCenterItem,run:PlanCenterRun){
 if(run.stopRequested)throw Error('STOP_REQUESTED');
 if(s.repo.all('settings').some(r=>r.id.startsWith('plan-publication:')&&r.value?.itemId===item.id&&r.value?.publicationTaskId))throw Error('MATERIALS_LOCKED');
 if(s.planCenterService().list().stageAttempts.some(a=>a.itemId===item.id&&a.stage==='materials'&&a.state==='succeeded'))throw Error('MATERIALS_LOCKED');
}
export function bindPlanWork(s:Studio,raw:unknown){
 const input=PlanCenterBindWorkSchema.parse(raw);
 return s.repo.transaction(()=>{
  const {item,run}=scope(s,input.itemId);assertEditable(s,item,run);
  if(run.snapshot.music.route!=='manual')throw Error('EXISTING_AUDIO_ROUTE_REQUIRED');
  const work=s.get('works',input.workId);if(work.revision!==input.expectedWorkRevision)throw Error('REVISION_CONFLICT');assertCurrent(s,run,item,work.id);
  const list=versions(s,work);if(!list.length)throw Error('AUDIO_REQUIRED');
  if(item.workId&&item.workId!==work.id)throw Error('WORK_ALREADY_BOUND');
  const saved=s.planCenterService().bindWork({itemId:item.id,workId:work.id,versions:list,selectedVersion:run.snapshot.music.versionPolicy==='first'?'A':item.selectedVersion});
  s.save('settings',{id:bindingKey(item.id),value:{itemId:item.id,runId:run.id,workId:work.id,source:'existing-work',versions:list,createdAt:s.now().toISOString()}});
  s.repo.audit('planCenter.work.bound',item.id,{workId:work.id,newGeneration:false});return saved;
 });
}
/** Internal adoption of an already materialized managed music work. No renderer-supplied asset IDs. */
export function adoptPlanMusicWork(s:Studio,run:PlanCenterRun,item:PlanCenterItem,workId:string){
 const work=assertCurrent(s,run,item,workId),list=versions(s,work);
 const selectedVersion=run.snapshot.music.versionPolicy==='first'?'A':item.selectedVersion;
 const saved=s.planCenterService().bindWork({itemId:item.id,workId,versions:list,selectedVersion,collectOnly:run.stopRequested});
 s.save('settings',{id:bindingKey(item.id),value:{itemId:item.id,runId:run.id,workId,source:'managed-music',versions:list,createdAt:s.now().toISOString()}});return saved;
}
/** Only the exact persisted inbox cover may be adopted; rewritten lyrics require a new cover. */
export function adoptPlanIncomingCover(s:Studio,run:PlanCenterRun,item:PlanCenterItem,rewriteCount:number){
 if(rewriteCount)throw Error('COVER_REFRESH_REQUIRED');
 if(!item.workId)throw Error('WORK_BINDING_REQUIRED');
 const work=assertCurrent(s,run,item,item.workId);
 const candidate=typeof item.material?.candidateId==='string'?s.repo.maybe('textCandidates',item.material.candidateId):null;
 const cover=candidate?.cover,asset=cover?.assetId?s.repo.maybe('assets',cover.assetId):null;
 if(!asset||asset.kind!=='image'||asset.sha256!==cover.sha256)throw Error('COVER_REQUIRED');
 s.locate(asset.id);
 if(work.assets?.cover&&work.assets.cover!==asset.id)throw Error('COVER_ALREADY_BOUND');
 if(work.assets?.cover!==asset.id)s.save('works',{...work,revision:work.revision+1,assets:{...work.assets,cover:asset.id},assetHistory:[...new Set([...(work.assetHistory??[]),asset.id])]});
 return asset;
}
export function selectPlanVersion(s:Studio,raw:unknown){
 const input=PlanCenterSelectVersionSchema.parse(raw);
 return s.repo.transaction(()=>{
  const {item,run}=scope(s,input.itemId);assertEditable(s,item,run);if(!item.workId)throw Error('WORK_BINDING_REQUIRED');
  const work=assertCurrent(s,run,item,item.workId),list=versions(s,work);
  if(run.snapshot.music.versionPolicy==='first'&&input.version!=='A')throw Error('VERSION_POLICY_FIRST');
  if(!list.some(v=>v.version===input.version))throw Error('AUDIO_VERSION_MISMATCH');
  const changed=(work.selectedAudioVariant??'A')!==input.version;
  if(changed||work.selectedAudioVariant!==input.version)s.save('works',{...work,revision:work.revision+1,selectedAudioVariant:input.version,...(changed?{lyricsConfirmation:null}:{})});
  const saved=s.planCenterService().bindWork({itemId:item.id,workId:work.id,versions:list,selectedVersion:input.version});
  if(changed){const old=s.repo.maybe('settings',consentKey(item.id));if(old)s.save('settings',{...old,value:{...old.value,invalidated:true,invalidatedAt:s.now().toISOString()}});}
  s.repo.audit('planCenter.version.selected',item.id,{version:input.version,assetId:list.find(v=>v.version===input.version)!.assetId});return saved;
 });
}
export const ConfirmPlanMaterialsSchema=PlanCenterConfirmMaterialsSchema;
export function confirmPlanMaterials(s:Studio,raw:unknown){
 const input=ConfirmPlanMaterialsSchema.parse(raw);
 return s.repo.transaction(()=>{
  const {item,run}=scope(s,input.itemId);assertEditable(s,item,run);if(!item.workId||!item.selectedVersion)throw Error('VERSION_SELECTION_REQUIRED');
  const work=assertCurrent(s,run,item,item.workId);if(work.revision!==input.expectedWorkRevision)throw Error('REVISION_CONFLICT');
  const payload=publicationPayload(s,work);
  if(!payload.audio||!payload.cover||payload.audio.sha256!==input.audioHash||payload.cover.sha256!==input.coverHash||payload.lyrics.plainHash!==input.lyricsHash||!payload.lyrics.versionId)throw Error('MATERIALS_CHANGED');
  s.lyricService().confirm({workId:work.id,versionId:payload.lyrics.versionId,plainHash:input.lyricsHash,audioHash:input.audioHash,confirmed:true});
  const evidence={id:consentKey(item.id),value:{itemId:item.id,workId:work.id,audioHash:input.audioHash,coverHash:input.coverHash,lyricsHash:input.lyricsHash,rightsStatement:input.rightsStatement,source:'user-attestation',providerLicenseVerified:false,at:s.now().toISOString()}};
  s.save('settings',evidence);s.repo.audit('planCenter.materials.confirmed',item.id,{workId:work.id,evidenceId:evidence.id,providerLicenseVerified:false});return evidence.value;
 });
}
export function syncPlanMaterials(s:Studio,run:PlanCenterRun,item:PlanCenterItem){
 if(!item.workId)return{ready:false,reasons:['WORK_BINDING_REQUIRED']};
 const work=assertCurrent(s,run,item,item.workId),list=versions(s,work),reasons:string[]=[];
 const version=item.selectedVersion??(run.snapshot.music.versionPolicy==='first'?'A':undefined);
 if(!version)return{ready:false,reasons:['VERSION_SELECTION_REQUIRED']};
 if(!list.some(v=>v.version===version))return{ready:false,reasons:['AUDIO_REQUIRED']};
 if((work.selectedAudioVariant??'A')!==version)return{ready:false,reasons:['AUDIO_SELECTION_MISMATCH']};
 const payload=publicationPayload(s,work),consent=s.repo.maybe('settings',consentKey(item.id))?.value;
 if(run.snapshot.fanqie?.materialsConsent&&run.snapshot.authorization.publish&&!run.snapshot.publishTargets.some(t=>t.enabled)){
  if(!payload.cover)return{ready:false,reasons:['COVER_REQUIRED'],payload};
  const source=resolveFanqieWork(s,{workId:work.id,variant:version});
  if(!['generated','assisted','none'].includes(source.ai))return{ready:false,reasons:['FANQIE_AI_DISCLOSURE_REQUIRED']};
  const evidenceId='plan-fanqie-materials:'+item.id;
  s.save('settings',{id:evidenceId,value:{workId:work.id,fingerprint:source.fingerprint,source:'plan-standing-consent',lyricsTextMatched:true,audioAuditionVerified:false}});
  const materials={itemId:item.id,title:work.title,lyrics:payload.lyrics.raw,coverAssetId:work.assets.cover,audioAssetId:work.assets['audio_'+version],rightsEvidenceId:evidenceId,consistencyEvidenceId:evidenceId,selectedVersion:version};
  s.planCenterService().setMaterials(materials);return{ready:true,reasons:[],workId:work.id,materials,payload};
 }
 reasons.push(...payload.warnings);
 if(!consent||consent.invalidated||consent.workId!==work.id||consent.audioHash!==payload.audio?.sha256||consent.coverHash!==payload.cover?.sha256||consent.lyricsHash!==payload.lyrics.plainHash)reasons.push('RIGHTS_ATTESTATION_REQUIRED');
 if(reasons.length||!payload.audio||!payload.cover)return{ready:false,reasons:[...new Set(reasons)],payload};
 const materials={itemId:item.id,title:work.title,lyrics:payload.lyrics.raw,coverAssetId:payload.cover.assetId,audioAssetId:payload.audio.assetId,rightsEvidenceId:consentKey(item.id),consistencyEvidenceId:'lyrics-confirmation:'+hash(JSON.stringify(work.lyricsConfirmation)),selectedVersion:version};
 s.planCenterService().setMaterials(materials);return{ready:true,reasons:[],workId:work.id,materials,payload};
}
export function planAssetsCatalog(s:Studio){
 return s.all('works').map(w=>({id:w.id,artistId:w.artistId,title:w.title,revision:w.revision,selectedAudioVariant:w.selectedAudioVariant??'A',versions:(['A','B'] as const).flatMap(version=>{const id=w.assets?.['audio_'+version];if(!id)return[];try{const a=s.get('assets',id);s.locate(id);return[{version,assetId:id,sha256:a.sha256}]}catch{return[]}}),coverAssetId:w.assets?.cover??null}));
}
export function planMaterialPreview(s:Studio,itemId:string){const {item,run}=scope(s,itemId);if(!item.workId)return null;const work=assertCurrent(s,run,item,item.workId);return{...publicationPayload(s,work),workRevision:work.revision,selectedVersion:item.selectedVersion??null,consent:s.repo.maybe('settings',consentKey(item.id))?.value??null};}
