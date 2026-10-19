// Explicit acceptance script: reads the already-submitted song only. No upload/accept/submit APIs.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const root=path.resolve('output/new-song-convenience-20261018');
const prior=JSON.parse(fs.readFileSync('output/authorized-edge-cdp-20261018-132947-41bea983/real-manager-account-check.json','utf8'));
const receipt=JSON.parse(fs.readFileSync(path.join(root,'official-receipt.json'),'utf8'));
assert.equal(prior.account.readOnly,true);assert.equal(prior.account.subjectHash,'102729c7d5402ecf834193a718ce09ff7c63a9ee6975c3cc1767a2b6b77cfcd0');
assert.equal(receipt.externalSongRecordId,'18281901');assert.equal(receipt.albumId,'6437318');assert.equal(receipt.artistName,prior.account.artistName);
const outfile=path.join(root,'readonly-manager.cjs');await build({entryPoints:['src/main/tme/ai-cloud-session.ts'],outfile,bundle:true,platform:'node',format:'cjs',packages:'external'});
const {TmeAiCloudSessionManager}=createRequire(import.meta.url)(outfile);
const manager=new TmeAiCloudSessionManager({enableExistingAlbum:true});
try{
 await manager.connect({port:9222,allowConnection:true});
 const account=await manager.inspectAccount({});assert.equal(account.subjectHash,prior.account.subjectHash);
 const observed=await manager.readExternalReceipt({...receipt,subjectHash:prior.account.subjectHash,submittedAtSource:'local-observation'});
 assert.equal(observed.externalSongRecordId,receipt.externalSongRecordId);
 const result={verifiedAt:new Date().toISOString(),readOnly:true,account:{subjectHash:account.subjectHash,artistName:account.artistName,maskedKugouId:account.maskedKugouId},receipt:observed,writerEnabled:false,uploadAttempts:0,submitAttempts:0,sourcePriorIdentityObservation:prior.observedAt};
 fs.writeFileSync(path.join(root,'official-readonly-recovery.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({readOnly:true,songId:observed.externalSongRecordId,state:observed.state,observedAt:observed.observedAt,accountHashMatches:true,writerEnabled:false}));
}finally{await manager.disconnect()}
