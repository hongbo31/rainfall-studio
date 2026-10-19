import {createHash} from 'node:crypto';
import type {Locator,Page} from 'playwright-core';
import {TmeAiPrepareBindingSchema,tmeAiSubjectHash} from '../../shared/tme-ai-prepare';
import {TME_AI_INTAKE_FIELDS as intake} from './ai-intake-fields';
import {readOfficialPendingSongs} from './official-browser-read';

type Source='official'|'offline-fixture';
type Binding={transport:'cloud-playwright';sessionId:string;pageId:string;started:string};
type Identity={kugouId:string;qqDisplayName:string;artistName:string};
export type TmeAlbumBrowserAccount={identity:Identity;binding:Binding;observedAt?:string};
type ValueReader={selector:string;attribute?:string};
/** Main-only calibration. No renderer-supplied selector, route or contract is accepted by the broker.
 * A client correlation field and its independently observed result are required; a title is not
 * original-operation evidence. No corresponding production UI has been calibrated yet. */
export type TmeAlbumCreateContract={
 version:string;source:Source;origin:string;createUrl:string;resultUrls:string[];
 calibratedAt:string;evidenceHash:string;
 identityMarkers:Array<{selector:string;identityKey:'artistName'|'subjectHash'|'kugouId'|'qqDisplayName'}>;
 fields:Array<{key:'title'|'artistName'|'description'|'idempotencyKey';selector:string;required:boolean}>;
 createControl:string;
 result:{container:string;albumId:ValueReader;title:ValueReader;idempotencyKey:ValueReader};
};
export type TmeAlbumCreateClaim={
 operationId:string;idempotencyKey:string;requestHash:string;state:'dispatching'|'unknown';
 title:string;artistName:string;description?:string;subjectHash:string;binding:Binding;createdAt:string;
};
export type TmeAlbumBrowserOptions={
 page:Page;
 /** Must perform Main's fresh authoritative account observation on every call, not read a cache. */
 account:()=>Promise<TmeAlbumBrowserAccount>;
 now?:()=>Date;isolatedFixture?:boolean;createContract?:TmeAlbumCreateContract|null;
};
export type TmeAlbumBrowserEntry={candidateKey:string;remoteAlbumId?:string;title:string;artistName:string;identityLevel:'title_artist_only'|'remote_album_id';provenance:'visible-intake-candidate'|'official-pending-song-reference';source:Source};
export type TmeAlbumCreateResult={status:'succeeded'|'unknown'|'blocked';reason?:string;remoteAlbumId?:string;title?:string;operationId?:string;idempotencyKey?:string;subjectHash?:string;observedAt?:string;evidenceHash?:string;source:Source;onlineVerified:boolean};

const sha=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const shaPattern=/^[a-f0-9]{64}$/;
const missing=['origin/routes','mandatory field selectors','create control','result albumId/title/original-operation correlation','visible identity markers','calibration evidence'];
export const TME_ALBUM_PRODUCTION_CREATE_CONTRACT:TmeAlbumCreateContract|null=null;
const text=(v:unknown,max=1000):v is string=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=max;
const normalized=(s:string)=>s.trim().replace(/\s+/g,' ');

