import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {CreativeDraftSchema} from '../shared/creation';
import {hashValue,pairHash} from './quality/scoring';
import {MusicService} from './workflow/music';
import type {MusicAdapter} from './workflow/yourmusic';
import {Studio} from './studio';
export {Studio};

export const AuthorizedMusicInput=z.strictObject({
 requestId:z.uuid(),profileId:z.uuid(),profileRevision:z.number().int().positive(),
 modelId:z.literal('chirp-v6'),draft:CreativeDraftSchema,
 submissionLimit:z.literal(1),candidateLimit:z.literal(2),
 creditPolicy:z.literal('existing-service-credits-no-topup'),consent:z.literal(true),
 authorizationRef:z.string().min(10).max(2000),
});
const grantKey=(id:string)=>'authorized-music:'+id;
// An internal reservation ceiling, never a provider price, balance, or cost estimate.
// This flow exists only for explicit authorization to consume existing service credits.
const reservationCeiling=1_000_000;
export class AuthorizedMusicSession {
 readonly music:MusicService;
 private approvedUrls=new Map<string,Set<string>>();
 constructor(readonly studio:Studio,readonly options:{adapter:MusicAdapter;ingest:(bytes:Buffer,mime:string)=>Promise<{id:string}>}){
  if(studio.mode!=='production'||options.adapter.source!=='external')throw Error('PRODUCTION_REQUIRED');
  const guarded:MusicAdapter={...options.adapter,
   submit:async request=>{
    const op=studio.get('operations',request.operationId),c=this.context(op.requestId);
    if(c.operation.id!==request.operationId||c.operation.state!=='dispatching'||hashValue(request.draft)!==hashValue(c.grant.input.draft)||request.modelId!==c.grant.input.modelId)throw Error('LIVE_SCOPE_MISMATCH');
    const dir=this.receipts(op.id);fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'dispatch.json'),JSON.stringify({operationId:op.id,requestId:op.requestId,at:studio.now().toISOString(),requestHash:c.grant.requestHash,modelId:request.modelId,submissionLimit:1,expectedOutputs:2,creditPolicy:c.grant.input.creditPolicy,costEstimate:null,automaticTopUp:false,automaticPaidRetry:false},null,2),{flag:'wx'});
    const result=await options.adapter.submit(request);
    fs.writeFileSync(path.join(dir,'submit-result.json'),JSON.stringify(result,null,2));return result;
   },
   query:async ids=>{
    const op=studio.all('operations').find(o=>o.kind==='music'&&JSON.stringify(o.songIds)===JSON.stringify(ids));
    if(!op)throw Error('LIVE_SCOPE_MISMATCH');this.context(op.requestId);
    const result=await options.adapter.query(ids);
    if(result.state==='known'&&result.songs.some((song:any)=>!ids.includes(song.id)))throw Error('OUTPUT_ID_MISMATCH');
    this.approvedUrls.set(op.id,new Set<string>(result.state==='known'?result.songs.map((song:any)=>song.audio_url).filter((url:unknown):url is string=>typeof url==='string'&&Boolean(url)):[]));
    const dir=this.receipts(op.id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'latest-query.json'),JSON.stringify(result,null,2));return result;
   },
   download:async url=>{
    if(![...this.approvedUrls.values()].some(urls=>urls.has(url)))throw Error('UNVERIFIED_AUDIO_URL');
    return options.adapter.download(url);
   },
  };
  this.music=new MusicService(studio.repo,'production',{now:studio.now,adapter:guarded,ingest:options.ingest,productionAuthorization:request=>{
   const grant=studio.repo.maybe('settings',grantKey(request.requestId));
   if(!grant||grant.input.profileId!==request.accountRef||grant.draftId!==request.draftId||grant.pairHash!==request.expectedPairHash||grant.input.modelId!==request.modelId||grant.input.consent!==true)return null;
   return {maxCredits:reservationCeiling};
  }});
 }
 receipts(operationId:string){return path.join(this.studio.root,'production','music-receipts',operationId)}
 stage(raw:unknown){
  const input=AuthorizedMusicInput.parse(raw),s=this.studio,requestHash=hashValue(input),prior=s.repo.maybe('settings',grantKey(input.requestId));
  if(prior){if(prior.requestHash!==requestHash)throw Error('IDEMPOTENCY_CONFLICT');return this.context(input.requestId).operation}
  if(input.draft.instrumental||input.draft.musicPrompts.yourmusic.voiceArrangement==='duet'||input.draft.musicPrompts.yourmusic.voiceArrangement==='ensemble')throw Error('SINGLE_VOCAL_REQUIRED');
  if(['把晚安留在门口','留一盏灯'].includes(input.draft.title.trim()))throw Error('PUBLISHED_WORK_PROTECTED');
  if(s.all('works').some(work=>work.title===input.draft.title))throw Error('EXISTING_TITLE_REQUIRES_REVIEW');
  const artist=s.all('artists')[0];if(!artist)throw Error('ARTIST_REQUIRED');
  return s.repo.transaction(()=>{
   const d=input.draft,id=randomUUID(),lyrics=d.sections.map(section=>`[${section.kind}]\n${section.lines.join('\n')}`).join('\n\n');
   const pair={attemptId:input.requestId,revisionId:id,parentRevisionId:null,lyrics,musicPrompt:d.musicPrompts.yourmusic.positiveStyle,intent:d.storyBeat,language:d.language,style:d.style,generator:{modelId:'codex-assisted-original',modelVersion:'2026-10-18',promptVersion:'authorized-original-v1'},lockedSpans:[],capability:{version:'openapi-1.0.0',verified:true,lengthUnit:'codepoint' as const,limits:{lyrics:5000,musicPrompt:1000},requiredFields:['lyrics','musicPrompt'] as any}};
   const work=s.saveWork({title:d.title,artistId:artist.id,lyrics,story:d.storyBeat,prompt:pair.musicPrompt,parameters:{genre:d.style,language:d.language,voice:d.musicPrompts.yourmusic.voiceArrangement,duration:d.musicPrompts.yourmusic.durationTarget,model:input.modelId,is_max_mode:false},rights:'Codex 辅助原创歌词；AI 生成音频。供应商授权依据和发行权利事实须逐项核对。',ai:'assisted',source:'user-authorized-original'});
   s.save('drafts',{id,turnId:input.requestId,sessionId:input.requestId,artistId:artist.id,seriesId:null,seriesBaseRevision:0,source:'user-authorized-original',draft:d,pair,pairHash:pairHash(pair),at:s.now().toISOString(),workId:work.id});
   const grant={id:grantKey(input.requestId),input,requestHash,draftId:id,pairHash:pairHash(pair),workId:work.id,approvedAt:s.now().toISOString()};s.save('settings',grant);
   const op=this.music.prepare({requestId:input.requestId,draftId:id,expectedPairHash:grant.pairHash,accountRef:input.profileId,modelId:input.modelId,candidateLimit:2,budgetLimit:reservationCeiling});
   const marked=s.save('operations',{...op,costEstimate:null,reservationMeaning:'internal-ceiling-not-provider-quote',creditPolicy:input.creditPolicy});
   s.save('settings',{...grant,operationId:op.id});s.repo.audit('music.authorized.staged',op.id,{submissionLimit:1,candidateLimit:2,creditPolicy:input.creditPolicy,costEstimate:null});return marked;
  });
 }
 context(requestId:string){
  const s=this.studio,grant=s.get('settings',grantKey(requestId)),op=s.get('operations',grant.operationId),draft=s.get('drafts',grant.draftId);
  if(hashValue(grant.input)!==grant.requestHash||op.requestId!==requestId||op.draftId!==draft.id||op.expectedPairHash!==grant.pairHash||op.accountRef!==grant.input.profileId||op.modelId!==grant.input.modelId)throw Error('LIVE_SCOPE_MISMATCH');
  if(pairHash(draft.pair)!==grant.pairHash||hashValue(draft.draft)!==hashValue(grant.input.draft))throw Error('STALE_PAIR');
  return {grant,operation:op,draft,candidates:s.all('candidates').filter(c=>c.operationId===op.id),work:s.get('works',grant.workId)};
 }
 async submit(requestId:string){const c=this.context(requestId);return this.music.submit(c.operation.id)}
 async reconcile(requestId:string){const c=this.context(requestId);return this.music.reconcile(c.operation.id)}
 materialize(requestId:string){
  const s=this.studio,c=this.context(requestId),ready=c.candidates.filter(c=>c.state==='ready'&&c.assetId).sort((a,b)=>a.ordinal-b.ordinal);
  if(c.operation.overrun||c.operation.songIds.length!==2||new Set(c.operation.songIds).size!==2||ready.length!==2||ready.some((candidate,index)=>candidate.providerOutputId!==c.operation.songIds[index]))throw Error('TWO_VERIFIED_AUDIO_REQUIRED');
  const work={...c.work,assets:{...c.work.assets,audio_A:ready[0].assetId,audio_B:ready[1].assetId},assetHistory:[...new Set([...(c.work.assetHistory??[]),...ready.map(x=>x.assetId)])],selectedAudioVariant:'A',source:'external',provider:'yourmusic',providerTaskId:c.operation.trackingId,providerSongIds:c.operation.songIds,generationOperationId:c.operation.id,model:'chirp-v6',audioVersions:ready.map(x=>({candidateId:x.id,providerSongId:x.providerOutputId,assetId:x.assetId,providerMetadata:x.providerMetadata,submittedLyrics:x.submittedLyrics,actualLyrics:x.actualLyrics})),lyricsConfirmation:null};
  s.save('works',work);s.repo.audit('music.authorized.imported',c.work.id,{operationId:c.operation.id,selectedVariant:'A',nativeProviderFiles:true});return work;
 }
}
