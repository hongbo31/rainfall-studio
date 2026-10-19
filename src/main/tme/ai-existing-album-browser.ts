import type {Page,Locator} from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {TmeAiPrepareBindingSchema,TmeAiPrepareMetadataSchema,TmeAiPrepareSnapshotSchema,tmeAiSubjectHash} from '../../shared/tme-ai-prepare';
import {TmeAiSubmissionReceiptSchema} from '../../shared/tme-ai-submission';
import {nativeSnapshot} from './ai-prepare';
import {fillExistingTmeAiIntakeFields,TME_AI_INTAKE_FIELDS as fields} from './ai-intake-fields';
import {readOfficialPendingSongs,readOfficialSelectedAlbum} from './official-browser-read';

const route=fields.route,origin='https://y.tencentmusic.com';
const documentSha='d23d784fd9da1a9a3e0d8caec6ba264d4b89febc6dde91045c3ae90897df98e4';
// Synthetic document bytes are accepted only inside the explicitly isolated Main test seam.
const fixtureDocumentSha=createHash('sha256').update('Rainfall isolated existing-album authorization fixture v1').digest('hex');
const unavailable='EXISTING_ALBUM_WRITE_INTEGRATION_UNVERIFIED';
const authorization='我已阅读授权书，并确认向腾讯音乐人授权';
const hash=(v:any)=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
type Account={identity:{kugouId:string;qqDisplayName:string;artistName:string};binding:ReturnType<typeof TmeAiPrepareBindingSchema.parse>};
/** A Main-owned fixture contract, never a renderer option or guessed production DOM field. */
type AlbumIdReadback={source:'fixture';readSelectedAlbum:(page:Page)=>Promise<{title:string;albumId:string;subjectHash:string}>};
type Options={page:Page;account:()=>Promise<Account>;now?:()=>Date;isolatedFixture?:boolean;albumIdReadback?:AlbumIdReadback};

/** Main-only constructor. The fixture seam must never be populated from renderer input.
 * This integrated writer has not been verified live; production capability stays closed.
 * Core owns durable preparation claims and submission intent before invoking a write.
 */