function contractReason(c:TmeAlbumCreateContract|null,fixture:boolean){
 if(!c)return'ALBUM_CREATE_CONTRACT_UNCALIBRATED';
 if(c.source==='offline-fixture'&&!fixture)return'ALBUM_FIXTURE_CONTRACT_REQUIRES_ISOLATION';
 try{
  const origin=new URL(c.origin);if(origin.origin!==c.origin||origin.protocol!=='https:'||origin.username||origin.password)throw Error();
  if(!fixture&&c.origin!=='https://y.tencentmusic.com')throw Error();
  const routes=[c.createUrl,...c.resultUrls];
  if(!c.resultUrls.length||routes.some(route=>{const u=new URL(route);return u.origin!==c.origin||!!u.username||!!u.password;}))throw Error();
  if(!['official','offline-fixture'].includes(c.source)||!text(c.version)||!shaPattern.test(c.evidenceHash)||!Number.isFinite(Date.parse(c.calibratedAt)))throw Error();
  if(!c.identityMarkers?.length||!c.identityMarkers.some(m=>m.identityKey==='artistName')||c.identityMarkers.some(m=>!text(m.selector)||!['artistName','subjectHash','kugouId','qqDisplayName'].includes(m.identityKey)))throw Error();
  if(!c.fields?.length||!c.fields.some(f=>f.key==='title'&&f.required)||!c.fields.some(f=>f.key==='idempotencyKey'&&f.required)||new Set(c.fields.map(f=>f.key)).size!==c.fields.length||c.fields.some(f=>!['title','artistName','description','idempotencyKey'].includes(f.key)||!text(f.selector)||typeof f.required!=='boolean'))throw Error();
  if(!text(c.createControl)||!text(c.result?.container)||[c.result.albumId,c.result.title,c.result.idempotencyKey].some(r=>!text(r?.selector)||r.attribute!==undefined&&!text(r.attribute)))throw Error();
 }catch{return'ALBUM_CREATE_CONTRACT_INVALID';}
 return null;
}

/** This transport owns browser observation only. Core must durably claim the operation before
 * create(), and persist any unknown result. A restarted unknown claim may only reconcile().
 * Append continues through createTmeExistingAlbumPreparePort and the existing submission executor. */
