import {z} from 'zod';
import type {Studio} from './studio';
import {TmeAiSubmissionService} from './tme-ai-submission';
import {verifyTmeAiPrepareAssets} from './tme-ai-prepare-integration';
import {publicationPayload} from './publication-payload';
const idSchema=z.strictObject({id:z.uuid()}),workSchema=z.strictObject({workId:z.uuid()});
const cached=new WeakMap<Studio,{repo:Studio['repo'];service:TmeAiSubmissionService}>();
/** Read-only material inspection: never creates a work, grant, browser window or submission. */
export function inspectTmeAiSubmissionWork(s:Studio,workId:string){
 if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
 const work=s.get('works',z.uuid().parse(workId)),payload=publicationPayload(s,{...work,assets:work.assets??{}}),reasons:string[]=[];
 if(!payload.audio)reasons.push('AUDIO_REQUIRED');
 if(!payload.cover)reasons.push('COVER_REQUIRED');
 if(!payload.lyrics.plainText.trim())reasons.push('LYRICS_REQUIRED');
 if(!payload.lyrics.alignmentConfirmed)reasons.push('LYRICS_ALIGNMENT_REQUIRED');
 if(payload.warnings.includes('LYRICS_BRACKETS_REQUIRE_REVIEW'))reasons.push('LYRICS_MARKERS_REQUIRE_REVIEW');
 if(!work.rights?.trim()||/待确认|待核实|待授权|未确认|未授权|尚无|未生成/.test(work.rights))reasons.push('RIGHTS_UNCONFIRMED');
 if(!['assisted','generated'].includes(work.ai))reasons.push('AI_DISCLOSURE_REQUIRED');
 const jobs=s.repo.all('settings').filter(row=>row.id.startsWith('tme-ai-prepare:job:')).map(row=>row.value).filter(job=>job.workId===work.id);
 const prepared=jobs.find(job=>job.state==='awaiting_terms_review'&&job.localAlbumSnapshot?.localVerified&&job.terms?.termsHash);
 if(!prepared)reasons.push('PREPARATION_REQUIRED');
 if(prepared){
  const grant=s.repo.maybe('settings','tme-ai-prepare:grant:'+prepared.grantId)?.value;
  if(!grant||grant.suspended)reasons.push('PREPARATION_SCOPE_CHANGED');
  else try{verifyTmeAiPrepareAssets(s,grant.input)}catch{reasons.push('PREPARATION_SCOPE_CHANGED')}
 }
 return{workId:work.id,title:work.title,workRevision:work.revision,readyForNative:reasons.length===0,reasons,prepareJobId:prepared?.id??null,materials:{audio:!!payload.audio,cover:!!payload.cover,lyricsAligned:payload.lyrics.alignmentConfirmed,ai:work.ai},termsDependOnPreparedAudio:true};
}
export function tmeAiSubmissionService(s:Studio){
 const old=cached.get(s);if(old?.repo===s.repo)return old.service;
 const service=new TmeAiSubmissionService(s.repo,{now:s.now,resolvePrepared:id=>s.tmeAiPrepareService().context(id),verifyAssets:grant=>{
  const material=inspectTmeAiSubmissionWork(s,grant.workId);if(!material.readyForNative)throw Error('SUBMISSION_MATERIALS_CHANGED');
  verifyTmeAiPrepareAssets(s,grant);
 }});cached.set(s,{repo:s.repo,service});return service;
}
/** Only Main's parent Core port can provide consent and trusted native observations. */
export function executeTmeAiSubmission(s:Studio,action:string,input:unknown={}){
 if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
 if(action==='inspectWork')return inspectTmeAiSubmissionWork(s,workSchema.parse(input).workId);
 if(action==='preparedContext')return s.tmeAiPrepareService().context(idSchema.parse(input).id);
 if(!['review','authorize','claim','record','interrupt','reconcile','context','receiptContext','publicJob','listPublic'].includes(action))throw Error('METHOD_NOT_ALLOWED');
 const service=tmeAiSubmissionService(s);
 switch(action){
  case 'review':return service.review(input);
  case 'authorize':return service.authorize(input);
  case 'claim':return service.claim(input);
  case 'record':return service.record(input);
  case 'interrupt':return service.interrupt(input);
  case 'reconcile':return service.reconcile(input);
  case 'context':return service.context(idSchema.parse(input).id);
  case 'receiptContext':return service.receiptContext(idSchema.parse(input).id);
  case 'publicJob':return service.publicById(idSchema.parse(input).id);
  case 'listPublic':return service.listPublic(workSchema.parse(input).workId);
 }
}
