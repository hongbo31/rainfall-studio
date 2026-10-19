import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {waitForStableManualCover} from './cover-readback';
import {inspectPcmWav} from '../../shared/pcm-wav';
import {tmeAiSubjectHash,TmeAiPrepareIdentitySchema,TmeAiPrepareBindingSchema,TmeAiPrepareSnapshotSchema,TmeAiPreparePublicSchemas,type TmeAiPrepareSnapshot} from '../../shared/tme-ai-prepare';
const hash=(x:any)=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const fileHash=(file:string)=>hash(fs.readFileSync(file));
export class TmeAiNativePort {
 private children=new Set<ReturnType<typeof spawn>>();
 constructor(readonly script:string,readonly executable='pwsh.exe'){}
 interrupt(){for(const child of this.children)child.kill()}
 async request(action:string,input:any){
  if(!['inspect','observe','step','inspect_picker','resume_cover_picker','locate_cover_picker','inspect_crop','confirm_existing_crop'].includes(action))throw Error('ACTION_NOT_ALLOWED');
  if(process.platform!=='win32')throw Error('WINDOWS_REQUIRED');
  return new Promise<any>((resolve,reject)=>{
   const child=spawn(this.executable,['-NoLogo','-NoProfile','-NonInteractive','-File',this.script],{windowsHide:true,stdio:['pipe','pipe','pipe']});this.children.add(child);
   let output='',done=false;const finish=(error?:Error,value?:any)=>{if(done)return;done=true;clearTimeout(timer);this.children.delete(child);error?reject(error):resolve(value)};
   const timer=setTimeout(()=>{child.kill();finish(Error('NATIVE_OUTCOME_UNKNOWN'))},['step','resume_cover_picker'].includes(action)?90000:30000);
   child.on('error',()=>finish(Error('POWERSHELL_UNAVAILABLE')));child.stderr.on('data',()=>{});
   child.stdout.on('data',b=>{output+=b.toString('utf8');if(output.length>2e6){child.kill();finish(Error('NATIVE_RESPONSE_LIMIT'))}});
   child.on('close',()=>{try{const r=JSON.parse(output.replace(/^\uFEFF/,''));if(!r.ok)throw Object.assign(Error(/^[A-Z0-9_]+$/.test(r.error)?r.error:'NATIVE_ACTION_FAILED'),{nativeDiagnostic:r.diagnostic});finish(undefined,r.value)}catch(e){finish(e instanceof Error?e:Error('NATIVE_RESPONSE_INVALID'))}});
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({action,...input}));
  });
 }
}
export function nativeSnapshot(raw:any,verified:any={}):TmeAiPrepareSnapshot {
 const observedAt=new Date(raw.observedAt).toISOString();
 const visible={kugouId:String(raw.identity.kugouId),qqDisplayName:String(raw.identity.qqDisplayName),artistName:String(raw.identity.artistName)};
 const identity=TmeAiPrepareIdentitySchema.parse({...visible,subjectType:'official_visible_binding_fingerprint',subjectHash:tmeAiSubjectHash(visible),observedAt,evidenceHash:hash(raw.identity)});
 const binding=TmeAiPrepareBindingSchema.parse(raw.binding);
 if(raw.receiptBaseline&&verified.receiptBaseline&&hash(raw.receiptBaseline)!==hash(verified.receiptBaseline))throw Error('RECEIPT_BASELINE_CHANGED');
 return TmeAiPrepareSnapshotSchema.parse({identity,binding,observedAt,evidenceHash:hash(raw),mode:raw.mode,modeText:raw.modeText,visibleSubmitButton:raw.visibleSubmitButton,...(raw.termsText?{termsText:raw.termsText,termsHash:hash(raw.termsText)}:{}),...(raw.termsDocumentSha256!==undefined?{termsDocumentSha256:raw.termsDocumentSha256}:{}),verified:{...verified,...(raw.receiptBaseline!==undefined?{receiptBaseline:raw.receiptBaseline}:{})}});
}
function verifyExistingAlbum(raw:any,g:any){
 const proof=raw.existingAlbum;
 if(g.existingAlbum?.title!==g.metadata.albumTitle||proof?.title!==g.existingAlbum?.title||g.existingAlbum?.albumId&&proof?.albumId!==g.existingAlbum.albumId||proof?.coverInherited!==true||proof?.coverReadOnly!==true)throw Error('EXISTING_ALBUM_READBACK_REQUIRED');
 return TmeAiPrepareSnapshotSchema.shape.verified.parse({existingAlbum:proof}).existingAlbum;
}
export function verifyNativeMetadata(raw:any,g:any,lyricsText:string){
 const f=raw.form,m=g.metadata;
 if(m.version!=='完整版'||m.releaseMode!=='审核通过即发布')throw Error('UNSUPPORTED_METADATA_CHOICE');
 if(!f||f.title!==m.title||f.lyrics!==lyricsText||hash(f.lyrics)!==g.lyricsHash||f.aiTool!==m.aiTool||f.generatedOn!==m.generatedOn||f.genre!==m.genre||f.language!==m.language||f.albumTitle!==m.albumTitle||f.ownLyrics!==m.ownLyrics||f.ownComposition!==m.ownComposition||f.allowCover!==m.allowCover||!f.version||!f.releaseMode)throw Error('METADATA_READBACK_REQUIRED');
 if(m.albumMode==='existing'){
  if(g.existingAlbum?.title!==m.albumTitle)throw Error('EXISTING_ALBUM_READBACK_REQUIRED');
 }else if(f.albumLanguage!==m.language||f.albumGenre!==m.genre||f.albumType!=='录音室专辑'||f.albumDescription!==m.albumDescription)throw Error('METADATA_READBACK_REQUIRED');
 // The two author chips and the song/album artist chips must be independently visible.
 for(const [label,next,name] of [['作词','作曲',m.lyricist],['作曲','AI制作信息',m.composer],['歌手名','曲风',m.artistName],['专辑歌手','专辑类型',m.artistName]]){
  if(m.albumMode==='existing'&&label==='专辑歌手')continue;
  const a=f.text.indexOf(label),b=f.text.indexOf(next,a+label.length);if(a<0||b<0||!f.text.slice(a,b).includes(name))throw Error('AUTHOR_CHIP_READBACK_REQUIRED');
 }
 return{lyricsHash:hash(f.lyrics),metadataHash:hash(m)};
}
type Options={publicationBarrier?:(scope:any)=>{reason:string}|null|Promise<{reason:string}|null>;root:string;rpc:(method:string,input?:any)=>Promise<any>;port:Pick<TmeAiNativePort,'request'>;available:()=>boolean;generation:()=>number;nativeHostHash?:()=>string;readbackTimeoutMs?:number;resolveScope?:(workId:string|undefined,createDerivative:boolean)=>Promise<any>};
export function createTmeAiPrepareBroker(o:Options){
 let busy=false,inspection:any=null,pendingConsent:any=null;
 const consentScope=(s:any)=>hash({workId:s.workId,accountId:s.accountId,sourceAudio:s.sourceAudio,upload:s.upload,cover:s.cover,...(s.existingAlbum?{existingAlbum:s.existingAlbum}:{}),lyricsHash:s.lyricsHash,metadata:s.metadata});
 let inFlightCoverRead:Promise<any>|null=null;
 const rpc=async(action:string,input:any={})=>{const r=await o.rpc('internal.tmeAiPrepare.'+action,input);if(!r.ok)throw Error(r.error.code);return r.value};
 const observeCover=async(g:any,guard:()=>void)=>({snapshot:await waitForStableManualCover({
  read:async()=>{
   const pending=o.port.request('observe',{binding:g.binding,artistName:g.metadata.artistName});inFlightCoverRead=pending;
   try{return (await pending).snapshot}finally{if(inFlightCoverRead===pending)inFlightCoverRead=null}
  },guard,timeoutMs:o.readbackTimeoutMs,
 })});
 const diagnostic=(opId:string,e:unknown)=>{if((e as any)?.nativeDiagnostic){const dir=path.join(o.root,'evidence','tme-ai');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,opId+'-native-error.json'),JSON.stringify({at:new Date().toISOString(),diagnostic:(e as any).nativeDiagnostic},null,2))}};
 const assertPublicationScope=async(s:any)=>{const barrier=await o.publicationBarrier?.({workId:s.workId,audioSha:s.sourceAudio?.sha256});if(barrier)throw Error(barrier.reason);return s};
 const scope=async(workId?:string,createDerivative=false)=>{
  if(o.resolveScope)return assertPublicationScope(await o.resolveScope(workId,createDerivative));
  const dir=path.join(o.root,'authorizations','tme-ai');
  const files=workId?[workId+'.json']:(fs.existsSync(dir)?fs.readdirSync(dir).filter(x=>/^[a-f0-9-]{36}\.json$/.test(x)):[]);
  if(files.length!==1)throw Error('LOCAL_APPROVED_A_SCOPE_REQUIRED');
  const s=JSON.parse(fs.readFileSync(path.join(dir,files[0]),'utf8').replace(/^\uFEFF/,''));
  if(s.workId!==files[0].slice(0,-5)||s.variant!=='A'||s.prepareOnly!==true||s.consent!==true)throw Error('LOCAL_APPROVED_A_SCOPE_REQUIRED');
  return assertPublicationScope(s);
 };
 const inspect=async(s:any,binding?:any)=>{
  const raw=(await o.port.request('inspect',{artistName:s.metadata.artistName,...(binding?{binding}:{})})).snapshot;
  const snap=nativeSnapshot(raw);if(raw.mode==='unknown')throw Error('AI_INTAKE_TAB_REQUIRED');
  if(snap.identity.artistName!==s.metadata.artistName)throw Error('ARTIST_IDENTITY_SCOPE');inspection={raw,snap,workId:s.workId};return inspection;
 };
 async function run(id:string,expectedRevision:number,guard:()=>void){
  let ctx=await rpc('context',{id});if(ctx.job.revision!==expectedRevision)throw Error('REVISION_CONFLICT');
  if(ctx.job.state!=='ready')return rpc('contextPublic',{id});
  const s=await scope(ctx.job.workId),g=ctx.grant.input;
  const expectedAudioDuration=inspectPcmWav(g.upload.path).displayDuration;
  for(let i=0;i<6&&ctx.job.state==='ready';i++){
   guard();const {raw,snap}=await inspect(s,g.binding);guard();
   // Reuse only durable completed evidence; every new result still needs fresh native readback.
   const previous={...([...ctx.operations].reverse().find((x:any)=>x.state==='complete')?.result?.snapshot?.verified??{}),...(ctx.job.localAlbumSnapshot?.localVerified?{albumSaved:true}:{})};
   const before={...snap,verified:previous};
   const claim=await rpc('claim',{id,expectedRevision:ctx.job.revision,step:ctx.job.step,before});guard();
   let result:any;
   try{
    const native=await o.port.request('step',{binding:g.binding,artistName:g.metadata.artistName,step:ctx.job.step,metadata:g.metadata,...(g.existingAlbum?{existingAlbum:g.existingAlbum}:{}),lyricsText:ctx.lyricsText,audioPath:g.upload.path,expectedAudioSha256:g.upload.sha256,...(g.metadata.albumMode==='existing'?{}:{expectedCoverSha256:g.cover.sha256,coverPath:ctx.coverPath}),expectedAudioDuration});guard();
    if(native.receiptBaseline!==undefined&&native.snapshot.receiptBaseline!==undefined&&hash(native.receiptBaseline)!==hash(native.snapshot.receiptBaseline))throw Error('RECEIPT_BASELINE_CHANGED');
    const read={...native.snapshot,...(native.receiptBaseline!==undefined?{receiptBaseline:native.receiptBaseline}:{})},verified={...previous},step=ctx.job.step;
    if(step==='upload_audio'){
     if(!read.form?.text.includes(path.basename(g.upload.path))||!read.form.text.includes(expectedAudioDuration)||read.form.title!==g.metadata.title)throw Error('AUDIO_READBACK_REQUIRED');
     if(native.status==='applied'){
      if(native.receipt?.selectedPath!==g.upload.path||fileHash(g.upload.path)!==g.upload.sha256)throw Error('FILE_SELECTION_PROOF_REQUIRED');
     }else{
      const e=s.existingAudioEvidence;
      if(!e||e.derivativeSha256!==g.upload.sha256||e.sourceSha256!==g.sourceAudio.sha256||e.uploadAcceptanceProven!==true||e.confirmationMethod!=='UIA exact Shell file ListItem selection and InvokePattern; same pending picker')throw Error('EXISTING_AUDIO_PROVENANCE_REQUIRED');
      const a=s.adoptExistingAudio;
      if(!a||a.subjectHash!==snap.identity.subjectHash||hash(a.binding)!==hash(snap.binding)||a.title!==g.metadata.title||a.fileName!==path.basename(g.upload.path)||a.duration!==expectedAudioDuration||a.remoteContentShaVerified!==false)throw Error('EXISTING_AUDIO_ADOPTION_SCOPE_REQUIRED');
     }
     verified.sourceAudioSha=g.sourceAudio.sha256;verified.uploadSha=g.upload.sha256;
    }
    if(step==='fill_metadata')Object.assign(verified,verifyNativeMetadata(read,g,ctx.lyricsText));
    if(step==='set_cover'){
     if(g.metadata.albumMode==='existing')verified.existingAlbum=verifyExistingAlbum(read,g);
     else{
      if(native.status!=='applied'||native.receipt?.selectedPath!==ctx.coverPath||fileHash(ctx.coverPath)!==g.cover.sha256||!read.coverState?.manualSelected)throw Error('COVER_FILE_SELECTION_PROOF_REQUIRED');
      verified.coverSha=g.cover.sha256;
     }
     verifyNativeMetadata(read,g,ctx.lyricsText);
    }
    if(step==='save_album'){
     verifyNativeMetadata(read,g,ctx.lyricsText);
     if(g.metadata.albumMode==='existing')verified.existingAlbum=verifyExistingAlbum(read,g);
     if(read.saveEvidence?.source!=='local_material_snapshot'||read.saveEvidence.remoteSavedVerified!==false||(g.metadata.albumMode!=='existing'&&!read.coverState?.manualSelected))throw Error('LOCAL_ALBUM_SNAPSHOT_REQUIRED');
     verified.albumSaved=true;
    }
    const snapshot=nativeSnapshot(read,verified);
    result={status:native.status,snapshot};
   }catch(e){
    diagnostic(claim.operation.id,e);
    // Never resend after a native action began, even if its result or readback was lost.
    guard();const reason=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'NATIVE_OUTCOME_UNKNOWN';let after;
    try{after=nativeSnapshot((await o.port.request('observe',{binding:g.binding,artistName:g.metadata.artistName})).snapshot,previous)}catch{
     await rpc('interrupt',{id,operationId:claim.operation.id,reason});return rpc('contextPublic',{id});
    }
    result={status:'unknown',snapshot:after,reason};
   }
   guard();await rpc('record',{id,operationId:claim.operation.id,result});ctx=await rpc('context',{id});
  }
  return rpc('contextPublic',{id});
 }
 return{async ui(action:string,input:any={}){
  if(!o.available())throw Error('PRODUCTION_REQUIRED');
  const gen=o.generation(),guard=()=>{if(!o.available()||o.generation()!==gen)throw Error('WORKSPACE_CHANGED')};
  if(action==='list'){TmeAiPreparePublicSchemas.list.parse(input);return rpc('listPublic')}
  if(action==='context'){const i=TmeAiPreparePublicSchemas.context.parse(input);return rpc('contextPublic',i)}
  if(busy)throw Error('NATIVE_PREPARATION_BUSY');busy=true;
  try{
   if(action==='reconcile'){
    const i=TmeAiPreparePublicSchemas.context.parse(input),ctx=await rpc('context',i),op=ctx.operations.find((x:any)=>x.id===ctx.job.operationId),g=ctx.grant.input;
    if(g.metadata.albumMode!=='existing'&&ctx.job.state==='reconcile_required'&&['NATIVE_CONTROL_CONTRACT_FAILED','MANUAL_COVER_ACCEPTANCE_REQUIRED'].includes(ctx.job.reason)&&ctx.job.step==='set_cover'&&op?.cropResume){
     const native=await observeCover(g,guard);
     // Native manualSelected already excludes visible crop controls; lyrics are not UI evidence.
     if(native.snapshot.coverState?.manualSelected===true&&native.snapshot.coverState.generatorBanner===false){
      const previous=[...ctx.operations].reverse().find((x:any)=>x.state==='complete')?.result?.snapshot?.verified??{};
      const verified={...previous,...verifyNativeMetadata(native.snapshot,g,ctx.lyricsText),coverSha:g.cover.sha256};
      await rpc('reconcileAppliedCover',{id:i.id,operationId:op.id,snapshot:nativeSnapshot(native.snapshot,verified),coverState:native.snapshot.coverState,cropAbsent:true});
     }
    }else if(g.metadata.albumMode!=='existing'&&ctx.job.state==='reconcile_required'&&['NATIVE_CONTROL_CONTRACT_FAILED','MANUAL_COVER_ACCEPTANCE_REQUIRED'].includes(ctx.job.reason)&&ctx.job.step==='save_album'){
     const native=await observeCover(g,guard);
     // Native manualSelected already excludes visible crop controls; lyrics are not UI evidence.
     if(native.snapshot.coverState?.manualSelected===true&&native.snapshot.coverState.generatorBanner===false){
      const previous=[...ctx.operations].reverse().find((x:any)=>x.state==='complete')?.result?.snapshot?.verified??{};
      const verified={...previous,...verifyNativeMetadata(native.snapshot,g,ctx.lyricsText),coverSha:g.cover.sha256};
      await rpc('reconcileAlbumSnapshot',{id:i.id,operationId:op.id,snapshot:nativeSnapshot(native.snapshot,verified),coverState:native.snapshot.coverState,cropAbsent:true});
     }
    }else if(ctx.job.state==='reconcile_required'&&ctx.job.reason==='TERMS_PREVIEW_REQUIRED'&&ctx.job.step==='advance_to_terms'){
     const native=await o.port.request('observe',{binding:g.binding,artistName:g.metadata.artistName});guard();
     if(native.snapshot.mode==='ai_authorization'&&native.snapshot.visibleSubmitButton){
      const previous={...([...ctx.operations].reverse().find((x:any)=>x.state==='complete')?.result?.snapshot?.verified??{}),...(ctx.job.localAlbumSnapshot?.localVerified?{albumSaved:true}:{})};
      await rpc('reconcileTermsPreview',{id:i.id,operationId:op.id,snapshot:nativeSnapshot(native.snapshot,previous)});
     }
    }else{await rpc('reconcile',i)}
    return rpc('contextPublic',i);
   }
   if(action==='inspect'){
    const i=z.strictObject({workId:z.uuid().optional()}).parse(input),s=await scope(i.workId),x=await inspect(s);guard();
    pendingConsent={nonce:randomUUID(),workId:s.workId,scopeHash:consentScope(s),subjectHash:x.snap.identity.subjectHash,bindingHash:hash(x.snap.binding),createdAt:Date.now()};
    return{authorizationNonce:pendingConsent.nonce,identity:{subjectType:x.snap.identity.subjectType,maskedKugouId:'***'+x.snap.identity.kugouId.slice(-4),qqDisplayName:x.snap.identity.qqDisplayName,artistName:x.snap.identity.artistName,observedAt:x.snap.observedAt},binding:x.snap.binding,page:{mode:x.raw.mode,route:x.raw.route},registered:(await rpc('listPublic')).grants.some((g:any)=>g.workId===s.workId)};
   }
   if(action==='register'){
    const i=z.strictObject({workId:z.uuid(),consent:z.literal(true),authorizationNonce:z.uuid().optional()}).parse(input);
    const reviewed=pendingConsent;pendingConsent=null;
    if(o.resolveScope&&(!reviewed||reviewed.nonce!==i.authorizationNonce||reviewed.workId!==i.workId||Date.now()-reviewed.createdAt>300000))throw Error('PREPARATION_CONSENT_REVIEW_REQUIRED');
    const s=await scope(i.workId,true);
    const prior=(await rpc('listPublic')).grants.find((g:any)=>g.workId===i.workId);
    if(prior?.suspended)throw Error('RESTORED_REQUIRES_REVIEW');
    const x=await inspect(s);guard();
    if(o.resolveScope&&(reviewed.scopeHash!==consentScope(s)||reviewed.subjectHash!==x.snap.identity.subjectHash||reviewed.bindingHash!==hash(x.snap.binding)))throw Error('PREPARATION_CONSENT_SCOPE_CHANGED');
    const material={workId:s.workId,sourceAudio:s.sourceAudio,upload:s.upload,cover:s.cover,...(s.existingAlbum?{existingAlbum:s.existingAlbum}:{}),lyricsHash:s.lyricsHash,metadata:s.metadata};
    if(prior){
     const existing=await rpc('grantContext',{id:prior.id}),g=existing.input;
     if(existing.suspended)throw Error('RESTORED_REQUIRES_REVIEW');
     if(!g||hash({workId:g.workId,sourceAudio:g.sourceAudio,upload:g.upload,cover:g.cover,...(g.existingAlbum?{existingAlbum:g.existingAlbum}:{}),lyricsHash:g.lyricsHash,metadata:g.metadata})!==hash(material)||g.identity.subjectHash!==x.snap.identity.subjectHash||hash(g.binding)!==hash(x.snap.binding))throw Error('PREPARATION_GRANT_STALE');
     return prior;
    }
    const grantInput={id:randomUUID(),...material,identity:x.snap.identity,binding:x.snap.binding,consent:true};
    if(o.resolveScope&&!s.accountId)throw Error('ACCOUNT_SCOPE_REQUIRED');
    const grant=await rpc(o.resolveScope?'registerScopedGrant':'registerGrant',o.resolveScope?{grant:grantInput,accountId:s.accountId}:grantInput);
    return(await rpc('listPublic')).grants.find((g:any)=>g.id===grant.id);
   }
   if(action==='start'){
    const i=TmeAiPreparePublicSchemas.start.parse(input),list=await rpc('listPublic'),g=list.grants.find((x:any)=>x.id===i.grantId);if(!g)throw Error('NOT_FOUND');
    const x=await inspect(await scope(g.workId));guard();const job=await rpc('start',{grantId:i.grantId,expectedRevision:i.expectedRevision,identity:x.snap.identity,binding:x.snap.binding});return rpc('contextPublic',{id:job.id});
   }
   if(action==='resumePicker'){
    const i=TmeAiPreparePublicSchemas.run.parse(input),ctx=await rpc('context',{id:i.id}),g=ctx.grant.input;
    if(g.metadata.albumMode==='existing')throw Error('EXISTING_ALBUM_COVER_READ_ONLY');
    if(ctx.job.revision!==i.expectedRevision)throw Error('REVISION_CONFLICT');
    if(ctx.job.state!=='reconcile_required'||ctx.job.step!=='set_cover'||ctx.job.reason!=='FILE_NAME_CONTROL_REQUIRED')throw Error('PICKER_RESUME_SCOPE');
    let observed=await o.port.request('inspect_picker',{binding:g.binding,artistName:g.metadata.artistName});guard();
    if(path.resolve(observed.dialog.actualDirectory)!==path.dirname(ctx.coverPath)){
     observed=await o.port.request('locate_cover_picker',{binding:g.binding,artistName:g.metadata.artistName,dialogHandle:observed.dialog.handle,coverPath:ctx.coverPath});guard();
    }
    const previous=[...ctx.operations].reverse().find((x:any)=>x.state==='complete')?.result?.snapshot?.verified??{};
    const claim=await rpc('resumeInterruptedPicker',{id:i.id,operationId:ctx.job.operationId,reason:'FILE_NAME_CONTROL_REQUIRED',snapshot:nativeSnapshot(observed.snapshot,previous),coverState:observed.snapshot.coverState,dialog:observed.dialog});
    try{
     guard();
     const native=await o.port.request('resume_cover_picker',{binding:g.binding,artistName:g.metadata.artistName,dialogHandle:claim.operation.pickerResume.dialog.handle,metadata:g.metadata,lyricsText:ctx.lyricsText,audioPath:g.upload.path,coverPath:ctx.coverPath});guard();
     if(native.receipt?.selectedPath!==ctx.coverPath||fileHash(ctx.coverPath)!==g.cover.sha256||!native.snapshot.coverState?.manualSelected)throw Error('COVER_FILE_SELECTION_PROOF_REQUIRED');
     const verified={...previous,...verifyNativeMetadata(native.snapshot,g,ctx.lyricsText),coverSha:g.cover.sha256};
     await rpc('record',{id:i.id,operationId:claim.operation.id,result:{status:'applied',snapshot:nativeSnapshot(native.snapshot,verified)}});
    }catch(e){
     guard();
     const reason=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'NATIVE_OUTCOME_UNKNOWN';
     await rpc('interrupt',{id:i.id,operationId:claim.operation.id,reason});return rpc('contextPublic',{id:i.id});
    }
    const current=await rpc('contextPublic',{id:i.id});return await run(i.id,current.job.revision,guard);
   }
   if(action==='resumeCrop'){
    const i=TmeAiPreparePublicSchemas.run.parse(input),ctx=await rpc('context',{id:i.id}),g=ctx.grant.input,s=await scope(ctx.job.workId),op=ctx.operations.find((x:any)=>x.id===ctx.job.operationId),recovery=s.cropRecovery;
    if(g.metadata.albumMode==='existing')throw Error('EXISTING_ALBUM_COVER_READ_ONLY');
    if(ctx.job.revision!==i.expectedRevision)throw Error('REVISION_CONFLICT');
    if(ctx.job.state!=='reconcile_required'||ctx.job.reason!=='CROP_DIALOG_SCOPE_REQUIRED'||!op?.pickerResume||!recovery||recovery.operationId!==op.id||recovery.jobId!==i.id||recovery.provenance!=='phase_contract_reconstruction'||recovery.hostSourceHash!==o.nativeHostHash?.())throw Error('CROP_RECONSTRUCTION_SCOPE_REQUIRED');
    const observed=await o.port.request('inspect_crop',{binding:g.binding,artistName:g.metadata.artistName});guard();
    if(recovery.hostSourceHash!==o.nativeHostHash?.())throw Error('CROP_HOST_SOURCE_CHANGED');
    if(observed.crop.groupId!==recovery.groupId)throw Error('CROP_GROUP_CHANGED');
    const previous=[...ctx.operations].reverse().find((x:any)=>x.state==='complete')?.result?.snapshot?.verified??{},snapshot=TmeAiPrepareSnapshotSchema.parse(nativeSnapshot(observed.snapshot,previous)),crop={groupId:observed.crop.groupId,heading:'调整图片',confirmName:'确认',imageCount:observed.crop.imageCount};
    // This is an explicitly reviewed reconstruction of the prior local selection phase,
    // not a historical native receipt and not proof of remote file byte identity.
    const selection={path:ctx.coverPath,sha256:g.cover.sha256,dialogHandle:op.pickerResume.dialog.handle,phase:'file_selected_crop_pending',provenance:'phase_contract_reconstruction',hostSourceHash:recovery.hostSourceHash,evidenceHash:hash({crop,snapshot,pickerResume:op.pickerResume,path:ctx.coverPath,sha256:g.cover.sha256,hostSourceHash:recovery.hostSourceHash}),remoteContentShaVerified:false};
    const claim=await rpc('resumeInterruptedCrop',{id:i.id,operationId:op.id,snapshot,crop,selection});
    try{
     guard();if(recovery.hostSourceHash!==o.nativeHostHash?.())throw Error('CROP_HOST_SOURCE_CHANGED');
     const native=await o.port.request('confirm_existing_crop',{binding:g.binding,artistName:g.metadata.artistName,groupId:observed.crop.groupId});guard();
     if(!native.snapshot.coverState?.manualSelected||fileHash(ctx.coverPath)!==g.cover.sha256)throw Error('MANUAL_COVER_ACCEPTANCE_REQUIRED');
     const verified={...previous,...verifyNativeMetadata(native.snapshot,g,ctx.lyricsText),coverSha:g.cover.sha256};
     await rpc('record',{id:i.id,operationId:claim.operation.id,result:{status:'applied',snapshot:nativeSnapshot(native.snapshot,verified)}});
    }catch(e){guard();await rpc('interrupt',{id:i.id,operationId:claim.operation.id,reason:e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'NATIVE_OUTCOME_UNKNOWN'});return rpc('contextPublic',{id:i.id})}
    const current=await rpc('contextPublic',{id:i.id});return await run(i.id,current.job.revision,guard);
   }
   if(action==='run'){const i=TmeAiPreparePublicSchemas.run.parse(input);return await run(i.id,i.expectedRevision,guard)}
   throw Error('ACTION_NOT_ALLOWED');
  }finally{
   // A timed-out observe can still be restoring its bound native tab. Keep the lock
   // until that exact request settles; never terminate another task's process.
   const pending=inFlightCoverRead;
   if(pending)void pending.then(()=>{busy=false},()=>{busy=false});else busy=false;
  }
 }};
}
