import {assertWorkIdentityWrite} from './plan-identity';
import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import type {Studio} from './studio';
import type {Row} from './database';
import {hash} from './database';
import {digest} from './assets';
import {inspectPcmWav} from '../shared/pcm-wav';
import {cleanLyricText} from '../shared/tme-lyrics';
import {TmeAiPrepareMetadataSchema} from '../shared/tme-ai-prepare';
import type {PlanAlbumBinding} from '../shared/plan-albums';
import {CenterStore} from './plan-center/storage';
import {planPublicationMaterialFingerprint} from './plan-center-publication';

/** Rechecked at each new Core write claim; read-only inspection and original receipts do not call this gate. */
export function verifyPlanTmeAppendWrite(s:Studio,grant:{workId:string;publicationTaskId?:string;accountId?:string;identity:{subjectHash:string};existingAlbum?:{albumId?:string;bindingId?:string}},prepareJobId?:string){
 assertWorkIdentityWrite(s,grant);
 const links=s.all('settings').filter(r=>r.id.startsWith('plan-publication:v1:')).map(r=>r.value).filter(l=>l.workId===grant.workId&&(!grant.publicationTaskId||l.publicationTaskId===grant.publicationTaskId));
 if(!links.length)return; // Existing standalone/legacy queue intents have no PlanCenter owner.
 if(!grant.publicationTaskId||!grant.accountId||typeof s.planAlbumService!=='function')throw Error('ALBUM_APPEND_TASK_SCOPE');
 const task=s.repo.maybe('settings','unified-publication:v1:'+grant.publicationTaskId)?.value;
 if(!task||task.workId!==grant.workId||task.accountId!==grant.accountId||s.repo.maybe('accounts',grant.accountId)?.remoteSubject!==grant.identity.subjectHash)throw Error('ALBUM_APPEND_TASK_SCOPE');
 const store=new CenterStore(s.repo),service=s.planAlbumService();
 for(const platform of task.targets.filter((target:string)=>['qqmusic','kugou'].includes(target))){
  const matches=links.filter(l=>l.platform===platform&&l.accountId===grant.accountId&&l.publicationTaskId===task.id);if(matches.length!==1)throw Error('ALBUM_APPEND_TASK_SCOPE');
  const link=matches[0],run=store.get('run',link.runId);if(!run)throw Error('ALBUM_APPEND_RUN_SCOPE');
  if(run.stopRequested||['stopping','stopped','failed','completed'].includes(run.state))throw Error('STOP_REQUESTED');
  const plan=store.get('plan',run.planId);if(!plan||plan.revision!==run.planRevision)throw Error('PLAN_REVISION_CHANGED');
  const op=service.status().operations.find(o=>o.kind==='append'&&o.runId===run.id&&o.publicationTaskId===task.id&&o.scope.accountId===grant.accountId&&o.scope.accountFingerprint===grant.identity.subjectHash&&(['qqmusic','kugou'].includes(o.scope.platform)));
  if(!op||op.state!=='dispatching'||!op.authorizationHash)throw Error('ALBUM_APPEND_NOT_CLAIMED');
  const item=store.get('item',op.itemId!);if(!item||item.runId!==run.id||item.workId!==task.workId||link.itemId!==item.id||link.albumOperationId&&link.albumOperationId!==op.id)throw Error('ALBUM_APPEND_ITEM_SCOPE');
  const bound=service.bindingForRun({runId:run.id,platform,accountId:grant.accountId});
  if(!bound||link.albumBindingId!==bound.id||bound.albumId!==op.albumId||grant.existingAlbum?.albumId!==bound.albumId||bound.scope.accountFingerprint!==grant.identity.subjectHash)throw Error('ALBUM_APPEND_BINDING_SCOPE');
  if(op.prepareJobId&&op.prepareJobId!==prepareJobId||task.prepareJobId&&prepareJobId&&task.prepareJobId!==prepareJobId)throw Error('ALBUM_APPEND_PREPARATION_SCOPE');
  if(planPublicationMaterialFingerprint(s,run,item)!==op.materialFingerprint)throw Error('ALBUM_APPEND_MATERIALS_CHANGED');
  if(service.preview({operationId:op.id}).summaryHash!==op.authorizationHash)throw Error('ALBUM_APPEND_AUTHORIZATION_STALE');
 }
}

