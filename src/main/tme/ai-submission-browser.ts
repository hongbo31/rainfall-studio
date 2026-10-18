import type {Page,Locator} from 'playwright-core';
import {createHash} from 'node:crypto';
import {TmeAiPrepareSnapshotSchema,tmeAiSubjectHash,type TmeAiPrepareBindingSchema} from '../../shared/tme-ai-prepare';
import {TmeAiSubmissionReceiptSchema,type TmeAiSubmissionCapability} from '../../shared/tme-ai-submission';
import type {z} from 'zod';
const hash=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
type Binding=z.infer<typeof TmeAiPrepareBindingSchema>;
export type TmeAiBrowserSubmissionContract={
 version:string;verified:boolean;source:'browser'|'fixture';origin:string;calibrationEvidenceHash:string;
 identity:{kugouId:string;qqDisplayName:string;artistName:string};title:string;mode:string;modeText:string;terms:string;accept:string;submit:string;
 receipt:{rows:string;kind:string;kindText:'song';songId:string;title:string;artistName:string;status:string;submittedAt:string;statuses:Record<string,'reviewing'|'rejected'|'published'>};
};
/** Main owns calibration. Never populate this object from renderer input or a remote page. */
export const TME_AI_BROWSER_SUBMISSION_CONTRACT:TmeAiBrowserSubmissionContract={version:'unverified-cloud-submission',verified:false,source:'browser',origin:'https://y.tencentmusic.com',calibrationEvidenceHash:'',identity:{kugouId:'',qqDisplayName:'',artistName:''},title:'',mode:'',modeText:'',terms:'',accept:'',submit:'',receipt:{rows:'',kind:'',kindText:'song',songId:'',title:'',artistName:'',status:'',submittedAt:'',statuses:{}}};
type Options={page:Page;binding:()=>Binding;contract?:TmeAiBrowserSubmissionContract;now?:()=>Date};
/** Durable claims and restart protection belong to the Main broker/Core journal. This port never retries writes. */
export function createTmeAiBrowserSubmissionExecutor(o:Options){
 const c=structuredClone(o.contract??TME_AI_BROWSER_SUBMISSION_CONTRACT),page=o.page,attempted=new Set<string>();let busy=false;
 const stamp=()=> (o.now?.()??new Date()).toISOString();
 const capability=():TmeAiSubmissionCapability=>{
  const fields=[c.version,c.identity.kugouId,c.identity.qqDisplayName,c.identity.artistName,c.title,c.mode,c.modeText,c.terms,c.accept,c.submit,c.receipt.rows,c.receipt.kind,c.receipt.songId,c.receipt.title,c.receipt.artistName,c.receipt.status,c.receipt.submittedAt];
  const available=c.verified&&c.source==='browser'&&c.origin==='https://y.tencentmusic.com'&&/^[a-f0-9]{64}$/.test(c.calibrationEvidenceHash)&&fields.every(v=>typeof v==='string'&&!!v.trim())&&c.receipt.kindText==='song'&&Object.keys(c.receipt.statuses).length>0;
  return{available,reasons:available?[]:['BROWSER_AI_SUBMIT_CONTRACT_UNVERIFIED','OFFICIAL_RECEIPT_CONTRACT_UNVERIFIED'],transport:'cloud-playwright'};
 };
 function guard(){if(!capability().available)throw Error('BROWSER_AI_SUBMIT_CONTRACT_UNVERIFIED');const u=new URL(page.url());if(u.origin!==c.origin||u.username||u.password)throw Error('PAGE_ORIGIN_CHANGED')}
 async function one(locator:Locator){if(await locator.count()!==1||!await locator.isVisible())throw Error('PAGE_CONTRACT_CHANGED');return locator}
 async function text(selector:string,root:Page|Locator=page){return(await(await one(root.locator(selector))).innerText()).trim()}
 async function identity(){guard();const observedAt=stamp(),visible={kugouId:await text(c.identity.kugouId),qqDisplayName:await text(c.identity.qqDisplayName),artistName:await text(c.identity.artistName)};return{...visible,subjectType:'official_visible_binding_fingerprint' as const,subjectHash:tmeAiSubjectHash(visible),observedAt,evidenceHash:hash(visible)}}
 function scope(context:any){const g=(context.prepared??context).grant?.input;if(!g)throw Error('PREPARATION_REQUIRED');return g}
 async function observe(context:any){
  const g=scope(context),who=await identity(),binding=o.binding();
  if(who.subjectHash!==g.identity.subjectHash)throw Error('IDENTITY_SCOPE');if(hash(binding)!==hash(g.binding))throw Error('WINDOW_BINDING_CHANGED');
  if(await text(c.title)!==g.metadata.title||who.artistName!==g.metadata.artistName)throw Error('SUBMISSION_SCOPE_CHANGED');
  const modeText=await text(c.mode);if(modeText!==c.modeText)throw Error('AUTHORIZATION_MODE_CHANGED');
  const termsText=await text(c.terms),submit=await one(page.locator(c.submit));
  const raw={identity:who,binding,observedAt:stamp(),mode:'ai_authorization',modeText,visibleSubmitButton:await submit.isEnabled(),termsText,termsHash:hash(termsText),verified:{}};
  guard();return TmeAiPrepareSnapshotSchema.parse({...raw,evidenceHash:hash(raw)});
 }
 function claim(context:any,phase:'accept'|'submit'){
  const {job,operation:op}=context;
  if(!job||!op||job.state!=='dispatching'||job.rightsConfirmed!==true||op.state!=='dispatching'||op.kind!=='tme_ai_submission'||op.phase!==phase||op.jobId!==job.id||job.operationId!==op.id||op.scopeHash!==job.scopeHash||! /^[a-f0-9]{64}$/.test(job.scopeHash))throw Error('SUBMISSION_CLAIM_REQUIRED');
  if(phase==='submit'){
   if(job.termsAccepted!==true)throw Error('TERMS_ACCEPTANCE_REQUIRED');
   const s=op.receiptScope,g=scope(context);
   if(!s||s.scopeHash!==job.scopeHash||s.workId!==job.workId||s.title!==g.metadata.title||s.artistName!==g.metadata.artistName||s.subjectHash!==g.identity.subjectHash||hash(s.binding)!==hash(g.binding))throw Error('SUBMISSION_RECEIPT_SCOPE_REQUIRED');
  }
  const age=Date.parse(stamp())-Date.parse(op.createdAt);if(!Number.isFinite(age)||age< -5000||age>300000)throw Error('SUBMISSION_CLAIM_STALE');
  return job.scopeHash+':'+phase;
 }
 async function readReceipt(context:any){
  guard();const operations=context.operations??[context.operation],op=operations.filter((v:any)=>v?.phase==='submit');
  if(op.length!==1||!['dispatching','unknown','complete'].includes(op[0].state))throw Error('SUBMISSION_INTENT_REQUIRED');
  const intent=op[0],s=intent.receiptScope,job=context.job;
  if(!s||intent.kind!=='tme_ai_submission'||intent.jobId!==job.id||intent.scopeHash!==job.scopeHash||s.scopeHash!==job.scopeHash||s.workId!==job.workId)throw Error('SUBMISSION_RECEIPT_SCOPE_REQUIRED');
  const who=await identity();if(who.subjectHash!==s.subjectHash)throw Error('IDENTITY_SCOPE');
  // Read-only recovery may use a fresh verified session after restart. Identity and immutable receipt scope remain mandatory.
  o.binding();
  const rows=page.locator(c.receipt.rows);if(await rows.count()!==1)throw Error('SINGLE_SONG_RECEIPT_REQUIRED');const row=await one(rows);
  if(await text(c.receipt.kind,row)!==c.receipt.kindText)throw Error('SINGLE_SONG_RECEIPT_REQUIRED');
  const title=await text(c.receipt.title,row),artistName=await text(c.receipt.artistName,row),submittedAt=await text(c.receipt.submittedAt,row),remoteId=await text(c.receipt.songId,row),status=c.receipt.statuses[await text(c.receipt.status,row)],observedAt=stamp();
  if(title!==s.title||artistName!==s.artistName||Date.parse(submittedAt)<Date.parse(intent.createdAt)-5000||Date.parse(submittedAt)>Date.parse(observedAt)+5000)throw Error('OFFICIAL_RECEIPT_SCOPE');
  guard();const data={source:'official-tencent-review-record' as const,entityType:'song' as const,remoteId,title,artistName,status,subjectHash:who.subjectHash,scopeHash:s.scopeHash,submittedAt,observedAt,url:page.url()};
  return TmeAiSubmissionReceiptSchema.parse({...data,evidenceHash:hash({data,kind:c.receipt.kindText,contract:c.version,calibration:c.calibrationEvidenceHash})});
 }
 async function run(context:any,phase:'accept'|'submit'){
  guard();const key=claim(context,phase);if(attempted.has(key))return{status:'unknown',reason:'SUBMISSION_ALREADY_DISPATCHED'};
  if(busy)throw Error('SUBMISSION_BUSY');busy=true;
  try{
   const before=await observe(context);if(before.termsHash!==context.job.termsHash)throw Error('TERMS_CHANGED');
   const checkbox=await one(page.locator(c.accept));if(!await checkbox.isEnabled())throw Error('PAGE_CONTRACT_CHANGED');
   if(phase==='submit'&&!await checkbox.isChecked())throw Error('TERMS_ACCEPTANCE_REQUIRED');
   const control=phase==='accept'?checkbox:await one(page.locator(c.submit));
   guard();attempted.add(key);
   try{
    // Exactly one click attempt; Playwright setChecked would obscure retry semantics.
    if(phase==='submit'||!await checkbox.isChecked())await control.click({timeout:10000,noWaitAfter:true});
    if(phase==='accept'){
     const snapshot=await observe(context);if(snapshot.termsHash!==context.job.termsHash||!await(await one(page.locator(c.accept))).isChecked())throw Error('ACCEPTANCE_READBACK_REQUIRED');
     return{status:'accepted',snapshot,scopeHash:context.job.scopeHash};
    }
    return{status:'reviewing',receipt:await readReceipt({...context,operations:[context.operation]})};
   }catch{return{status:'unknown',reason:phase==='accept'?'ACCEPTANCE_OUTCOME_UNKNOWN':'SUBMISSION_OUTCOME_UNKNOWN'}}
  }finally{busy=false}
 }
 return{capability,observe,accept:(context:any)=>run(context,'accept'),submit:(context:any)=>run(context,'submit'),readReceipt};
}
