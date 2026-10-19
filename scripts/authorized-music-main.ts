// Main-process acceptance runner: saved credentials are consumed only by the existing
// ApiCredentials adapter, directly from the read-only existing vault. No renderer or export.
import {app,safeStorage} from 'electron';
import fs from 'node:fs';import path from 'node:path';
import Database from 'better-sqlite3';
import {AuthorizedMusicSession,AuthorizedMusicInput,Studio} from '../src/core/authorized-music-session';
import {ApiCredentials} from '../src/main/api-credentials';
import {CredentialVault} from '../src/main/credentials';
import {nodeHttpsTransport,type MusicAdapter} from '../src/core/workflow/yourmusic';
import {apiProfileSchema} from '../src/shared/api-profiles';
import {acquireWorkspaceLease} from '../src/main/session-runtime';
const repo=path.resolve(__dirname,'..'),sessionRoot=path.join(repo,'output/new-song-convenience-20261018');
const installedPointer=JSON.parse(fs.readFileSync('C:/Users/CLOUD_USER/AppData/Local/RainfallStudioLauncher/verified-desktop.json','utf8'));
// Chromium's Windows encryption key is bound to this existing runtime. Reuse the
// crypto context directly; never copy its Local State or credential ciphertext.
app.setPath('userData',path.join(installedPointer.dataRoot,'runtime'));app.disableHardwareAcceleration();
const action=process.argv[2];
const allowed=new Set(['authcheck','stage','status','submit','poll','materialize','native-wav','attach-cover']);
let studio:Studio|undefined,lease:Awaited<ReturnType<typeof acquireWorkspaceLease>>|undefined;
function emit(value:unknown){process.stdout.write(JSON.stringify(value,null,2)+'\n')}
app.whenReady().then(async()=>{
 if(!allowed.has(action))throw Error('ACTION_REJECTED');
 const input=AuthorizedMusicInput.parse(JSON.parse(fs.readFileSync(path.join(sessionRoot,'request.json'),'utf8')));
 const pointer=installedPointer;
 const originalRoot=path.resolve(pointer.dataRoot),dataRoot=path.join(sessionRoot,'candidate-data');
 if(path.resolve(dataRoot)===originalRoot||!originalRoot.includes('rainfall-studio-tme-mvp'))throw Error('ISOLATION_REQUIRED');
 lease=await acquireWorkspaceLease(dataRoot);
 const loadProfile=async(id:string)=>{
  const db=new Database(path.join(originalRoot,'production/library.sqlite'),{readonly:true,fileMustExist:true});
  try{const row=db.prepare('SELECT data FROM settings WHERE id=?').get('api-profile:'+id) as {data:string}|undefined;
   if(!row)return undefined;return apiProfileSchema.parse({...JSON.parse(row.data),id});
  }finally{db.close()}
 };
 const vault=new CredentialVault(path.join(originalRoot,'credentials'),safeStorage);
 // Write/clear are deliberately unavailable in this acceptance process.
 const readonlyVault={isAvailable:()=>vault.isAvailable(),has:(binding:any)=>vault.has(binding),get:(binding:any)=>vault.get(binding),put:()=>{throw Error('READ_ONLY_VAULT')},delete:()=>{throw Error('READ_ONLY_VAULT')}} as unknown as CredentialVault;
 const credentials=new ApiCredentials({vault:readonlyVault,getProfile:loadProfile,context:()=>({mode:'production',generation:1}),connectionRequest:nodeHttpsTransport});
 const identity={profileId:input.profileId,expectedRevision:input.profileRevision};
 if(action==='authcheck'){
  const status=await credentials.apiCredentialStatus({profileId:input.profileId});
  const connection=status.configured?await credentials.checkApiConnection(identity):null;
  const result={at:new Date().toISOString(),action,configured:status.configured,credentialState:status.state,connection,modelId:input.modelId,paidGenerationRequested:false,credentialExported:false,encryptionAvailable:safeStorage.isEncryptionAvailable(),existingEncryptionContext:true};
  fs.writeFileSync(path.join(sessionRoot,'authcheck.json'),JSON.stringify(result,null,2));emit(result);return;
 }
 const profile=await loadProfile(input.profileId);if(!profile||profile.revision!==input.profileRevision||profile.providerId!=='yourmusic')throw Error('PROFILE_SCOPE_MISMATCH');
 studio=new Studio(dataRoot,'production');const s=studio;
 // Profile metadata only, retaining the actual configured revision. No credential copy.
 s.save('settings',{...profile,id:'api-profile:'+profile.id});
 const adapter:MusicAdapter={source:'external',capabilities:{provider:'yourmusic',version:'openapi-1.0.0',maximumOutputs:2,lookupByClientKey:false,automaticPaid:false},submit:request=>credentials.withMusicAdapter(identity,a=>a.submit(request)),query:ids=>credentials.withMusicAdapter(identity,a=>a.query(ids)),download:url=>credentials.withMusicAdapter(identity,a=>a.download(url))};
 const session=new AuthorizedMusicSession(s,{adapter,ingest:async(bytes,mime)=>{
  const ext:Record<string,string>={'audio/mpeg':'mp3','audio/mp3':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/flac':'flac','audio/ogg':'ogg','audio/mp4':'m4a'};
  if(!ext[mime])throw Error('AUDIO_MIME_REJECTED');const dir=path.join(sessionRoot,'native-downloads');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,Date.now()+'-'+Math.random().toString(16).slice(2)+'.'+ext[mime]);fs.writeFileSync(file,bytes,{flag:'wx'});
  return {id:String((await s.importFile(file,'audio_A')).id)};
 }});
 if(action==='native-wav'){
  const c=session.context(input.requestId),songId=c.operation.songIds[0],receipt=path.join(sessionRoot,'native-wav-A-result.json'),marker=path.join(sessionRoot,'native-wav-A-dispatch.json');
  if(c.operation.state!=='assets_verified'||songId!=='e59d6bd9-f5cd-4c11-a320-6169fbf3c358')throw Error('LIVE_SCOPE_MISMATCH');
  let result;if(fs.existsSync(receipt)){result=JSON.parse(fs.readFileSync(receipt,'utf8'))}else{
   fs.writeFileSync(marker,JSON.stringify({songId,at:new Date().toISOString(),noAutomaticRetry:true}),{flag:'wx'});
   result=await credentials.withMusicAdapter(identity,a=>a.nativeWav(songId));fs.writeFileSync(receipt,JSON.stringify(result,null,2));
  }
  const wavPath=path.join(sessionRoot,'A-provider.wav');
  if(!fs.existsSync(wavPath)){const audio=await credentials.withMusicAdapter(identity,a=>a.download(result.audio_wav_url));fs.writeFileSync(wavPath,audio.bytes,{flag:'wx'})}
  const asset=await s.importFile(wavPath,'audio_A'),work=s.get('works',c.work.id);
  s.save('works',{...work,assets:{...work.assets,audio_A:asset.id},assetHistory:[...new Set([...(work.assetHistory??[]),asset.id])],providerWav:{assetId:asset.id,providerSongId:songId,source:'provider-wav-endpoint',qualityImprovementVerified:false},audioVersions:work.audioVersions.map((v:any)=>v.providerSongId===songId?{...v,originalCompressedAssetId:v.assetId,assetId:asset.id}:v)});
  emit({at:new Date().toISOString(),action,file:wavPath,assetId:asset.id,bytes:asset.bytes,metadata:asset.metadata,qualityImprovementVerified:false});return;
 }
 if(action==='attach-cover'){
  const c=session.context(input.requestId),asset=await s.importFile(path.join(sessionRoot,'cover-source.png'),'cover',c.work.id);
  emit({at:new Date().toISOString(),action,workId:c.work.id,coverAssetId:asset.id,coverDimensions:{width:asset.metadata.width,height:asset.metadata.height}});return;
 }
 if(action==='stage')session.stage(input);
 else if(action==='submit'){
  const auth=JSON.parse(fs.readFileSync(path.join(sessionRoot,'authcheck.json'),'utf8'));
  if(auth.connection?.state!=='connected'||auth.connection.profileId!==input.profileId||Date.now()-Date.parse(auth.at)>3600000)throw Error('FRESH_AUTHENTICATION_REQUIRED');
  await session.submit(input.requestId);
 }else if(action==='poll')await session.reconcile(input.requestId);
 else if(action==='materialize')session.materialize(input.requestId);
 const c=session.context(input.requestId),result={at:new Date().toISOString(),action,dataRoot,requestId:input.requestId,title:c.work.title,workId:c.work.id,operationId:c.operation.id,state:c.operation.state,reasons:c.operation.reasons,providerTaskId:c.operation.trackingId??null,songIds:c.operation.songIds,costState:c.operation.costState,costEstimate:null,creditPolicy:input.creditPolicy,candidates:c.candidates.map(c=>({ordinal:c.ordinal,providerSongId:c.providerOutputId,state:c.state,assetId:c.assetId,metadata:c.providerMetadata,actualLyricsAvailable:Boolean(c.actualLyrics?.text)})),assets:c.work.assets,paidResubmissionAttempted:false,credentialExported:false};
 fs.writeFileSync(path.join(sessionRoot,'status.json'),JSON.stringify(result,null,2));emit(result);
}).catch(error=>{
 const code=error instanceof Error&&/^[A-Z][A-Z0-9_]{2,100}$/.test(error.message)?error.message:'AUTHORIZED_SESSION_FAILED';
 emit({at:new Date().toISOString(),action,error:code,noAutomaticPaidRetry:true});process.exitCode=1;
}).finally(async()=>{studio?.repo.db.close();await lease?.release();app.exit(process.exitCode??0)});