/** Resolve every TME target of this exact task. This overlay is never saved to Work/defaults. */
export function resolvePlanTmeAlbumBinding(s:Studio,tasks:Row[],accountId?:string){
 const links=s.all('settings').filter(r=>r.id.startsWith('plan-publication:v1:')).map(r=>r.value);
 const bindings:PlanAlbumBinding[]=[];
 for(const row of tasks){
  const task=row.value,taskLinks=links.filter(l=>l.publicationTaskId===task.id);
  if(!taskLinks.length)continue;
  if(typeof s.planAlbumService!=='function')throw Error('ALBUM_NOT_BOUND');
  if(!accountId||task.accountId!==accountId)throw Error('ALBUM_ACCOUNT_SCOPE_CHANGED');
  for(const platform of task.targets.filter((t:string)=>['qqmusic','kugou'].includes(t))){
   const matching:Row[]=taskLinks.filter(l=>l.platform===platform&&l.accountId===accountId&&l.workId===task.workId);
   if(matching.length!==1)throw Error('ALBUM_NOT_BOUND');
   const link:Row=matching[0],binding:PlanAlbumBinding|null=s.planAlbumService().bindingForRun({runId:link.runId,platform,accountId});
   if(!binding?.albumId||!binding.title)throw Error('ALBUM_NOT_BOUND');
   if(binding.scope.platform!==platform||binding.scope.accountId!==accountId||binding.scope.accountFingerprint!==s.repo.maybe('accounts',accountId)?.remoteSubject)throw Error('ALBUM_ACCOUNT_SCOPE_CHANGED');
   if(link.albumBindingId&&link.albumBindingId!==binding.id)throw Error('ALBUM_BINDING_CHANGED');
   bindings.push(binding);
  }
 }
 if(bindings.some(b=>b.albumId!==bindings[0].albumId||b.title!==bindings[0].title||b.scope.accountFingerprint!==bindings[0].scope.accountFingerprint))throw Error('ALBUM_FAMILY_BINDING_CONFLICT');
 return bindings[0];
}

