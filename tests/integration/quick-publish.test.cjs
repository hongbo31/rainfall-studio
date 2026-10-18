const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), {randomUUID} = require('node:crypto');
const sharp = require('sharp');
const {Studio, resolveQuickPublish, materialEntries} = require('../../build/core.cjs');
async function fixture(mode='simulation', pair=false) {
  const root=path.resolve('output/test-runs',randomUUID()), s=new Studio(root,mode);
  const artist=await s.call('artist.save',{name:'隔离发布测试',defaults:{genre:'流行',language:'中文',voice:'female',lyricTone:'叙事',mood:'温柔',bpmMin:70,bpmMax:90,duration:180,coverStyle:'雨夜'}});
  let work=await s.call('work.save',{title:'原创测试曲',artistId:artist.id,story:'测试',lyrics:'窗前示例作品A',prompt:'本地',parameters:{},rights:'隔离原创测试素材',ai:'none'});
  const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
  for(let i=44;i<wav.length;i+=2)wav.writeInt16LE(Math.round(Math.sin(i/5)*1000),i);
  const file=path.join(root,'audio.wav');fs.writeFileSync(file,wav);await s.importFile(file,'audio_A',work.id);
  if(pair){wav[100]^=1;fs.writeFileSync(file,wav);await s.importFile(file,'audio_B',work.id);}
  const cover=path.join(root,'cover.png');await sharp({create:{width:32,height:32,channels:4,background:'#805a9e'}}).png().toFile(cover);await s.importFile(cover,'cover',work.id);
  const account=await s.call('account.save',{provider:'netease',name:'唯一账号',dailyLimit:10});
  const binding=await s.call('binding.save',{artistId:artist.id,accountId:account.id,targets:['netease']});
  work=s.get('works',work.id);
  const input={workIds:[work.id],targets:['netease'],recordings:[{workId:work.id,slot:'audio_A'}],accountOverrides:{}};
  return {s,root,artist,work,account,binding,input};
}
const view=s=>({mode:s.mode,works:s.all('works'),accounts:s.all('accounts'),bindings:s.all('bindings')});
test('quick defaults choose only a unique eligible artist/account binding; expired and ambiguous require inline choice',async()=>{
 const f=await fixture();try{
  let p=resolveQuickPublish(view(f.s),f.input);assert.equal(p.issues.length,0);assert.equal(p.destinations[0].accountId,f.account.id);
  const second=await f.s.call('account.save',{provider:'netease',name:'另一账号',dailyLimit:10});await f.s.call('binding.save',{artistId:f.artist.id,accountId:second.id,targets:['netease']});
  p=resolveQuickPublish(view(f.s),f.input);assert.ok(p.issues.some(x=>x.includes('多个')));
  p=resolveQuickPublish(view(f.s),{...f.input,accountOverrides:{netease:f.account.id}});assert.equal(p.issues.length,0);
  f.s.save('accounts',{...f.account,authStatus:'reauth_required'});
  p=resolveQuickPublish(view(f.s),{...f.input,accountOverrides:{netease:f.account.id}});assert.ok(p.issues.some(x=>x.includes('授权')));assert.equal(p.destinations.length,0);
 }finally{f.s.close();}
});
test('paired audio needs explicit scope; B payload and fingerprints use B without modifying library A/B',async()=>{
 const f=await fixture('simulation',true);try{
  await assert.rejects(f.s.call('publish.quick',{...f.input,recordings:[]}),/录音/);assert.equal(f.s.all('batches').length,0);
  const selected=[{workId:f.work.id,slot:'audio_A'},{workId:f.work.id,slot:'audio_B'}];
  const lyric=await f.s.call('lyrics.preview',{workId:f.work.id});
  await f.s.call('lyrics.confirm',{workId:f.work.id,versionId:lyric.versionId,plainHash:lyric.plainHash,audioHash:lyric.audioHash,confirmed:true});
  assert.equal((await f.s.call('lyrics.preview',{workId:f.work.id})).alignmentConfirmed,true);
  const result=await f.s.call('publish.quick',{...f.input,recordings:selected});const units=f.s.all('units').filter(u=>u.batchId===result.batch.id);
  assert.equal(units.length,2);assert.equal(new Set(units.map(u=>u.fingerprint)).size,2);
  const b=units.find(u=>u.recordingSlot==='audio_B');assert.equal(b.payload.audio.assetId,f.work.assets.audio_B);assert.equal(b.snapshot.assets.audio_A,f.work.assets.audio_B);assert.equal(b.payload.lyrics.alignmentConfirmed,false);
  assert.equal(units.find(u=>u.recordingSlot==='audio_A').payload.lyrics.alignmentConfirmed,true);
  assert.ok(units.every(u=>!u.snapshot.assets.audio_B));
  const files=materialEntries(f.s,result.batch.id),manifest=JSON.parse(files.find(f=>f.name==='manifest.json').text);assert.deepEqual(new Set(manifest.units.map(u=>u.recordingSlot)),new Set(['audio_A','audio_B']));
  assert.deepEqual(f.s.get('works',f.work.id).assets,f.work.assets);
  const again=await f.s.call('publish.quick',{...f.input,recordings:[...selected].reverse()});assert.equal(again.batch.id,result.batch.id);assert.equal(f.s.all('units').length,2);assert.equal(again.started,false);
 }finally{f.s.close();}
});
test('changed metadata cannot bypass a claimed recording or silently start the other recording',async()=>{
 const f=await fixture('simulation',true);try{
  const first=await f.s.call('publish.quick',f.input);
  for(let i=0;i<7;i++)await f.s.tick();
  const old=f.s.all('units').find(u=>u.batchId===first.batch.id);assert.equal(old.commitCount,1);
  f.s.save('works',{...f.s.get('works',f.work.id),revision:f.work.revision+1,title:'更名仍是同录音'});
  const r=await f.s.call('publish.quick',{...f.input,recordings:[...f.input.recordings,{workId:f.work.id,slot:'audio_B'}]});assert.equal(r.started,false);
  const units=f.s.all('units').filter(u=>u.batchId===r.batch.id);assert.equal(units.find(u=>u.recordingSlot==='audio_A').state,'BLOCKED');assert.equal(units.find(u=>u.recordingSlot==='audio_B').state,'READY');assert.equal(r.batch.approved,false);
  assert.equal(f.s.get('units',old.id).commitCount,1);
 }finally{f.s.close();}
});
test('single action starts only ready simulation and preserves separate unknown review/live state',async()=>{
 const f=await fixture();try{
  const r=await f.s.call('publish.quick',f.input);assert.equal(r.started,true);assert.equal(r.batch.state,'RUNNING');
  const u=f.s.all('units').find(u=>u.batchId===r.batch.id);assert.equal(u.commitCount,0);assert.equal(u.review,'unknown');assert.equal(u.publication,'unknown');
  f.s.save('units',{...u,state:'SUBMISSION_UNKNOWN',remoteOutcome:'unknown'});
  assert.equal((await f.s.call('publish.quick',f.input)).started,false);assert.equal(f.s.get('units',u.id).state,'SUBMISSION_UNKNOWN');
 }finally{f.s.close();}
});
test('pending rights anywhere blocks simulation and does not silently start partial batches',async()=>{
 const f=await fixture();try{
  f.s.save('works',{...f.work,rights:'原创歌词；AI音频商业授权待确认'});
  const r=await f.s.call('publish.quick',f.input);assert.equal(r.started,false);const u=f.s.all('units').find(u=>u.batchId===r.batch.id);assert.equal(u.state,'BLOCKED');assert.ok(u.issues.some(x=>x.includes('权益')));
 }finally{f.s.close();}
});
test('production never treats local config as verified authorization or sends to a platform',async()=>{
 const f=await fixture('production');try{
  await assert.rejects(f.s.call('publish.quick',f.input),/授权/);assert.equal(f.s.all('batches').length,0);
  f.s.save('accounts',{...f.account,authStatus:'connected',remoteSubject:'verified-test-subject'});
  const r=await f.s.call('publish.quick',f.input);assert.equal(r.started,false);const u=f.s.all('units').find(u=>u.batchId===r.batch.id);assert.equal(u.state,'BLOCKED');assert.equal(u.remoteOutcome,'not_submitted');assert.equal(u.commitCount,0);assert.ok(u.issues.some(x=>x.includes('未获准接入')));assert.equal(r.batch.approved,false);
 }finally{f.s.close();}
});
test('malformed recording scope is rejected before writing a batch',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.s.call('publish.quick',{...f.input,recordings:[{workId:f.work.id,slot:'audio_B'}]}),/录音/);
  await assert.rejects(f.s.call('publish.quick',{...f.input,recordings:[{workId:randomUUID(),slot:'audio_A'}]}),/录音/);
  assert.equal(f.s.all('batches').length,0);
 }finally{f.s.close();}
});
test('B video cannot reuse A MP4; matched per-recording videos are selected without altering audio slots',async()=>{
 const f=await fixture('simulation',true);try{
  const account=await f.s.call('account.save',{provider:'douyin',name:'视频测试账号',dailyLimit:10});await f.s.call('binding.save',{artistId:f.artist.id,accountId:account.id,targets:['douyin']});
  const aVideo=await f.s.call('video.prepare',{workId:f.work.id});
  const input={...f.input,targets:['douyin'],recordings:[{workId:f.work.id,slot:'audio_B'}]};
  const blocked=await f.s.call('publish.quick',input);const first=f.s.all('units').find(u=>u.batchId===blocked.batch.id);
  assert.equal(first.state,'BLOCKED');assert.equal(first.snapshot.assets.video,undefined);assert.ok(first.issues.some(x=>x.includes('MP4')));
  assert.ok(!materialEntries(f.s,blocked.batch.id).some(f=>/\/video\./.test(f.name)));
  const bVideo=await f.s.call('video.prepare',{workId:f.work.id,recordingSlot:'audio_B'});assert.notEqual(bVideo.id,aVideo.id);
  const r=await f.s.call('publish.quick',{...input,recordings:[...f.input.recordings,...input.recordings]});const units=f.s.all('units').filter(u=>u.batchId===r.batch.id);
  assert.equal(units.find(u=>u.recordingSlot==='audio_A').snapshot.assets.video,aVideo.id);assert.equal(units.find(u=>u.recordingSlot==='audio_B').snapshot.assets.video,bVideo.id);assert.ok(units.every(u=>u.state==='READY'));
  const original=f.s.get('works',f.work.id);assert.equal(original.assets.audio_A,f.work.assets.audio_A);assert.equal(original.assets.audio_B,f.work.assets.audio_B);
 }finally{f.s.close();}
});