export function createTmeAlbumBrowserTransport(o:TmeAlbumBrowserOptions){
 const c=o.createContract?structuredClone(o.createContract):TME_ALBUM_PRODUCTION_CREATE_CONTRACT;
 const reason=contractReason(c,o.isolatedFixture===true),source:Source=o.isolatedFixture===true?'offline-fixture':'official';
 const page=o.page,attempts=new Map<string,string>(),keys=new Set<string>();let busy=false;
 let sessionScope:string|undefined;
 const stamp=()=> (o.now?.()??new Date()).toISOString();
 const blocked=(why:string):TmeAlbumCreateResult=>({status:'blocked',reason:why,source,onlineVerified:false});
 const unknown=(why:string):TmeAlbumCreateResult=>({status:'unknown',reason:why,source,onlineVerified:false});
 const capability=()=>({transport:'cloud-playwright' as const,source,query:{available:true,reasons:[],completeness:'partial' as const},select:{available:true,reasons:[],bindingRequiresRemoteId:true},create:{available:!reason,reasons:reason?[reason]:[],missing:reason?[...missing]:[]},reconcile:{available:!reason,reasons:reason?[reason]:[]},append:{available:o.isolatedFixture===true,reasons:o.isolatedFixture===true?[]:['EXISTING_ALBUM_WRITE_INTEGRATION_UNVERIFIED'],executor:'existing-tme-ai-preparation-and-submission',requiresExistingPreparation:true,requiresRightsAndTerms:true}});
 async function one(locator:Locator){
  if(await locator.count()!==1||!await locator.isVisible()||!await locator.evaluate(el=>{
   for(let parent:Element|null=el;parent;parent=parent.parentElement){const s=getComputedStyle(parent);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0||parent.getAttribute('aria-hidden')==='true')return false;}return true;
  }))throw Error('ALBUM_PAGE_CONTRACT_CHANGED');return locator;
 }
 function assertRoute(mode:'intake'|'create'|'result'){
  const url=page.url();
  if(mode==='intake'){if(url!==intake.route)throw Error('ALBUM_INTAKE_ROUTE_REQUIRED');return;}
  if(!c||new URL(url).origin!==c.origin||(mode==='create'?url!==c.createUrl:!c.resultUrls.includes(url)))throw Error(mode==='create'?'ALBUM_CREATE_ROUTE_REQUIRED':'ALBUM_RESULT_ROUTE_REQUIRED');
 }
 async function account(expected?:{subjectHash:string;binding:Binding;artistName?:string},mode:'intake'|'create'|'result'='intake'){
  assertRoute(mode);const a=await o.account();
  TmeAiPrepareBindingSchema.parse(a.binding);if(a.binding.transport!=='cloud-playwright')throw Error('WINDOW_BINDING_CHANGED');
  if(!/^\d{5,30}$/.test(a.identity.kugouId)||!text(a.identity.qqDisplayName)||!text(a.identity.artistName))throw Error('ACCOUNT_CHANGED');
  if(a.observedAt!==undefined){const age=Date.parse(stamp())-Date.parse(a.observedAt);if(!Number.isFinite(age)||age< -5000||age>120000)throw Error('ALBUM_ACCOUNT_OBSERVATION_STALE');}
  const subjectHash=tmeAiSubjectHash(a.identity),scope=sha({subjectHash,binding:a.binding});
  if(expected?.subjectHash!==undefined&&expected.subjectHash!==subjectHash||expected?.artistName!==undefined&&expected.artistName!==a.identity.artistName)throw Error('ACCOUNT_CHANGED');
  if(expected?.binding!==undefined&&sha(expected.binding)!==sha(a.binding))throw Error('WINDOW_BINDING_CHANGED');
  if(sessionScope!==undefined&&sessionScope!==scope)throw Error('ACCOUNT_CHANGED');sessionScope=scope;
  const markers=mode==='intake'?[{selector:intake.artist,identityKey:'artistName' as const}]:c!.identityMarkers;
  for(const marker of markers){const actual=normalized(await(await one(page.locator(marker.selector))).innerText()),wanted=marker.identityKey==='subjectHash'?subjectHash:a.identity[marker.identityKey];if(actual!==wanted)throw Error('ACCOUNT_CHANGED');}
  assertRoute(mode);return{...a,subjectHash};
 }
 async function visibleEntries(a:Awaited<ReturnType<typeof account>>):Promise<TmeAlbumBrowserEntry[]>{
  const options=page.locator(intake.albumOptions),entries:TmeAlbumBrowserEntry[]=[];
  if(await options.count()>100)throw Error('ALBUM_CATALOG_TOO_LARGE');
  for(let i=0;i<await options.count();i++){
   const option=options.nth(i),title=normalized(await(await one(option.locator('.album-name'))).innerText()),artistName=normalized(await(await one(option.locator('.singer-name'))).innerText());
   if(!text(title,200)||!text(artistName,200))throw Error('ALBUM_CANDIDATE_INVALID');
   // No album identifier has been observed in this intake DOM contract. In particular,
   // arbitrary attributes such as data-id are not evidence of the official albumId.
   entries.push({candidateKey:sha({subjectHash:a.subjectHash,binding:a.binding,title,artistName,index:i}),title,artistName,identityLevel:'title_artist_only',provenance:'visible-intake-candidate',source});
  }
  return entries;
 }
 async function catalog(input:{includeOfficialReferences?:boolean}={}){
  const a=await account(),entries=await visibleEntries(a);
  if(input.includeOfficialReferences===true){
   const references=await readOfficialPendingSongs(page);
   for(const row of references.rows){
    if(entries.some(e=>e.remoteAlbumId===row.albumId)){if(entries.some(e=>e.remoteAlbumId===row.albumId&&e.title!==row.albumName))throw Error('ALBUM_REFERENCE_CONFLICT');continue;}
    entries.push({candidateKey:sha({subjectHash:a.subjectHash,remoteAlbumId:row.albumId}),remoteAlbumId:row.albumId,title:row.albumName,artistName:a.identity.artistName,identityLevel:'remote_album_id',provenance:'official-pending-song-reference',source});
   }
  }
  await account({subjectHash:a.subjectHash,binding:a.binding});const observedAt=stamp(),scope={subjectHash:a.subjectHash,binding:a.binding};
  return{entries,scope,observedAt,evidenceHash:sha({entries,scope,observedAt}),source,onlineVerified:source==='official',completeness:'partial' as const,reasons:entries.length?[]:['VISIBLE_ALBUM_CANDIDATES_NOT_OPEN']};
 }
 async function select(input:{candidateKey:string;title:string;artistName:string;expectedSubjectHash:string;expectedBinding:Binding}){
  const expected={subjectHash:input.expectedSubjectHash,binding:input.expectedBinding,artistName:input.artistName},a=await account(expected),entries=await visibleEntries(a),matches=entries.filter(e=>e.candidateKey===input.candidateKey);
  if(matches.length!==1||matches[0].title!==input.title||matches[0].artistName!==input.artistName)throw Error('ALBUM_CANDIDATE_CHANGED');
  const exact=entries.filter(e=>e.title===input.title&&e.artistName===input.artistName);if(exact.length!==1)throw Error('ALBUM_EXACT_MATCH_REQUIRED');
  await account(expected);const fresh=await visibleEntries(a);
  if(!fresh.some(e=>e.candidateKey===input.candidateKey&&e.title===input.title&&e.artistName===input.artistName))throw Error('ALBUM_CANDIDATE_CHANGED');
  if(fresh.filter(e=>e.title===input.title&&e.artistName===input.artistName).length!==1)throw Error('ALBUM_EXACT_MATCH_REQUIRED');
  const exactText=(value:string)=>new RegExp('^\\s*'+value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').split(' ').join('\\s+')+'\\s*$');
  const candidate=await one(page.locator(intake.albumOptions).filter({has:page.locator('.album-name').filter({hasText:exactText(input.title)})}).filter({has:page.locator('.singer-name').filter({hasText:exactText(input.artistName)})}));
  await candidate.click({timeout:10000,noWaitAfter:true});
  const selected=await one(page.locator(intake.selectedAlbum));if(normalized(await selected.innerText())!==input.title)throw Error('ALBUM_READBACK_REQUIRED');await account(expected);
  return{...matches[0],observedAt:stamp(),onlineVerified:source==='official'};
 }
 function claim(input:TmeAlbumCreateClaim,write:boolean){
  if(!input||!text(input.operationId,200)||!text(input.idempotencyKey,200)||!shaPattern.test(input.requestHash)||!shaPattern.test(input.subjectHash)||!text(input.title,200)||!text(input.artistName,200)||input.description!==undefined&&(typeof input.description!=='string'||input.description.trim()!==input.description||input.description.length>20000)||!['dispatching','unknown'].includes(input.state)||!Number.isFinite(Date.parse(input.createdAt)))throw Error('ALBUM_CREATE_CLAIM_REQUIRED');
  TmeAiPrepareBindingSchema.parse(input.binding);if(input.binding.transport!=='cloud-playwright')throw Error('WINDOW_BINDING_CHANGED');
  const age=Date.parse(stamp())-Date.parse(input.createdAt);if(write&&(age< -5000||age>300000))throw Error('ALBUM_CREATE_CLAIM_STALE');
  const fingerprint=sha({...input,state:undefined});if(attempts.has(input.operationId)&&attempts.get(input.operationId)!==fingerprint)throw Error('ALBUM_OPERATION_CHANGED');return fingerprint;
 }
 const expected=(input:TmeAlbumCreateClaim)=>({subjectHash:input.subjectHash,binding:input.binding,artistName:input.artistName});
 async function value(root:Locator,reader:ValueReader){const locator=await one(root.locator(reader.selector));return normalized(reader.attribute?(await locator.getAttribute(reader.attribute)??''):await locator.innerText());}
 async function readOriginalResult(input:TmeAlbumCreateClaim):Promise<TmeAlbumCreateResult>{
  await account(expected(input),'result');const rows=page.locator(c!.result.container),matches:Locator[]=[];
  if(await rows.count()>100)return unknown('ALBUM_RESULT_AMBIGUOUS');
  for(let i=0;i<await rows.count();i++){const row=rows.nth(i);if(await row.isVisible()&&await value(row,c!.result.idempotencyKey)===input.idempotencyKey)matches.push(row);}
  if(matches.length!==1)return unknown(matches.length?'ALBUM_RESULT_AMBIGUOUS':'ALBUM_ORIGINAL_RESULT_NOT_FOUND');
  const remoteAlbumId=await value(matches[0],c!.result.albumId),title=await value(matches[0],c!.result.title);
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(remoteAlbumId)||remoteAlbumId===title)return unknown('ALBUM_RESULT_ID_INVALID');
  if(title!==input.title)return unknown('ALBUM_RESULT_TITLE_MISMATCH');await account(expected(input),'result');
  const data={operationId:input.operationId,idempotencyKey:input.idempotencyKey,requestHash:input.requestHash,remoteAlbumId,title,subjectHash:input.subjectHash,binding:input.binding,observedAt:stamp(),url:page.url(),contractVersion:c!.version};
  return{status:'succeeded',remoteAlbumId,title,operationId:input.operationId,idempotencyKey:input.idempotencyKey,subjectHash:input.subjectHash,observedAt:data.observedAt,evidenceHash:sha(data),source,onlineVerified:source==='official'};
 }
 async function reconcile(input:TmeAlbumCreateClaim):Promise<TmeAlbumCreateResult>{
  if(reason)return blocked(reason);claim(input,false);return readOriginalResult(input);
 }
 async function create(input:TmeAlbumCreateClaim):Promise<TmeAlbumCreateResult>{
  if(reason)return blocked(reason);
  if(input?.state==='unknown')return reconcile(input);
  const fingerprint=claim(input,true),key=input.subjectHash+':'+input.idempotencyKey;
  if(attempts.has(input.operationId)||keys.has(key))return unknown('ALBUM_CREATE_ALREADY_DISPATCHED');
  if(busy)throw Error('ALBUM_BROWSER_BUSY');busy=true;
  try{
   await account(expected(input),'create');
   for(const field of c!.fields)if(field.required&&!text(input[field.key],20000))throw Error('ALBUM_MANDATORY_FIELD_REQUIRED');
   // Validate every mandatory control before changing any field.
   for(const field of c!.fields){const locator=await one(page.locator(field.selector));if(!await locator.isEditable())throw Error('ALBUM_PAGE_CONTRACT_CHANGED');}
   const button=await one(page.locator(c!.createControl));if(!await button.isEnabled())throw Error('ALBUM_PAGE_CONTRACT_CHANGED');
   for(const field of c!.fields){const desired=input[field.key];if(desired===undefined)continue;await account(expected(input),'create');const locator=await one(page.locator(field.selector));await locator.fill(desired);if(await locator.inputValue()!==desired)throw Error('ALBUM_FIELD_READBACK_REQUIRED');}
   await account(expected(input),'create');
   // Fresh account observation can await a page update. Re-read the whole form after
   // that last guard, so an earlier field cannot change unnoticed before the click.
   for(const field of c!.fields){const desired=input[field.key];if(desired===undefined)continue;const locator=await one(page.locator(field.selector));if(await locator.inputValue()!==desired)throw Error('ALBUM_FIELD_READBACK_REQUIRED');}
   await one(button);if(!await button.isEnabled())throw Error('ALBUM_PAGE_CONTRACT_CHANGED');
   attempts.set(input.operationId,fingerprint);keys.add(key);
   try{await button.click({timeout:10000,noWaitAfter:true});return await readOriginalResult(input);}
   catch(error){if(error instanceof Error&&/ACCOUNT_CHANGED|WINDOW_BINDING_CHANGED|ALBUM_ACCOUNT_OBSERVATION_STALE/.test(error.message))throw error;return unknown('ALBUM_CREATE_OUTCOME_UNKNOWN');}
  }finally{busy=false;}
 }
 return{capability,catalog,select,create,reconcile};
}