function session(o:Options){
 const page=o.page;let fingerprint:string|undefined;
 const stamp=()=> (o.now?.()??new Date()).toISOString();
 const capability=()=>({available:o.isolatedFixture===true,reasons:o.isolatedFixture===true?[]:[unavailable],transport:'cloud-playwright' as const});
 const acceptedDocument=(sha:string)=>sha===documentSha||o.isolatedFixture===true&&sha===fixtureDocumentSha;
 const guard=()=>{if(!capability().available)throw Error(unavailable);if(page.url()!==route)throw Error('AI_INTAKE_TAB_REQUIRED')};
 async function one(l:Locator,visible=true){if(await l.count()!==1||visible&&!await l.isVisible())throw Error('PAGE_CONTRACT_CHANGED');return l}
 async function account(input:any={},allowRenewal=false){
  guard();const a=await o.account();TmeAiPrepareBindingSchema.parse(a.binding);
  const who=nativeSnapshot({...a,observedAt:stamp(),mode:'unknown',modeText:'',visibleSubmitButton:false}).identity;
  if(input.artistName&&input.artistName!==who.artistName)throw Error('ARTIST_IDENTITY_SCOPE');
  if(input.binding&&!allowRenewal&&hash(input.binding)!==hash(a.binding))throw Error('WINDOW_BINDING_CHANGED');
  const next=hash({subjectHash:who.subjectHash,...(!allowRenewal?{binding:a.binding}:{})});
  if(!allowRenewal&&fingerprint&&fingerprint!==next)throw Error('ACCOUNT_CHANGED');if(!allowRenewal)fingerprint=next;
  const header=await one(page.locator(fields.artist));if((await header.innerText()).trim()!==who.artistName)throw Error('ACCOUNT_CHANGED');
  guard();return{...a,who};
 }
 const checkbox=(name:string)=>page.locator('label.el-checkbox:visible').filter({hasText:new RegExp('^\\s*'+name+'\\s*$')});
 const radio=(name:string)=>page.locator('label.el-radio:visible').filter({hasText:new RegExp('^\\s*'+name+'\\s*$')});
 async function checked(l:Locator){return(await one(l)).locator('input').isChecked()}
 async function selectedAlbum(){const l=page.locator(fields.selectedAlbum);if(await l.count()>1)throw Error('ALBUM_EXACT_MATCH_REQUIRED');return await l.count()===1?(await l.innerText()).trim():null}
 async function terms(){
  const label=await one(checkbox(authorization));await one(label.locator('input'),false);
  const body=await page.locator('body').innerText();
  if(!body.includes('确认授权模式')||!body.includes('非独家授权')||body.includes('独家授权模式'))throw Error('AUTHORIZATION_MODE_CHANGED');
  await one(page.getByText('非独家授权',{exact:true}));
  if(await page.getByText('独家授权',{exact:true}).filter({visible:true}).count())throw Error('AUTHORIZATION_MODE_CHANGED');
  const iframes=page.locator('iframe:visible');if(await iframes.count()!==1)throw Error('TERMS_DOCUMENT_REQUIRED');
  const src=await iframes.getAttribute('src');if(!src)throw Error('TERMS_DOCUMENT_REQUIRED');
  const declared=new URL(src,route);if(declared.origin!==origin||declared.pathname!=='/static/pdfjs/web/viewer.html')throw Error('TERMS_DOCUMENT_REQUIRED');
  const frame=await(await iframes.elementHandle())?.contentFrame();if(!frame)throw Error('TERMS_DOCUMENT_REQUIRED');
  await frame.waitForURL(declared.href,{timeout:8000,waitUntil:'domcontentloaded'});
  const url=new URL(frame.url());if(url.origin!==origin||url.pathname!=='/static/pdfjs/web/viewer.html')throw Error('TERMS_DOCUMENT_REQUIRED');
  await frame.waitForFunction(()=>!!(window as any).PDFViewerApplication?.pdfDocument,undefined,{timeout:8000});
  const data=await frame.evaluate(async()=>{
   const pdf=(window as any).PDFViewerApplication?.pdfDocument;if(!pdf||!Number.isInteger(pdf.numPages)||pdf.numPages<1||pdf.numPages>100)throw Error('TERMS_DOCUMENT_REQUIRED');
   const bytes=await pdf.getData();if(bytes.length>5_000_000)throw Error('TERMS_DOCUMENT_TOO_LARGE');
   const pages=[];for(let n=1;n<=pdf.numPages;n++){const p=await pdf.getPage(n),c=await p.getTextContent();pages.push(c.items.map((x:any)=>typeof x.str==='string'?x.str:'').join(' '))}
   return{bytes:Array.from(bytes) as number[],text:pages.join('\n').trim()};
  });
  const termsDocumentSha256=hash(Buffer.from(data.bytes));if(!acceptedDocument(termsDocumentSha256))throw Error('TERMS_DOCUMENT_CHANGED');
  if(!data.text||data.text.length>200000||!data.text.includes('非独家'))throw Error('TERMS_DOCUMENT_CHANGED');
  await one(page.getByRole('button',{name:'提交审核',exact:true}));
  return{termsText:data.text,termsDocumentSha256,modeText:'非独家授权',visibleSubmitButton:true};
 }
 async function personName(label:string){
  const group=await one(page.locator('.base-form-item:visible').filter({has:page.locator('.base-form-item__label').filter({hasText:new RegExp('^\\s*'+label+'\\s*$')})}));
  const chips=group.locator('.person-selector .el-select__tags-text:visible');
  if(await chips.count()!==1)throw Error('AUTHOR_CHIP_READBACK_REQUIRED');
  return(await chips.innerText()).trim();
 }
 async function author(label:string,ownLabel:string){
  return{name:await personName(label),own:await checked(checkbox(ownLabel))};
 }
 async function observe(input:any={}){
  const a=await account(input),body=await page.locator('body').innerText();
  if(await checkbox(authorization).count())return{identity:a.identity,binding:a.binding,observedAt:stamp(),mode:'ai_authorization',...await terms()};
  if(!body.includes('上传AI歌曲'))throw Error('AI_INTAKE_TAB_REQUIRED');
  if(await page.locator('.el-dialog:visible,.el-message-box:visible').count())throw Error('PAGE_CONTRACT_CHANGED');
  const title=page.locator(fields.title),n=await title.count();
  if(n===0){if(await page.locator('.upload-song__row:visible').count())throw Error('EXISTING_AUDIO_COLLAPSED');return{identity:a.identity,binding:a.binding,observedAt:stamp(),mode:'intake',modeText:'上传AI歌曲',visibleSubmitButton:false}}
  await one(title);if(await page.locator('.upload-song__row:visible').count()!==1)throw Error('ONE_EXISTING_AUDIO_REQUIRED');
  const album=await selectedAlbum(),lyricist=await author('作词','我是作词人'),composer=await author('作曲','我是作曲人');
  const artistName=await personName('歌手名');if(artistName!==a.identity.artistName)throw Error('ARTIST_IDENTITY_SCOPE');
  const form:any={text:body,title:await title.inputValue(),artistName,lyricist:lyricist.name,composer:composer.name,ownLyrics:lyricist.own,ownComposition:composer.own,albumTitle:album};
  for(const k of ['genre','language','aiTool','generatedOn','lyrics'] as const)form[k]=await(await one(page.locator(fields[k]))).inputValue();
  form.version=await checked(radio('完整版'))?'完整版':'';form.releaseMode=await checked(radio('审核通过即发布'))?'审核通过即发布':'';
  const sw=await one(page.locator('.el-switch:visible'));form.allowCover=await sw.locator('input').isChecked();
  const raw:any={identity:a.identity,binding:a.binding,observedAt:stamp(),mode:'editor',modeText:'上传AI歌曲',visibleSubmitButton:false,form};
  if(album){
   await one(page.locator('.album-search:visible .selected:visible .album img:visible'));
   if(await page.locator('input[type="file"][accept*="image"]').count())throw Error('EXISTING_ALBUM_COVER_NOT_READ_ONLY');
   const contract=o.isolatedFixture===true&&o.albumIdReadback?.source==='fixture'?o.albumIdReadback:undefined;
   const production=o.isolatedFixture===true?null:await readOfficialSelectedAlbum(page);
   const observed=contract?await contract.readSelectedAlbum(page):production?{...production,subjectHash:a.who.subjectHash}:undefined;
   if(observed&&(observed.title!==album||typeof observed.albumId!=='string'||!observed.albumId.trim()||observed.subjectHash!==a.who.subjectHash))throw Error('EXISTING_ALBUM_READBACK_REQUIRED');
   raw.existingAlbum={title:album,...(observed?{albumId:observed.albumId}:{}),coverInherited:true,coverReadOnly:true};raw.coverState={manualSelected:false,generatorBanner:false,cropVisible:false,inherited:true,readOnly:true};
  }
  await account(input);return raw;
 }
 function metadata(input:any){if(input.existingAlbum?.albumId&&o.isolatedFixture===true&&o.albumIdReadback?.source!=='fixture')throw Error('ALBUM_ID_READBACK_CONTRACT_REQUIRED');const m=TmeAiPrepareMetadataSchema.parse(input.metadata);if(m.albumMode!=='existing'||m.version!=='完整版'||m.releaseMode!=='审核通过即发布')throw Error('EXISTING_ALBUM_MODE_REQUIRED');if(['把晚安留在门口','留一盏灯'].includes(m.title.normalize('NFKC')))throw Error('INTAKE_WORK_SCOPE');if(input.artistName&&input.artistName!==m.artistName)throw Error('ARTIST_IDENTITY_SCOPE');if(typeof input.lyricsText!=='string')throw Error('LYRICS_REQUIRED');return m}
 function verify(raw:any,input:any){const m=metadata(input);for(const k of ['title','artistName','albumTitle','lyricist','composer','ownLyrics','ownComposition','aiTool','generatedOn','allowCover','genre','language','version','releaseMode'] as const)if(raw.form?.[k]!==m[k])throw Error('METADATA_READBACK_REQUIRED');if(raw.form?.lyrics!==input.lyricsText)throw Error('METADATA_READBACK_REQUIRED');if(raw.existingAlbum?.title!==m.albumTitle||input.existingAlbum?.albumId&&raw.existingAlbum?.albumId!==input.existingAlbum.albumId)throw Error('EXISTING_ALBUM_READBACK_REQUIRED')}
 return{page,stamp,capability,guard,one,account,checkbox,radio,checked,observe,metadata,verify,acceptedDocument};
}

