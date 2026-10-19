import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const w=createRequire(import.meta.url)(process.env.RAINFALL_PUBLICATION_SCOPE_BUNDLE),scope={publicationTaskId:'task-a',accountId:'account-a'};
test('every preparation work/grant/job action preserves legacy fields and adds exact scope except empty/global actions',()=>{
 const input={id:'job',expectedRevision:3,consent:true,authorizationNonce:'original-nonce'};
 for(const action of ['inspect','register','context','start','run','reconcile','resumePicker','resumeCrop'])assert.deepEqual(w.preparationInput(action,input,'work-a',scope),{...input,workId:'work-a',...scope});
 for(const action of ['list','connectBrowser'])assert.equal(w.preparationInput(action,input,'work-a',scope),input);
 assert.equal(w.preparationInput('register',input,'work-a'),input);assert.equal(input.workId,undefined);
});
test('prepare lists exclude legacy rows and every other task/account even for the same work',()=>{
 const exact={id:'exact',workId:'same',...scope},wrongTask={id:'task-b',workId:'same',...scope,publicationTaskId:'other'},wrongAccount={id:'account-b',workId:'same',...scope,accountId:'other'},legacy={id:'legacy',workId:'same'},rows={grants:[wrongTask,wrongAccount,legacy,exact],jobs:[legacy,wrongAccount,exact,wrongTask]};
 assert.deepEqual(w.preparationRows(rows,scope),{grants:[exact],jobs:[exact]});assert.deepEqual(w.preparationRows(rows),rows);
});
test('submission filtering never exposes foreign reviewed terms or carries its ready authorization',()=>{
 const exact={id:'exact',...scope},foreign={id:'foreign',...scope,accountId:'other',termsText:'foreign'},raw={ready:true,job:foreign,jobs:[foreign,exact],capability:{available:true}};
 const filtered=w.submissionResult(raw,scope);assert.equal(filtered.job,undefined);assert.equal(filtered.ready,false);assert.deepEqual(filtered.jobs,[exact]);assert.equal(w.submissionResult(raw),raw);
 assert.equal(w.submissionResult({...raw,job:exact},scope).ready,true);
});
