import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
const bundle=path.resolve('output/tme-binding-contract-review/account-identity.cjs');
const identity=fs.existsSync('src/core/account-identity.ts')?'export * from "./src/core/account-identity";':'';
await build({stdin:{contents:identity+'export {Repository} from "./src/core/database";',resolveDir:process.cwd()},outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external'});
const guard=path.resolve('tests/fixtures/offline-only.cjs');
const restartProof=path.resolve('output/tme-binding-contract-review/restart-'+randomUUID()+'.json');
if(identity){
 const database=path.resolve('output/tme-binding-contract-review/restart-'+randomUUID()+'/state.sqlite');
 const probe=`const {Repository,AccountIdentityService}=require(process.env.RAINFALL_ACCOUNT_IDENTITY_BUNDLE);const {randomUUID}=require('node:crypto');const repo=new Repository(process.argv[1]);(async()=>{try{let result;if(process.argv[2]==='seed'){const artistId=randomUUID(),accountId=randomUUID();repo.save('artists',{id:artistId});repo.save('accounts',{id:accountId,provider:'tme'});const adapter={provider:'tme',source:'offline-fixture',contractVersion:'test-v1',evidenceHash:'a'.repeat(64),read:async()=>({status:'observed',provider:'tme',namespace:'isolated-v1',remoteAccountId:'isolated-account',remoteArtistId:'isolated-artist',accountDisplayName:'Fixture',artistDisplayName:'Fixture',observedAt:new Date().toISOString(),evidenceRef:'fixture:proof',evidenceHash:'b'.repeat(64),sessionRef:'fixture:session'})};const s=new AccountIdentityService(repo,{environment:'test',adapters:[adapter]});const pending=await s.execute('start',{artistId,accountId,provider:'tme'});result=await s.execute('confirm',{id:pending.id,expectedRevision:pending.revision,confirmed:true});}else result=new AccountIdentityService(repo).execute('list',{})[0];process.stdout.write(JSON.stringify(result));}finally{repo.db.close()}})().catch(e=>{process.stderr.write(String(e));process.exitCode=1});`;
 const run=phase=>{const result=spawnSync(process.execPath,['--require',guard,'-e',probe,database,phase],{encoding:'utf8',env:{...process.env,RAINFALL_ACCOUNT_IDENTITY_BUNDLE:bundle}});if(result.status!==0)throw Error(result.stderr||'RESTART_PROBE_FAILED');return JSON.parse(result.stdout)};
 fs.writeFileSync(restartProof,JSON.stringify({before:run('seed'),after:run('read')},null,2));
}
const result=spawnSync(process.execPath,['--require',guard,'--test','tests/account-identity.test.cjs'],{stdio:'inherit',env:{...process.env,RAINFALL_ACCOUNT_IDENTITY_BUNDLE:bundle,RAINFALL_ACCOUNT_IDENTITY_RESTART_PROOF:restartProof}});
process.exit(result.status??1);
