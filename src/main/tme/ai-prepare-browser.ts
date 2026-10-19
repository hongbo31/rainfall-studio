import type {Page,Locator} from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {TmeAiPrepareBindingSchema,TmeAiPrepareMetadataSchema,tmeAiSubjectHash} from '../../shared/tme-ai-prepare';
import {verifyNativeMetadata,nativeSnapshot} from './ai-prepare';

type Mode='intake'|'editor'|'ai_authorization';
type Field={selector:string;kind:'input'|'select'|'checkbox'|'text'};
type Account={identity:{kugouId:string;qqDisplayName:string;artistName:string};binding:ReturnType<typeof TmeAiPrepareBindingSchema.parse>};
const keys=['title','albumTitle','albumDescription','artistName','lyricist','composer','ownLyrics','ownComposition','aiTool','generatedOn','allowCover','genre','language','version','releaseMode','lyrics','albumLanguage','albumGenre','albumType'] as const;
export type TmeAiBrowserPrepareContract={
 version:string;verified:boolean;source:'browser'|'fixture';origin:string;calibrationEvidenceHash:string;routes:string[];pageMarkers:{selector:string;text:string}[];
 mode:{selector:string;values:Record<string,Mode>};fields:Record<string,Field>;formText:string;audioInput:string;
 cover:{input:string;selected:string;crop:string;generatorBanner:string};advance:string;terms:string;submit:string;
};
/** Only the intake route and audio selector have been observed. They do not establish readiness. */
export const TME_AI_BROWSER_PREPARE_CONTRACT:TmeAiBrowserPrepareContract={
 version:'unverified-cloud-preparation',verified:false,source:'browser',origin:'https://y.tencentmusic.com',calibrationEvidenceHash:'',
 routes:['/#/user/manage/aiChoose/add'],pageMarkers:[],mode:{selector:'',values:{}},fields:{},formText:'',audioInput:'input[type="file"].upload-content-input',
 cover:{input:'',selected:'',crop:'',generatorBanner:''},advance:'',terms:'',submit:'',
};
type Options={page:Page;contract?:TmeAiBrowserPrepareContract;account:()=>Promise<Account>;now?:()=>Date};
const hash=(value:any)=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
/** Main supplies calibration and authenticated browser binding, never renderer payloads.
 * This port does not create native PID/HWND surrogates. Durable claims/restart safety remain in the broker.
 * All writes have one dispatch attempt; observe/inspect never navigate or mutate the page.
 */