export function createTmeExistingAlbumPreparePort(o:Options){
 const s=session(o),attempted=new Set<string>();let busy=false;
 async function step(input:any){
  if(!['locate_intake','upload_audio','fill_metadata','set_cover','save_album','advance_to_terms'].includes(input.step))throw Error('ACTION_NOT_ALLOWED');
  const m=s.metadata(input),before=await s.observe(input),key=hash({binding:before.binding,step:input.step});
  if(attempted.has(key))throw Error('PREPARATION_ALREADY_DISPATCHED');
  if(input.step==='locate_intake'){if(before.mode==='ai_authorization')throw Error('AI_INTAKE_TAB_REQUIRED');return{status:'verified_existing',snapshot:before}}
  if(input.step==='upload_audio'){
   if(before.mode!=='intake')throw Error('EMPTY_INTAKE_REQUIRED');
   const file=input.audioPath;if(typeof file!=='string'||!path.isAbsolute(file))throw Error('LOCAL_FILE_REQUIRED');
   if(fs.realpathSync(file)!==path.resolve(file)||fs.lstatSync(file).isSymbolicLink())throw Error('SYMLINK_UPLOAD_FORBIDDEN');
   const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let buffer:Buffer;try{if(!fs.fstatSync(fd).isFile())throw Error('LOCAL_FILE_REQUIRED');buffer=fs.readFileSync(fd)}finally{fs.closeSync(fd)}
   if(hash(buffer)!==input.expectedAudioSha256)throw Error('ASSET_HASH_CHANGED');
   const control=await s.one(s.page.locator('input[type="file"].upload-content-input[accept*="audio/wav"]:not([multiple])'),false);
   if(!await control.isEnabled()||await control.evaluate(el=>(el as HTMLInputElement).files?.length??0))throw Error('EXISTING_FILE_SELECTION');
   await s.account(input);attempted.add(key);await control.setInputFiles({name:path.basename(file),mimeType:'audio/wav',buffer},{timeout:30000});
   const snapshot=await s.observe(input);if(snapshot.form?.title!==m.title||!snapshot.form.text.includes(path.basename(file))||!input.expectedAudioDuration||!snapshot.form.text.includes(input.expectedAudioDuration))throw Error('AUDIO_READBACK_REQUIRED');
   return{status:'applied',snapshot,receipt:{selectedPath:file,sha256:hash(buffer),bytes:buffer.length,subjectHash:tmeAiSubjectHash(snapshot.identity),binding:snapshot.binding,remoteContentShaVerified:false}};
  }
  if(before.mode!=='editor')throw Error('EDITOR_REQUIRED');
  if(input.step==='fill_metadata'){
   if(input.existingAlbum?.albumId&&before.existingAlbum&&before.existingAlbum.albumId!==input.existingAlbum.albumId)throw Error('EXISTING_ALBUM_READBACK_REQUIRED');
   // Author chips are independent facts. Do not treat the membership checkboxes as copyright declarations.
   for(const k of ['lyricist','composer','ownLyrics','ownComposition'] as const)if(before.form[k]!==m[k])throw Error('AUTHOR_CHIP_CONFLICT');
   if(before.form.allowCover!==m.allowCover||before.form.releaseMode!==m.releaseMode)throw Error('UNSUPPORTED_METADATA_CHOICE');
   await s.account(input);attempted.add(key);
   await fillExistingTmeAiIntakeFields(s.page,{title:m.title,artistName:m.artistName,albumTitle:m.albumTitle,genre:m.genre,language:m.language,version:'完整版',aiTool:m.aiTool,generatedOn:m.generatedOn,lyrics:input.lyricsText,...(typeof input.audioPath==='string'?{expectedAudioFileName:path.basename(input.audioPath)}:{}),consent:true});
   const snapshot=await s.observe(input);s.verify(snapshot,input);return{status:'applied',snapshot};
  }
  s.verify(before,input);
  if(input.step==='set_cover')return{status:'verified_existing',snapshot:before};
  if(input.step==='save_album'){
   const pending=await readOfficialPendingSongs(s.page);await s.account(input);const snapshot=await s.observe(input);s.verify(snapshot,input);
   const receiptBaseline={songIds:pending.rows.map(row=>row.id),source:'official-list'};
   return{status:'applied',snapshot:{...snapshot,receiptBaseline,saveEvidence:{source:'local_material_snapshot',remoteSavedVerified:false}},receiptBaseline};
  }
  const next=await s.one(s.page.getByRole('button',{name:'下一步',exact:true}));if(!await next.isEnabled())throw Error('PAGE_CONTRACT_CHANGED');await s.account(input);attempted.add(key);await next.click({timeout:10000,noWaitAfter:true});
  const snapshot=await s.observe(input);if(snapshot.mode!=='ai_authorization')throw Error('TERMS_PREVIEW_REQUIRED');return{status:'applied',snapshot};
 }
 return{capability:s.capability,async request(action:string,input:any={}){if(!['inspect','observe','step'].includes(action))throw Error('ACTION_NOT_ALLOWED');s.guard();if(busy)throw Error('BROWSER_PREPARATION_BUSY');busy=true;try{return action==='step'?await step(input):{snapshot:await s.observe(input)}}finally{busy=false}}};
}

