const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Studio,MaterialWorkbenchService,prepareMaterialWork,importMaterialAudio,completeMaterialJob,offlineAcceptanceEnabled}=require('../build/core.cjs');
(async()=>{
 const root=process.env.RAINFALL_DATA_ROOT;assert(offlineAcceptanceEnabled());
 const s=new Studio(root,'production');try{
  assert.equal((await s.call('apiProfile.list',{})).length,0);
  const source=path.resolve(process.env.RAINFALL_ACCEPTANCE_SOURCE_ROOT??'../Rainfall-Materials-Pending/2026-10-20_100-songs');
  const service=new MaterialWorkbenchService({getSetting:k=>s.repo.maybe('settings',k)?.value,setSetting:(k,value)=>s.save('settings',{id:k,value})},{fixture:true,fixtureFeeBoundCredits:2,verifyAsset:v=>{const w=s.get('works',v.workId),a=s.get('assets',v.assetId);s.locate(a.id);return a.sha256===v.sha256&&w.assets['audio_'+v.version]===a.id;}});s.materialWorkbench=()=>service;
  if(!fs.existsSync(path.join(source,'song-map-001-100.json'))){service.configure({root:source});fs.writeFileSync(path.join(root,'fixture.json'),JSON.stringify({source,fixtureOnly:true,configuredOnly:true}));return;}
  service.configure({root:source});await service.scan({sourceId:service.list().sources[0].id});const m=service.list().materials[0];assert.equal(service.list().materials.length,100);
  const artist=s.all('artists')[0];service.enqueue({materialIds:[m.id],expectedRevisions:{[m.id]:m.revision},requestId:'offline-electron-fixture',profileId:'fixture-only',profileRevision:1,modelId:'fixture-only',artistId:artist.id,budgetCredits:10,consent:true});
  const job=service.list().jobs[0],prepared=await prepareMaterialWork(s,{jobId:job.id});service.claimNext();service.recordSubmitted({jobId:job.id,providerSongIds:['fixture-a','fixture-b']});
  for(const [i,id] of ['fixture-a','fixture-b'].entries()){
   const n=16000,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(n,24);b.writeUInt32LE(n*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let j=0;j<n;j++)b.writeInt16LE(Math.round(Math.sin(j*(i?660:440)*2*Math.PI/n)*1200),44+j*2);
   await importMaterialAudio(s,{jobId:job.id,providerSongId:id,providerMetadata:{id,source:'offline-fixture'},bytes:new Uint8Array(b),mime:'audio/wav'});
  }
  completeMaterialJob(s,{jobId:job.id,actualCredits:2});s.save('works',{...s.get('works',prepared.workId),acceptanceFixture:true,rights:'OFFLINE FIXTURE — no release authorization',ai:'generated'});
  fs.writeFileSync(path.join(root,'fixture.json'),JSON.stringify({source,materialId:m.id,title:m.title,workId:prepared.workId,versions:service.list().materials[0].versions},null,2));
 }finally{s.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
