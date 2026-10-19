// One acceptance import into this session's isolated candidate-data only. Never imports credentials.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createRequire} from 'node:module';
const session=path.resolve('output/new-song-convenience-20261018'),root=path.join(session,'candidate-data');
const observation=JSON.parse(fs.readFileSync(path.join(session,'official-readonly-recovery.json'),'utf8'));
const prior=JSON.parse(fs.readFileSync('output/authorized-edge-cdp-20261018-132947-41bea983/real-manager-account-check.json','utf8'));
assert.equal(observation.readOnly,true);assert.equal(observation.writerEnabled,false);assert.equal(observation.receipt.subjectHash,prior.account.subjectHash);assert.equal(observation.receipt.externalSongRecordId,'18281901');assert.equal(observation.receipt.albumId,'6437318');assert.equal(observation.receipt.audioSha256,'5de029aae17a886ecb1d87da58d84a2fe5fac038f2959dbc4a0d5863dc5f7c6f');
const outfile=path.join(session,'readonly-record.cjs');await build({stdin:{contents:"export {Repository} from './src/core/database';export * from './src/core/external-tme-receipt';export * from './src/main/tme/external-receipt-barrier';",resolveDir:process.cwd()},outfile,bundle:true,platform:'node',format:'cjs',packages:'external'});
const {Repository,ExternalTmeReceiptSchema,persistExternalReceiptBarrier,persistExternalReceiptStop}=createRequire(import.meta.url)(outfile);
const receipt=ExternalTmeReceiptSchema.parse(observation.receipt),repo=new Repository(path.join(root,'production/library.sqlite'));
try{
 const key='external-publication:tme:'+receipt.workId,old=repo.maybe('settings',key)?.value;assert.ok(old);for(const k of ['externalSongRecordId','albumId','audioSha256','termsSha256','title','artistName'])assert.equal(old[k],receipt[k]);
 persistExternalReceiptStop(root,receipt);const barrier=persistExternalReceiptBarrier(root,receipt);
 repo.transaction(()=>{repo.save('settings',{id:key,value:{...old,...receipt}});const work=repo.get('works',receipt.workId);repo.save('works',{...work,officialPublicationReceipt:{...work.officialPublicationReceipt,...receipt}});repo.audit('publication.official.readonly-recovery',receipt.workId,{externalSongRecordId:receipt.externalSongRecordId,state:receipt.state,observedAt:receipt.observedAt,subjectHash:receipt.subjectHash,noWrites:true});});
 fs.writeFileSync(path.join(session,'readonly-record-import.json'),JSON.stringify({root,workId:receipt.workId,songId:receipt.externalSongRecordId,state:receipt.state,observedAt:receipt.observedAt,barrier,originalDataModified:false},null,2));console.log(JSON.stringify({isolatedCandidateUpdated:true,songId:receipt.externalSongRecordId,state:receipt.state,durableBarrierCreated:true}));
}finally{repo.close()}
