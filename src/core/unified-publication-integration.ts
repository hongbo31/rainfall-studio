import {z} from 'zod';
import type {Studio} from './studio';
import {UnifiedPublicationService,publicationMaterialHash,publicationEffectiveMaterialHash} from './unified-publication';
import {checkSimplePublication,publishSimple} from './simple-publication';
import {listPlatformConfigurations} from './platform-config';
import {verifyTmeAiPrepareAssets,verifyCurrentTmeAiScope} from './tme-ai-prepare-integration';
const cache=new WeakMap<Studio,{repo:Studio['repo'];service:UnifiedPublicationService}>();
export function unifiedPublicationService(s:Studio){
 const old=cache.get(s);if(old?.repo===s.repo)return old.service;
 const service=new UnifiedPublicationService(s.repo,{now:s.now,verify:task=>{
  const configs=listPlatformConfigurations(s.repo);
  for(const target of task.targets){
   const config=configs.find(c=>c.target===target);if(!config)throw Error('PLATFORM_CONFIGURATION_REQUIRED');
   const current=checkSimplePublication(s,s.get('works',task.workId),config.target,config,task.accountId);
   const expected=task.materialFingerprints?.[target]??(task.targets.length===1?task.materialFingerprint:undefined);
   if(['needs_configuration','needs_materials'].includes(current.state)||(expected?publicationMaterialHash(current.materialSnapshot)!==expected:publicationEffectiveMaterialHash(current.materialSnapshot)!==publicationEffectiveMaterialHash(task.materialSnapshot)))throw Error('PUBLICATION_MATERIALS_CHANGED');
  }
 }});cache.set(s,{repo:s.repo,service});return service;
}
export function executeUnifiedPublication(s:Studio,action:string,input:unknown={}){
 if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
 const service=unifiedPublicationService(s);
 if(action==='list'){z.strictObject({}).parse(input);return service.list()}
 if(action==='claim')return service.claim(input);
 if(action==='update')return service.update(input);
 if(action==='linkReviewed')return service.linkReviewed(input);
 if(action==='prepareContext'){
  const task=service.byId(z.strictObject({id:z.uuid()}).parse(input).id);
  if(task.reason==='PROTECTED_PUBLISHED_WORK')throw Error('PROTECTED_PUBLISHED_WORK');
  const account=task.accountId?s.repo.maybe('accounts',task.accountId):null;
  const work=s.get('works',task.workId),slot=work.selectedAudioVariant==='B'?'audio_B':'audio_A',source=work.assets?.[slot]?s.repo.maybe('assets',work.assets[slot]):null;
  if(!source||!account?.remoteSubject)return{task,grant:null,job:null};
  const candidates=s.all('settings').filter(r=>r.id.startsWith('tme-ai-prepare:grant:')).map(r=>r.value).filter(g=>!g.suspended&&g.input?.workId===task.workId&&(!g.input.publicationTaskId||g.input.publicationTaskId===task.id&&g.input.accountId===task.accountId)&&g.input?.identity?.subjectHash===account.remoteSubject&&g.input?.sourceAudio?.assetId===source.id&&g.input?.sourceAudio?.sha256===source.sha256);
  const grants=candidates.filter(g=>{try{verifyTmeAiPrepareAssets(s,g.input);verifyCurrentTmeAiScope(s,g.input);return true}catch{return false}});
  if(grants.length>1)throw Error('PREPARATION_GRANT_AMBIGUOUS');
  if(!grants.length)return{task,grant:null,job:null};
  const grant=grants[0];
  const jobs=s.all('settings').filter(r=>r.id.startsWith('tme-ai-prepare:job:')).map(r=>r.value).filter(j=>j.grantId===grant.id);
  if(jobs.length>1)throw Error('PREPARATION_JOB_AMBIGUOUS');
  const scoped=!!grant.input.publicationTaskId;
  return{task,grant:{id:grant.id,revision:grant.revision,workId:task.workId,scopeKind:scoped?'task':'legacy',...(scoped?{publicationTaskId:grant.input.publicationTaskId,accountId:grant.input.accountId}:{})},job:jobs[0]??null};
 }
 throw Error('METHOD_NOT_ALLOWED');
}

/** Local factual fields only. Saving does not register preparation consent. */
export function savePublicationMetadata(s:Studio,i:{workId:string;expectedRevision:number;metadata:Record<string,unknown>}){
 return s.repo.transaction(()=>{
  const work=s.get('works',i.workId);if(work.revision!==i.expectedRevision)throw Error('REVISION_CONFLICT');
  if(['把晚安留在门口','留一盏灯'].includes(work.title.normalize('NFKC').trim()))throw Error('PROTECTED_PUBLISHED_WORK');
  const tasks=unifiedPublicationService(s).list().filter(t=>t.workId===work.id);
  if(tasks.some(t=>t.dispatchedAt)||s.all('operations').some(o=>o.workId===work.id&&['tme_ai_prepare','tme_ai_submission'].includes(o.kind)))throw Error('PUBLICATION_MATERIALS_LOCKED');
  if(String(i.metadata.generatedOn)>s.now().toISOString().slice(0,10))throw Error('GENERATED_DATE_INVALID');
  s.save('works',{...work,revision:work.revision+1,updatedAt:s.now().toISOString(),publicationMetadata:{...(work.publicationMetadata??{}),...i.metadata}});
  for(const task of tasks)publishSimple(s,{workIds:[work.id],targets:task.targets,accountOverrides:Object.fromEntries(task.targets.map((target:string)=>[target,task.accountId]))});
  return s.get('works',work.id);
 });
}