/** Local, current material resolution. This is not a grant or platform authorization. */
export const TmeAiScopeInputSchema=z.strictObject({workId:z.uuid(),publicationTaskId:z.uuid().optional(),accountId:z.uuid().optional(),createDerivative:z.boolean().optional()});
export function resolveTmeAiPrepareScope(s:Studio,input:z.input<typeof TmeAiScopeInputSchema>){
 const i=TmeAiScopeInputSchema.parse(input);
 if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
 const w=s.get('works',i.workId);
 if(w.ai&&!['generated','assisted'].includes(w.ai))throw Error('AI_PREPARATION_NOT_APPLICABLE');
 if(['把晚安留在门口','留一盏灯'].includes(w.title.normalize('NFKC').trim()))throw Error('PROTECTED_PUBLISHED_WORK');
 const variant=w.selectedAudioVariant==='B'?'B':'A',slot=variant==='B'?'audio_B':'audio_A';
 if(!w.assets?.[slot])throw Error('SOURCE_AUDIO_A_REQUIRED');
 const audio=s.get('assets',w.assets[slot]);
 if(audio.kind!=='audio')throw Error('SOURCE_AUDIO_SCOPE');
 const source=s.locate(audio.id).file;
 if(!w.assets?.cover)throw Error('COVER_ASSET_REQUIRED');
 const cover=s.get('assets',w.assets.cover);
 if(cover.kind!=='image')throw Error('COVER_ASSET_SCOPE');s.locate(cover.id);
 const f=w.publicationMetadata??w.metadata??{};
 if(w.isCover===true||f.isCover===true)throw Error('AI_COVER_UPLOAD_NOT_ALLOWED');
 // Read stored defaults only. Never initialize settings during inspection.
 let c=s.repo.maybe('settings','simple-publishing:platform:v1:qqmusic')?.value??s.repo.maybe('settings','simple-publishing:platform:v1:kugou')?.value??{};
 let tasks=s.all('settings').filter(r=>r.id.startsWith('unified-publication:v1:')&&r.value?.workId===w.id&&r.value.targets?.some((t:string)=>['qqmusic','kugou'].includes(t))&&!['reviewing','published','rejected'].includes(r.value.state));
 if(i.publicationTaskId){
  const selected=s.repo.maybe('settings','unified-publication:v1:'+i.publicationTaskId)?.value;
  if(!selected||selected.workId!==w.id||!selected.targets?.some((t:string)=>['qqmusic','kugou'].includes(t)))throw Error('PUBLICATION_TASK_SCOPE');
  if(!i.accountId||selected.accountId!==i.accountId)throw Error('PREPARATION_ACCOUNT_SCOPE');
  if(['reviewing','published','rejected'].includes(selected.state)||selected.reason==='PROTECTED_PUBLISHED_WORK')throw Error('PUBLICATION_RECONCILIATION_REQUIRED');
  tasks=[{id:'unified-publication:v1:'+selected.id,value:selected}];
 }else if(i.accountId){tasks=tasks.filter(r=>r.value.accountId===i.accountId);if(!tasks.length)throw Error('PREPARATION_ACCOUNT_SCOPE');}
 if(tasks.length){const target=tasks[0].value.targets.find((t:string)=>['qqmusic','kugou'].includes(t));c=s.repo.maybe('settings','simple-publishing:platform:v1:'+target)?.value??c;}
 const taskAccounts=[...new Set(tasks.map(r=>r.value.accountId).filter(Boolean))];
 const configuredAccounts=[...new Set(['qqmusic','kugou'].map(t=>s.repo.maybe('settings','simple-publishing:platform:v1:'+t)?.value?.accountId).filter(Boolean))];
 const accounts=taskAccounts.length?taskAccounts:configuredAccounts;
 if(accounts.length>1)throw Error('ACCOUNT_SCOPE_AMBIGUOUS');
 const accountId=accounts[0];if(i.accountId&&accountId!==i.accountId)throw Error('PREPARATION_ACCOUNT_SCOPE');
 if(accountId){const account=s.repo.maybe('accounts',accountId);if(!account||!['tme','qqmusic','kugou'].includes(account.provider))throw Error('TARGET_ACCOUNT_MISMATCH')}
 const albumBinding=resolvePlanTmeAlbumBinding(s,tasks,accountId);
 const artistId=w.artistId??c.artistId,artist=artistId?s.repo.maybe('artists',artistId):undefined;
 const text=(key:string,fallback?:unknown)=>typeof f[key]==='string'&&f[key].trim()?f[key]:typeof w[key]==='string'&&w[key].trim()?w[key]:fallback;
 const bool=(key:string,alias?:string)=>typeof f[key]==='boolean'?f[key]:alias&&typeof f[alias]==='boolean'?f[alias]:typeof w[key]==='boolean'?w[key]:undefined;
 const raw={title:w.title,...(text('albumMode')?{albumMode:text('albumMode')}:{}),albumTitle:text('albumTitle',text('album',c.album||w.title)),albumDescription:text('albumDescription'),artistName:text('artistName',artist?.name),lyricist:text('lyricist',c.lyricist),composer:text('composer',c.composer),ownLyrics:bool('ownLyrics','ownLyricist'),ownComposition:bool('ownComposition','ownComposer'),aiTool:text('aiTool'),generatedOn:text('generatedOn'),allowCover:bool('allowCover'),genre:text('genre',w.config?.genre||c.genre),language:text('language',w.config?.language||c.language),version:text('version','完整版'),releaseMode:text('releaseMode','审核通过即发布')};
 if(albumBinding)Object.assign(raw,{albumMode:'existing',albumTitle:albumBinding.title});
 const parsed=TmeAiPrepareMetadataSchema.safeParse(raw),missing=parsed.success?[]:parsed.error.issues.map(issue=>String(issue.path[0]));
 if(typeof raw.generatedOn==='string'&&raw.generatedOn>s.now().toISOString().slice(0,10))missing.push('generatedOn');
 if(missing.length)throw Object.assign(Error('TME_AI_METADATA_REQUIRED:'+ [...new Set(missing)].join(',')),{code:'TME_AI_METADATA_REQUIRED'});
 const metadata=TmeAiPrepareMetadataSchema.parse(raw);
 if(metadata.version!=='完整版'||metadata.releaseMode!=='审核通过即发布')throw Error('UNSUPPORTED_METADATA_CHOICE');
 const lyrics=cleanLyricText(w.lyrics??'').cleaned;if(!lyrics.trim())throw Error('LYRICS_REQUIRED');
 const attached=new Set([...(w.assetHistory??[]),...(w.audioVersions??[]).map((v:Row)=>v.assetId)]);
 let uploadPath:string|undefined,uploadHash:string|undefined;
 for(const a of s.all('assets').filter(a=>attached.has(a.id)&&a.id!==audio.id&&a.kind==='audio'&&(a.parentId===audio.id||a.sourceAudioAssetId===audio.id||a.derivedFromSha256===audio.sha256))){
  const file=s.locate(a.id).file;
  if(fs.realpathSync(file)===fs.realpathSync(source))continue;
  try{inspectPcmWav(file)}catch{continue}
  uploadPath=file;uploadHash=a.sha256;break;
 }
 if(!uploadPath){
  // Only a byte-for-byte copy of already valid PCM is supported here; no encoding/network.
  inspectPcmWav(source);
  const dir=path.join(s.root,'prepared','tme-ai',w.id),file=path.join(dir,audio.sha256+'.wav');
  const check=()=>{if(fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile()||fs.realpathSync(file)===fs.realpathSync(source)||digest(file)!==audio.sha256)throw Error('UPLOAD_PATH_SCOPE');inspectPcmWav(file)};
  if(fs.existsSync(file))check();
  else if(i.createDerivative){
   // Refuse symlinked output ancestors before writing local material.
   for(let p=dir;p!==path.dirname(p);p=path.dirname(p))if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('UPLOAD_PATH_SCOPE');
   fs.mkdirSync(dir,{recursive:true});fs.copyFileSync(source,file,fs.constants.COPYFILE_EXCL);check();
  }
  uploadPath=file;uploadHash=audio.sha256;
 }
 return{workId:w.id,...(i.publicationTaskId?{publicationTaskId:i.publicationTaskId}:{}),...(accountId?{accountId}:{}),variant,prepareOnly:true,sourceAudio:{assetId:audio.id,sha256:audio.sha256,variant},upload:{path:uploadPath,sha256:uploadHash!,format:'pcm_wav' as const,derivedFromSha256:audio.sha256},cover:{assetId:cover.id,sha256:cover.sha256},lyricsHash:hash(lyrics),metadata,...(metadata.albumMode==='existing'?{existingAlbum:{title:metadata.albumTitle,...(albumBinding?{albumId:albumBinding.albumId,bindingId:albumBinding.id}:{})}}:{})};
}
