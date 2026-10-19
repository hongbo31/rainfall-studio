import {randomUUID} from 'node:crypto';
import {LiveMusicInput,liveMusicGrantKey} from '../shared/live-music';
import {parseDraft} from '../shared/creation';
import {hashValue,pairHash} from './quality/scoring';
import type {Studio} from './studio';
export function stageLiveMusic(s:Studio,raw:unknown){
 if(s.mode!=='production')throw Error('PRODUCTION_REQUIRED');
 const input=LiveMusicInput.parse(raw),prior=s.repo.maybe('settings',liveMusicGrantKey);
 if(prior){if(prior.requestHash!==hashValue(input))throw Error('ONE_SHOT_ALREADY_STAGED');return s.get('operations',prior.operationId)}
 const artist=s.all('artists')[0];if(!artist)throw Error('ARTIST_REQUIRED');
 const sections=input.lyrics.trim().split(/\n\s*(?=\[[^\]\n]+\]\s*\n)/).map((block,index)=>{const lines=block.trim().split('\n'),heading=lines.shift()!;if(!/^\[[^\]]+\]$/.test(heading))throw Error('SECTION_LABEL_REQUIRED');return{id:'section-'+index,kind:heading.slice(1,-1),lines}});
 const hook=sections.find(x=>/^Chorus/i.test(x.kind));if(!hook||!sections.some(x=>/Verse/i.test(x.kind))||!sections.some(x=>/Bridge/i.test(x.kind)))throw Error('COMPLETE_LYRICS_REQUIRED');
 const p={positiveStyle:input.style,negativeStyle:'artist imitation, rap, aggressive distortion, heavy metal, choir, muddy vocals',durationTarget:input.duration,voiceArrangement:'male'};
 const draft=parseDraft({title:'示例作品A',topic:'关系系列第4首：日常甜蜜',storyBeat:'下班回家，留灯，一起吃晚饭，把平常陪伴写成对以后的期待。',language:'中文',style:'温柔恋爱流行',instrumental:false,sections,hook:{sectionId:hook.id,startLine:0,endLine:hook.lines.length},vocalPlan:sections.map(x=>({sectionId:x.id,voice:'male'})),musicPrompts:{suno:p,yourmusic:p},continuityNotes:'相识、熟悉、告白之后的日常陪伴；第4首。未修改原有系列的已确认章节。'});
 const id=randomUUID(),pair={attemptId:input.requestId,revisionId:id,parentRevisionId:null,lyrics:input.lyrics.trim(),musicPrompt:input.style,intent:draft.storyBeat,language:draft.language,style:draft.style,generator:{modelId:'codex-assisted-original',modelVersion:'2026-10-16',promptVersion:'leave-a-light-1'},lockedSpans:[],capability:{version:'openapi-1.0.0',verified:true,lengthUnit:'codepoint' as const,limits:{lyrics:5000,musicPrompt:1000},requiredFields:['lyrics','musicPrompt','intent','language','style'] as any}};
 return s.repo.transaction(()=>{
  const work=s.saveWork({title:draft.title,artistId:artist.id,lyrics:pair.lyrics,story:draft.storyBeat,prompt:input.style,parameters:{genre:draft.style,language:'中文',voice:'male',bpm:88,duration:input.duration,model:'chirp-v6',is_max_mode:false},rights:'本次原创歌词；AI 音频授权依供应商及账号条款待确认',ai:'assisted'});
  const row={id,turnId:input.requestId,sessionId:input.requestId,artistId:artist.id,seriesId:null,seriesBaseRevision:0,source:'user-authorized-original',draft,pair,pairHash:pairHash(pair),at:s.now().toISOString(),workId:work.id};s.save('drafts',row);
  const grant={id:liveMusicGrantKey,...input,requestHash:hashValue(input),draftId:id,pairHash:row.pairHash,accountRef:input.profileId,modelId:'chirp-v6',approvedAt:s.now().toISOString(),workId:work.id};s.save('settings',grant);
  const op=s.musicService().prepare({requestId:input.requestId,draftId:id,expectedPairHash:row.pairHash,accountRef:input.profileId,modelId:'chirp-v6',candidateLimit:2,budgetLimit:385});s.save('settings',{...grant,operationId:op.id});s.repo.audit('music.live.staged',op.id,{creditCap:385,submissionLimit:1,isMaxMode:false});return op;
 });
}
export function liveMusicContext(s:Studio,id?:string){
 const grant=s.repo.maybe('settings',liveMusicGrantKey);if(!grant)return null;
 const op=s.repo.maybe('operations',id??grant.operationId);if(!op||op.id!==grant.operationId||op.requestId!==grant.requestId||op.draftId!==grant.draftId||op.accountRef!==grant.profileId||op.modelId!=='chirp-v6'||op.expectedPairHash!==grant.pairHash)throw Error('LIVE_SCOPE_MISMATCH');
 const draft=s.get('drafts',op.draftId);if(pairHash(draft.pair)!==grant.pairHash)throw Error('STALE_PAIR');
 return{grant,operation:op,draft,candidates:s.all('candidates').filter(c=>c.operationId===op.id),work:s.get('works',grant.workId)};
}
export function materializeLiveMusic(s:Studio){
 const c=liveMusicContext(s);if(!c)throw Error('LIVE_ATTEMPT_REQUIRED');
 const ready=c.candidates.filter(x=>x.state==='ready'&&x.assetId).sort((a,b)=>a.ordinal-b.ordinal);
 if(ready.length!==2||c.operation.songIds.length!==2)throw Error('TWO_VERIFIED_AUDIO_REQUIRED');
 const slots={...c.work.assets,audio_A:ready[0].assetId,audio_B:ready[1].assetId};
 const work={...c.work,assets:slots,assetHistory:[...new Set([...(c.work.assetHistory??[]),...ready.map(x=>x.assetId)])],source:'external',provider:'yourmusic',providerTaskId:c.operation.trackingId,providerSongIds:c.operation.songIds,generationOperationId:c.operation.id,model:'chirp-v6',audioVersions:ready.map(x=>({candidateId:x.id,providerSongId:x.providerOutputId,assetId:x.assetId,providerMetadata:x.providerMetadata,submittedLyrics:x.submittedLyrics,actualLyrics:x.actualLyrics})),parameters:{...c.work.parameters,is_max_mode:false}};
 s.save('works',work);s.repo.audit('music.live.imported',c.work.id,{operationId:c.operation.id});return work;
}