export function createTmeAiBrowserPreparePort(o:Options){
 const c=structuredClone(o.contract??TME_AI_BROWSER_PREPARE_CONTRACT),page=o.page,attempted=new Set<string>();
 let busy=false,accountFingerprint:string|undefined;
 const capability=()=>{
  const selectors=[c.mode.selector,c.formText,c.audioInput,c.cover.input,c.cover.selected,c.cover.crop,c.cover.generatorBanner,c.advance,c.terms,c.submit,...keys.map(k=>c.fields[k]?.selector)];
  const available=c.verified&&c.source==='browser'&&c.origin==='https://y.tencentmusic.com'&&/^[a-f0-9]{64}$/.test(c.calibrationEvidenceHash)&&!!c.version&&c.routes.length>0&&c.pageMarkers?.length>=2&&c.pageMarkers.every(m=>!!m.selector?.trim()&&!!m.text?.trim())&&selectors.every(s=>typeof s==='string'&&!!s.trim())&&c.advance!==c.submit&&keys.every(k=>['input','select','checkbox','text'].includes(c.fields[k]?.kind))&&['intake','editor','ai_authorization'].every(mode=>Object.values(c.mode.values).includes(mode as Mode));
  return{available,reasons:available?[]:['BROWSER_AI_PREPARE_CONTRACT_UNVERIFIED'],transport:'cloud-playwright' as const};
 };
 function guard(){
  if(!capability().available)throw Error('BROWSER_AI_PREPARE_CONTRACT_UNVERIFIED');
  const u=new URL(page.url());if(u.origin!==c.origin||u.username||u.password||!c.routes.includes(u.pathname+u.search+u.hash))throw Error('PAGE_SCOPE_CHANGED');
 }
 async function one(selector:string,visible=true){const l=page.locator(selector);if(await l.count()!==1||(visible&&!await l.isVisible()))throw Error('PAGE_CONTRACT_CHANGED');return l}
 async function text(selector:string){return(await(await one(selector)).innerText()).trim()}
 async function marker(selector:string){const l=page.locator(selector),n=await l.count();if(n>1)throw Error('PAGE_CONTRACT_CHANGED');return n===1&&await l.isVisible()}
 async function account(input:any){
  guard();for(const m of c.pageMarkers)if(await text(m.selector)!==m.text)throw Error('PAGE_CONTRACT_CHANGED');const a=await o.account();TmeAiPrepareBindingSchema.parse(a.binding);
  if(a.identity.artistName!==input.artistName)throw Error('ARTIST_IDENTITY_SCOPE');
  if(input.binding&&hash(input.binding)!==hash(a.binding))throw Error('WINDOW_BINDING_CHANGED');
  const fingerprint=hash({subject:tmeAiSubjectHash(a.identity),binding:a.binding});
  if(accountFingerprint&&accountFingerprint!==fingerprint)throw Error('ACCOUNT_CHANGED');
  accountFingerprint=fingerprint;guard();return a;
 }
 async function observe(input:any){
  const a=await account(input),modeText=await text(c.mode.selector),mode=c.mode.values[modeText];if(!mode)throw Error('AI_INTAKE_TAB_REQUIRED');
  const snapshot:any={...a,observedAt:(o.now?.()??new Date()).toISOString(),route:page.url(),mode,modeText,visibleSubmitButton:false};
  if(mode==='editor'){
   const form:any={text:await text(c.formText)};
   for(const key of keys){const f=c.fields[key],l=await one(f.selector);form[key]=f.kind==='checkbox'?await l.isChecked():f.kind==='text'?await l.innerText():await l.inputValue()}
   snapshot.form=form;
   const crop=await marker(c.cover.crop),generatorBanner=await marker(c.cover.generatorBanner);
   snapshot.coverState={manualSelected:await marker(c.cover.selected)&&!crop&&!generatorBanner,generatorBanner,cropVisible:crop};
  }
  if(mode==='ai_authorization'){snapshot.termsText=await text(c.terms);snapshot.visibleSubmitButton=await marker(c.submit)}
  await account(input);nativeSnapshot(snapshot);return snapshot;
 }
 function expected(input:any){const m=TmeAiPrepareMetadataSchema.parse(input.metadata);if(typeof input.lyricsText!=='string')throw Error('LYRICS_REQUIRED');return{...m,lyrics:input.lyricsText,albumLanguage:m.language,albumGenre:m.genre,albumType:'录音室专辑'}}
 function verify(snapshot:any,input:any){
  const values=expected(input);for(const key of keys)if(snapshot.form?.[key]!==values[key])throw Error('METADATA_READBACK_REQUIRED');
  verifyNativeMetadata(snapshot,{metadata:input.metadata,lyricsHash:hash(input.lyricsText)},input.lyricsText);
 }
 async function writable(selector:string,visible=true){const l=await one(selector,visible);if(!await l.isEnabled())throw Error('PAGE_CONTRACT_CHANGED');return l}
 async function step(input:any){
  if(!['locate_intake','upload_audio','fill_metadata','set_cover','save_album','advance_to_terms'].includes(input.step))throw Error('ACTION_NOT_ALLOWED');
  const before=await observe(input);
  if(input.step==='locate_intake'){if(!['intake','editor'].includes(before.mode))throw Error('AI_INTAKE_TAB_REQUIRED');return{status:'verified_existing',snapshot:before}}
  const key=hash({binding:before.binding,step:input.step});
  if(attempted.has(key))throw Error('PREPARATION_ALREADY_DISPATCHED');
  if(input.step!=='upload_audio'&&before.mode!=='editor')throw Error('EDITOR_REQUIRED');
  if(input.step==='save_album'){
   verify(before,input);if(!before.coverState?.manualSelected)throw Error('MANUAL_COVER_ACCEPTANCE_REQUIRED');
   return{status:'applied',snapshot:{...before,saveEvidence:{source:'local_material_snapshot',remoteSavedVerified:false}}};
  }
  if(input.step==='fill_metadata'){
   const values=expected(input),controls:Record<string,Locator>={};
   // Validate the entire field contract before the first external change.
   for(const k of keys){controls[k]=await writable(c.fields[k].selector);if(c.fields[k].kind==='text'&&before.form[k]!==values[k])throw Error('READ_ONLY_FIELD_MISMATCH')}
   attempted.add(key);
   for(const k of keys){if(before.form[k]===values[k])continue;await account(input);const f=c.fields[k],l=controls[k];await writable(f.selector);
    if(f.kind==='checkbox')await l.click({timeout:10000,noWaitAfter:true});else if(f.kind==='select')await l.selectOption(String(values[k]),{timeout:10000});else if(f.kind==='input')await l.fill(String(values[k]),{timeout:10000});
   }
   const snapshot=await observe(input);verify(snapshot,input);return{status:'applied',snapshot};
  }
  if(input.step==='advance_to_terms'){
   verify(before,input);if(!before.coverState?.manualSelected)throw Error('MANUAL_COVER_ACCEPTANCE_REQUIRED');
   const control=await writable(c.advance);await account(input);attempted.add(key);
   await control.click({timeout:10000,noWaitAfter:true});
   const snapshot=await observe(input);if(snapshot.mode!=='ai_authorization'||!snapshot.termsText||!snapshot.visibleSubmitButton)throw Error('TERMS_PREVIEW_REQUIRED');
   return{status:'applied',snapshot};
  }
  const cover=input.step==='set_cover';
  if(cover){verify(before,input);if(before.coverState?.cropVisible)throw Error('CROP_CONTRACT_UNVERIFIED')}
  if(!cover&&before.mode!=='intake')throw Error('EMPTY_INTAKE_REQUIRED');
  const selectedPath=cover?input.coverPath:input.audioPath;
  if(typeof selectedPath!=='string'||!path.isAbsolute(selectedPath))throw Error('LOCAL_FILE_REQUIRED');
  if(fs.realpathSync(selectedPath)!==path.resolve(selectedPath)||fs.lstatSync(selectedPath).isSymbolicLink())throw Error('SYMLINK_UPLOAD_FORBIDDEN');
  // Upload the exact bytes hashed here, avoiding a path replacement between hashing and dispatch.
  const fd=fs.openSync(selectedPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let buffer:Buffer;
  try{if(!fs.fstatSync(fd).isFile())throw Error('LOCAL_FILE_REQUIRED');buffer=fs.readFileSync(fd)}finally{fs.closeSync(fd)}
  const sha256=hash(buffer),approvedHash=cover?input.expectedCoverSha256:input.expectedAudioSha256;
  if(!/^[a-f0-9]{64}$/.test(approvedHash??'')||sha256!==approvedHash)throw Error('ASSET_HASH_CHANGED');
  const control=await writable(cover?c.cover.input:c.audioInput,false);
  if(await control.getAttribute('type')!=='file')throw Error('FILE_INPUT_REQUIRED');
  if(await control.evaluate(el=>(el as HTMLInputElement).files?.length??0)!==0)throw Error('EXISTING_FILE_SELECTION');
  await account(input);attempted.add(key);
  await control.setInputFiles({name:path.basename(selectedPath),mimeType:cover?'application/octet-stream':'audio/wav',buffer},{timeout:30000});
  const snapshot=await observe(input);
  if(cover){if(snapshot.coverState?.cropVisible)throw Error('CROP_CONTRACT_UNVERIFIED');verify(snapshot,input);if(!snapshot.coverState?.manualSelected)throw Error('MANUAL_COVER_ACCEPTANCE_REQUIRED')}
  else if(snapshot.form?.title!==input.metadata.title||!snapshot.form?.text.includes(path.basename(selectedPath))||!input.expectedAudioDuration||!snapshot.form?.text.includes(input.expectedAudioDuration))throw Error('AUDIO_READBACK_REQUIRED');
  return{status:'applied',snapshot,receipt:{selectedPath,sha256,bytes:buffer.length,subjectHash:tmeAiSubjectHash(snapshot.identity),binding:structuredClone(snapshot.binding),remoteContentShaVerified:false}};
 }
 return{capability,async request(action:string,input:any={}){
  if(!['inspect','observe','step'].includes(action))throw Error('ACTION_NOT_ALLOWED');
  if(busy)throw Error('BROWSER_PREPARATION_BUSY');busy=true;
  try{guard();return action==='step'?await step(input):{snapshot:await observe(input)}}finally{busy=false}
 }};
}