export function createTmeExistingAlbumSubmissionExecutor(o:Options){
 const s=session(o),attempted=new Set<string>();let busy=false;
 const grant=(c:any)=>{const g=(c.prepared??c).grant?.input;if(!g||g.metadata.albumMode!=='existing')throw Error('PREPARATION_REQUIRED');return g};
 async function observe(c:any){const g=grant(c),raw=await s.observe({binding:g.binding,artistName:g.metadata.artistName});if(tmeAiSubjectHash(raw.identity)!==g.identity.subjectHash)throw Error('IDENTITY_SCOPE');if(raw.mode!=='ai_authorization')throw Error('AUTHORIZATION_MODE_CHANGED');return TmeAiPrepareSnapshotSchema.parse({...nativeSnapshot(raw),termsDocumentSha256:raw.termsDocumentSha256})}
 function intent(c:any){
  const ops=(c.operations??[c.operation]).filter((op:any)=>op?.phase==='submit');if(ops.length!==1)throw Error('SUBMISSION_INTENT_REQUIRED');
  const op=ops[0],r=op.receiptScope,j=c.job;
  if(!j||!r||op.kind!=='tme_ai_submission'||!['dispatching','unknown','complete'].includes(op.state)||op.jobId!==j.id||op.scopeHash!==j.scopeHash||r.scopeHash!==j.scopeHash||r.workId!==j.workId||!r.albumTitle||!Array.isArray(r.baselineSongIds)||r.baselineSongIds.some((id:any)=>typeof id!=='string')||!Number.isFinite(Date.parse(op.createdAt)))throw Error('SUBMISSION_RECEIPT_SCOPE_REQUIRED');
  return op;
 }
 async function readReceipt(c:any){
  s.guard();const op=intent(c),r=op.receiptScope,a=await s.account({},true);if(a.who.subjectHash!==r.subjectHash||a.identity.artistName!==r.artistName)throw Error('IDENTITY_SCOPE');
  const pending=await readOfficialPendingSongs(s.page);const after=await s.account({},true);if(after.who.subjectHash!==r.subjectHash)throw Error('IDENTITY_SCOPE');
  const rows=pending.rows.filter(row=>row.name===r.title&&row.albumName===r.albumTitle&&(!r.albumId||row.albumId===r.albumId)&&!r.baselineSongIds.includes(row.id)&&row.id!==row.albumId);
  if(rows.length!==1)throw Error('SINGLE_SONG_RECEIPT_REQUIRED');const row=rows[0];
  const observedAt=s.stamp();if(Date.parse(op.createdAt)>Date.parse(observedAt)+5000)throw Error('OFFICIAL_RECEIPT_SCOPE');
  const data={source:'official-tencent-review-record',entityType:'song',...(r.albumId?{albumId:row.albumId}:{}),remoteId:row.id,title:row.name,artistName:r.artistName,status:row.status,subjectHash:r.subjectHash,scopeHash:r.scopeHash,submittedAt:op.createdAt,submittedAtSource:'dispatch-intent',observedAt,url:pending.url};
  return TmeAiSubmissionReceiptSchema.parse({...data,evidenceHash:hash({data,albumId:row.albumId,albumName:row.albumName,baseline:r.baselineSongIds})});
 }
 async function run(c:any,phase:'accept'|'submit'){
  s.guard();const {job:j,operation:op}=c,g=grant(c);
  if(!j||!op||j.state!=='dispatching'||j.rightsConfirmed!==true||op.kind!=='tme_ai_submission'||op.state!=='dispatching'||op.phase!==phase||op.jobId!==j.id||j.operationId!==op.id||op.scopeHash!==j.scopeHash||!/^[a-f0-9]{64}$/.test(j.scopeHash))throw Error('SUBMISSION_CLAIM_REQUIRED');
  const age=Date.parse(s.stamp())-Date.parse(op.createdAt);if(!Number.isFinite(age)||age< -5000||age>300000)throw Error('SUBMISSION_CLAIM_STALE');
  if(phase==='submit'){const r=intent({...c,operations:[op]}).receiptScope;if(j.termsAccepted!==true)throw Error('TERMS_ACCEPTANCE_REQUIRED');if(r.albumId!==g.existingAlbum?.albumId||r.title!==g.metadata.title||r.albumTitle!==g.metadata.albumTitle||r.artistName!==g.metadata.artistName||r.subjectHash!==g.identity.subjectHash||hash(r.binding)!==hash(g.binding)||!s.acceptedDocument(r.termsDocumentSha256))throw Error('SUBMISSION_RECEIPT_SCOPE_REQUIRED')}
  const key=j.scopeHash+':'+phase;if(attempted.has(key))return{status:'unknown',reason:'SUBMISSION_ALREADY_DISPATCHED'};if(busy)throw Error('SUBMISSION_BUSY');busy=true;
  try{
   const before=await observe(c);if(before.termsHash!==j.termsHash||before.termsDocumentSha256!==j.termsDocumentSha256)throw Error('TERMS_CHANGED');
   const label=await s.one(s.checkbox(authorization)),input=await s.one(label.locator('input'),false);if(!await input.isEnabled())throw Error('PAGE_CONTRACT_CHANGED');
   if(phase==='submit'&&!await input.isChecked())throw Error('TERMS_ACCEPTANCE_REQUIRED');
   const control=phase==='accept'?label:await s.one(s.page.getByRole('button',{name:'提交审核',exact:true}));if(phase==='submit'&&!await control.isEnabled())throw Error('PAGE_CONTRACT_CHANGED');
   await s.account({binding:g.binding,artistName:g.metadata.artistName});attempted.add(key);
   try{
    if(phase==='submit'||!await input.isChecked())await control.click({timeout:10000,noWaitAfter:true});
    if(phase==='accept'){const snapshot=await observe(c);if(snapshot.termsHash!==j.termsHash||!await input.isChecked())throw Error('ACCEPTANCE_READBACK_REQUIRED');return{status:'accepted',snapshot,scopeHash:j.scopeHash}}
    return{status:'reviewing',receipt:await readReceipt({...c,operations:[op]})};
   }catch{return{status:'unknown',reason:phase==='accept'?'ACCEPTANCE_OUTCOME_UNKNOWN':'SUBMISSION_OUTCOME_UNKNOWN'}}
  }finally{busy=false}
 }
 return{capability:s.capability,observe,accept:(c:any)=>run(c,'accept'),submit:(c:any)=>run(c,'submit'),readReceipt};
}
