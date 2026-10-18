import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {hash,type Repository,type Row} from './database';
import type {SimplePublicationRequest} from '../shared/platform-config';
import {externalTmeReceipt,externalTmePublicJob} from './external-tme-receipt';
const prefix='unified-publication:v1:';
const states=z.enum(['needs_configuration','needs_materials','queued','preparing','awaiting_authorization','awaiting_confirmation','blocked','reconcile_required','reviewing','published','rejected']);
const terminal=new Set(['reviewing','published','rejected']);
const summaries:Record<string,string>={needs_configuration:'待配置',needs_materials:'待补材料',queued:'等待准备',preparing:'正在准备',awaiting_authorization:'待授权',awaiting_confirmation:'待确认发布',blocked:'需要处理',reconcile_required:'待核对结果',reviewing:'审核中',published:'已发布',rejected:'审核未通过'};
export function publicationMaterialHash(m:Row){const {workRevision,terms,...content}=m;return hash(content)}
export function publicationEffectiveMaterialHash(m:Row){const {defaults,...content}=m;return publicationMaterialHash(content)}
type Options={verify:(task:Row)=>void;now?:()=>Date};
/** Durable dispatch journal. Only Main may claim/update; renderer cannot inject observations. */
export class UnifiedPublicationService{
 constructor(readonly repo:Repository,readonly options:Options){
  repo.transaction(()=>{for(const task of this.raw())if(task.state==='preparing')this.patch(task,{state:'reconcile_required',reason:'PREPARATION_INTERRUPTED'});});
 }
 private stamp(){return (this.options.now?.()??new Date()).toISOString()}
 private raw():Row[]{return this.repo.all('settings').filter(r=>r.id.startsWith(prefix)).map(r=>r.value)}
 private put(task:Row){this.repo.save('settings',{id:prefix+task.id,value:task});return task}
 private patch(task:Row,patch:Row){const state=patch.state??task.state;return this.put({...task,...patch,summary:summaries[state],revision:task.revision+1,updatedAt:this.stamp()})}
 private get(id:string){const task=this.repo.maybe('settings',prefix+z.uuid().parse(id))?.value;if(!task)throw Error('NOT_FOUND');return task}
 private sourceSha(r:SimplePublicationRequest){return (r.materialSnapshot.audio?.boundAssetId?this.repo.maybe('assets',r.materialSnapshot.audio.boundAssetId)?.sha256:null)??r.materialSnapshot.audio?.sha256??null}
 private priorSubmit(audioSha:string|null){return !!audioSha&&this.repo.all('operations').some(o=>o.kind==='tme_ai_submission'&&o.phase==='submit'&&o.receiptScope?.sourceAudioSha===audioSha)}
 private source(task:Row){return this.repo.all('settings').filter(r=>r.id.startsWith('tme-ai-submission:')).map(r=>r.value).find(r=>r.id===task.submissionJobId)}
 list(){return this.raw().map(task=>{const external=task.targets?.some((t:string)=>['qqmusic','kugou'].includes(t))?externalTmeReceipt(this.repo,task.workId,task.audioSha):null;if(external)return{...task,state:external.workId===task.workId?external.state:'blocked',summary:external.workId===task.workId?summaries[external.state]:'录音已有官网投稿',reason:'OFFICIAL_RECORD_ALREADY_EXISTS',receipt:externalTmePublicJob(external).receipt};const submission=this.source(task);if(!submission)return task;
  // The Core submission service alone establishes official receipt validity.
  if(terminal.has(submission.state)&&submission.submissionByClient===true&&submission.receipt)return{...task,state:submission.state,summary:summaries[submission.state],receipt:submission.receipt,updatedAt:submission.updatedAt};
  if(submission.state==='reconcile_required'||submission.state==='dispatching')return{...task,state:'reconcile_required',summary:summaries.reconcile_required,reason:submission.reason??'SUBMISSION_IN_PROGRESS'};
  return task;
 })}
 enqueue(requests:SimplePublicationRequest[]){return this.repo.transaction(()=>{
  const groups=new Map<string,SimplePublicationRequest[]>();
  for(const r of requests){const provider=['qqmusic','kugou'].includes(r.target)?'tme':r.target;const key=hash([provider,r.accountId,this.sourceSha(r)??r.workId]);groups.set(key,[...(groups.get(key)??[]),r]);}
  return [...groups].map(([familyKey,items])=>{
   const r=items[0],targets=[...new Set(items.map(r=>r.target))].sort(),fingerprint=publicationMaterialHash(r.materialSnapshot);
   const external=targets.some(t=>['qqmusic','kugou'].includes(t))?externalTmeReceipt(this.repo,r.workId,this.sourceSha(r)):null;
   const materialFingerprints=Object.fromEntries(items.map(item=>[item.target,publicationMaterialHash(item.materialSnapshot)]));
   const conflictingMaterials=new Set(items.map(item=>publicationEffectiveMaterialHash(item.materialSnapshot))).size>1;
   const old=this.raw().find(t=>t.familyKey===familyKey);
   // Once a write was claimed, altered metadata cannot create a fresh upload intent.
   if(old?.dispatchedAt||old?.reason==='PROTECTED_PUBLISHED_WORK')return this.list().find(t=>t.id===old.id)!;
   const protectedWork=['把晚安留在门口','留一盏灯'].includes(r.title.normalize('NFKC').trim());
   const nonAi=r.materialSnapshot.ai==='none';
   const priorSubmit=this.priorSubmit(this.sourceSha(r));
   let state:string=external?(external.workId===r.workId?external.state:'blocked'):protectedWork?'blocked':priorSubmit?'reconcile_required':conflictingMaterials||items.some(r=>r.state==='needs_configuration')?'needs_configuration':items.some(r=>r.state==='needs_materials')?'needs_materials':nonAi?'blocked':targets.every(t=>['qqmusic','kugou'].includes(t))?'queued':'blocked';
   const reason=external?'OFFICIAL_RECORD_ALREADY_EXISTS':protectedWork?'PROTECTED_PUBLISHED_WORK':priorSubmit?'SUBMISSION_ALREADY_DISPATCHED':conflictingMaterials?'TME_TARGET_MATERIALS_CONFLICT':nonAi&&state==='blocked'?'AI_PREPARATION_NOT_APPLICABLE':state==='blocked'?'PLATFORM_EXECUTOR_UNAVAILABLE':null;
   const task={id:old?.id??randomUUID(),revision:(old?.revision??0)+1,familyKey,workId:r.workId,title:r.title,targets,accountId:r.accountId,materialFingerprint:fingerprint,materialFingerprints,materialSnapshot:r.materialSnapshot,audioSha:this.sourceSha(r),state,summary:summaries[state],reason,createdAt:old?.createdAt??this.stamp(),updatedAt:this.stamp()};
   return this.put(task);
  });
 })}
 claim(raw:unknown){const i=z.strictObject({id:z.uuid(),expectedRevision:z.number().int().positive()}).parse(raw);return this.repo.transaction(()=>{
  const task=this.get(i.id);if(task.revision!==i.expectedRevision)throw Error('REVISION_CONFLICT');
  if(task.targets?.some((t:string)=>['qqmusic','kugou'].includes(t))&&externalTmeReceipt(this.repo,task.workId,task.audioSha))throw Error('OFFICIAL_RECORD_ALREADY_EXISTS');
  if(task.reason==='AI_PREPARATION_NOT_APPLICABLE')throw Error('AI_PREPARATION_NOT_APPLICABLE');
  if(task.reason==='PROTECTED_PUBLISHED_WORK')throw Error('PROTECTED_PUBLISHED_WORK');
  if(this.priorSubmit(task.audioSha)||task.dispatchedAt||['reconcile_required',...terminal].includes(task.state))throw Error('PUBLICATION_RECONCILIATION_REQUIRED');
  if(!['queued','awaiting_authorization','blocked'].includes(task.state))throw Error('PUBLICATION_NOT_READY');
  this.options.verify(task);return this.patch(task,{state:'preparing',dispatchedAt:this.stamp(),reason:null});
 })}
 update(raw:unknown){const i=z.strictObject({id:z.uuid(),expectedRevision:z.number().int().positive(),patch:z.strictObject({state:states.optional(),reason:z.string().max(160).nullable().optional(),prepareJobId:z.uuid().optional(),submissionJobId:z.uuid().optional()})}).parse(raw);return this.repo.transaction(()=>{
  const task=this.get(i.id);if(task.revision!==i.expectedRevision)throw Error('REVISION_CONFLICT');
  if(i.patch.state&&terminal.has(i.patch.state))throw Error('OFFICIAL_RECEIPT_REQUIRED');
  if(task.state==='reconcile_required'&&i.patch.state&&i.patch.state!=='reconcile_required')throw Error('PUBLICATION_RECONCILIATION_REQUIRED');
  if(task.dispatchedAt&&i.patch.state==='queued')throw Error('PUBLICATION_RECONCILIATION_REQUIRED');
  if(i.patch.submissionJobId){const row=this.repo.maybe('settings','tme-ai-submission:'+i.patch.submissionJobId)?.value;if(!row||row.workId!==task.workId||row.prepareJobId!==(i.patch.prepareJobId??task.prepareJobId))throw Error('SUBMISSION_SCOPE');}
  return this.patch(task,i.patch);
 })}
 linkReviewed(raw:unknown){const i=z.strictObject({id:z.uuid(),expectedRevision:z.number().int().positive(),prepareJobId:z.uuid(),submissionJobId:z.uuid()}).parse(raw);return this.repo.transaction(()=>{
  const task=this.get(i.id);if(task.revision!==i.expectedRevision)throw Error('REVISION_CONFLICT');
  if(task.reason==='AI_PREPARATION_NOT_APPLICABLE')throw Error('AI_PREPARATION_NOT_APPLICABLE');
  if(task.reason==='PROTECTED_PUBLISHED_WORK')throw Error('PROTECTED_PUBLISHED_WORK');
  const prepared=this.repo.maybe('settings','tme-ai-prepare:job:'+i.prepareJobId)?.value;
  const submission=this.repo.maybe('settings','tme-ai-submission:'+i.submissionJobId)?.value;
  if(!prepared||prepared.workId!==task.workId||prepared.state!=='awaiting_terms_review'||!prepared.terms?.termsHash)throw Error('PREPARATION_REQUIRED');
  if(!submission||submission.workId!==task.workId||submission.prepareJobId!==prepared.id||submission.state!=='reviewed'||submission.termsHash!==prepared.terms.termsHash)throw Error('SUBMISSION_REVIEW_REQUIRED');
  if(this.priorSubmit(task.audioSha))throw Error('PUBLICATION_RECONCILIATION_REQUIRED');
  this.options.verify(task);
  return this.patch(task,{prepareJobId:prepared.id,submissionJobId:submission.id,state:'awaiting_confirmation',reason:'TERMS_CONFIRMATION_REQUIRED'});
 })}
 byId(id:string){return this.list().find(t=>t.id===this.get(id).id)!}
}
