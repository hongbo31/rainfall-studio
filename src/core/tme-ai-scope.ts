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

/** Local, current material resolution. This is not a grant or platform authorization. */
export function resolveTmeAiPrepareScope(s:Studio,input:{workId:string;createDerivative?:boolean}){
 const i=z.strictObject({workId:z.uuid(),createDerivative:z.boolean().optional()}).parse(input);
 if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
 const w=s.get('works',i.workId);
 if(w.ai&&!['generated','assisted'].includes(w.ai))throw Error('AI_PREPARATION_NOT_APPLICABLE');
 if(['把晚安留在门口','留一盏灯'].includes(w.title.normalize('NFKC').trim()))throw Error('PROTECTED_PUBLISHED_WORK');
 if(!w.assets?.audio_A)throw Error('SOURCE_AUDIO_A_REQUIRED');
 const audio=s.get('assets',w.assets.audio_A);
 if(audio.kind!=='audio')throw Error('SOURCE_AUDIO_SCOPE');
 const source=s.locate(audio.id).file;
 if(!w.assets?.cover)throw Error('COVER_ASSET_REQUIRED');
 const cover=s.get('assets',w.assets.cover);
 if(cover.kind!=='image')throw Error('COVER_ASSET_SCOPE');s.locate(cover.id);
 const f=w.publicationMetadata??w.metadata??{};
 if(w.isCover===true||f.isCover===true)throw Error('AI_COVER_UPLOAD_NOT_ALLOWED');
 // Read stored defaults only. Never initialize settings during inspection.
 let c=s.repo.maybe('settings','simple-publishing:platform:v1:qqmusic')?.value??s.repo.maybe('settings','simple-publishing:platform:v1:kugou')?.value??{};
 const tasks=s.all('settings').filter(r=>r.id.startsWith('unified-publication:v1:')&&r.value?.workId===w.id&&r.value.targets?.some((t:string)=>['qqmusic','kugou'].includes(t))&&!['reviewing','published','rejected'].includes(r.value.state));
 if(tasks.length){const target=tasks[0].value.targets.find((t:string)=>['qqmusic','kugou'].includes(t));c=s.repo.maybe('settings','simple-publishing:platform:v1:'+target)?.value??c;}
 const taskAccounts=[...new Set(tasks.map(r=>r.value.accountId).filter(Boolean))];
 const configuredAccounts=[...new Set(['qqmusic','kugou'].map(t=>s.repo.maybe('settings','simple-publishing:platform:v1:'+t)?.value?.accountId).filter(Boolean))];
 const accounts=taskAccounts.length?taskAccounts:configuredAccounts;
 if(accounts.length>1)throw Error('ACCOUNT_SCOPE_AMBIGUOUS');
 const accountId=accounts[0];
 if(accountId){const account=s.repo.maybe('accounts',accountId);if(!account||!['tme','qqmusic','kugou'].includes(account.provider))throw Error('TARGET_ACCOUNT_MISMATCH')}
 const artistId=w.artistId??c.artistId,artist=artistId?s.repo.maybe('artists',artistId):undefined;
 const text=(key:string,fallback?:unknown)=>typeof f[key]==='string'&&f[key].trim()?f[key]:typeof w[key]==='string'&&w[key].trim()?w[key]:fallback;
 const bool=(key:string,alias?:string)=>typeof f[key]==='boolean'?f[key]:alias&&typeof f[alias]==='boolean'?f[alias]:typeof w[key]==='boolean'?w[key]:undefined;
 const raw={title:w.title,albumTitle:text('albumTitle',text('album',c.album||w.title)),albumDescription:text('albumDescription'),artistName:text('artistName',artist?.name),lyricist:text('lyricist',c.lyricist),composer:text('composer',c.composer),ownLyrics:bool('ownLyrics','ownLyricist'),ownComposition:bool('ownComposition','ownComposer'),aiTool:text('aiTool'),generatedOn:text('generatedOn'),allowCover:bool('allowCover'),genre:text('genre',w.config?.genre||c.genre),language:text('language',w.config?.language||c.language),version:text('version','完整版'),releaseMode:text('releaseMode','审核通过即发布')};
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
 return{workId:w.id,...(accountId?{accountId}:{}),variant:'A' as const,prepareOnly:true,sourceAudio:{assetId:audio.id,sha256:audio.sha256,variant:'A' as const},upload:{path:uploadPath,sha256:uploadHash!,format:'pcm_wav' as const,derivedFromSha256:audio.sha256},cover:{assetId:cover.id,sha256:cover.sha256},lyricsHash:hash(lyrics),metadata};
}
