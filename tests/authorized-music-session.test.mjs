import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {Studio,AuthorizedMusicSession}=require('../build/authorized-music-session.cjs');
function setup(submit=async()=>({state:'accepted',trackingId:'task-1',songIds:['song-a','song-b'],actualCost:null})){
 const root=path.resolve('output/test-runs/authorized-'+randomUUID()),s=new Studio(root,'production');
 let posts=0;
 const adapter={source:'external',capabilities:{provider:'yourmusic',version:'openapi-1.0.0',maximumOutputs:2,lookupByClientKey:false,automaticPaid:false},submit:async i=>{posts++;return submit(i)},query:async ids=>({state:'known',songs:ids.map(id=>({id,status:'succeeded',audio_url:'https://oss.yourmusic.fun/'+id,actualLyrics:{text:'实际歌词',version:null}}))}),download:async()=>({bytes:Buffer.from('native'),mime:'audio/mpeg'})};
 const session=new AuthorizedMusicSession(s,{adapter,ingest:async()=>({id:s.save('assets',{id:randomUUID(),kind:'audio',sha256:'a'.repeat(64)}).id})});
 const p={positiveStyle:'Mandarin warm acoustic pop, gentle male vocal',negativeStyle:'artist imitation',durationTarget:180,voiceArrangement:'male'};
 const draft={title:'便利店门口的晴天',topic:'雨后下班',storyBeat:'一起去便利店然后慢慢回家',language:'中文',style:'温柔流行',instrumental:false,sections:[{id:'v',kind:'Verse',lines:['下班后的风吹过街角','两杯热饮留住手心']},{id:'c',kind:'Chorus',lines:['雨停以后慢慢走','回家再绕一个圈']}],hook:{sectionId:'c',startLine:0,endLine:2},vocalPlan:[{sectionId:'v',voice:'male'},{sectionId:'c',voice:'male'}],musicPrompts:{suno:p,yourmusic:p},continuityNotes:'Codex 辅助原创'};
 const input={requestId:randomUUID(),profileId:randomUUID(),profileRevision:1,modelId:'chirp-v6',draft,submissionLimit:1,candidateLimit:2,creditPolicy:'existing-service-credits-no-topup',consent:true,authorizationRef:'用户明确要求生成新歌并授权本轮两首，不限已有积分；禁止充值'};
 return {s,session,input,posts:()=>posts,root};
}
test('staging is idempotent and binds exact song, profile, and authorization',()=>{const {s,session,input}=setup();const op=session.stage(input);assert.equal(op.state,'prepared');assert.equal(session.stage(input).id,op.id);assert.equal(s.all('works').length,1);assert.equal(s.all('works')[0].title,input.draft.title);assert.throws(()=>session.stage({...input,draft:{...input.draft,title:'changed'}}),/IDEMPOTENCY_CONFLICT/);assert.equal(op.costEstimate,null);s.repo.db.close()});
test('a paid dispatch is durable and cannot be repeated after an unknown result or restart',async()=>{const {s,session,input,posts,root}=setup(async()=>{throw Error('network lost')});const op=session.stage(input);await session.submit(input.requestId);assert.equal(session.context(input.requestId).operation.state,'unknown');await session.submit(input.requestId);assert.equal(posts(),1);assert.ok(fs.existsSync(path.join(root,'production/music-receipts',op.id,'dispatch.json')));s.repo.db.close()});
test('successful two candidates preserve native assets and actual lyrics on one new work',async()=>{const {s,session,input,posts}=setup();session.stage(input);await session.submit(input.requestId);await session.reconcile(input.requestId);const work=session.materialize(input.requestId);assert.equal(posts(),1);assert.ok(work.assets.audio_A);assert.ok(work.assets.audio_B);assert.equal(work.selectedAudioVariant,'A');assert.deepEqual(work.providerSongIds,['song-a','song-b']);assert.equal(work.audioVersions[0].actualLyrics.text,'实际歌词');assert.equal(s.all('works').length,1);s.repo.db.close()});
test('modified content cannot cross the durable authorization scope',async()=>{const {s,session,input,posts}=setup();const op=session.stage(input);const draft=s.get('drafts',op.draftId);s.save('drafts',{...draft,pair:{...draft.pair,lyrics:'tampered'}});await assert.rejects(()=>session.submit(input.requestId),/STALE_PAIR/);assert.equal(posts(),0);s.repo.db.close()});
test('extra outputs cannot be materialized as a normal two-candidate result',async()=>{const {s,session,input}=setup(async()=>({state:'accepted',trackingId:'task-1',songIds:['a','b','c'],actualCost:null}));session.stage(input);await session.submit(input.requestId);assert.throws(()=>session.materialize(input.requestId),/TWO_VERIFIED_AUDIO_REQUIRED/);s.repo.db.close()});
