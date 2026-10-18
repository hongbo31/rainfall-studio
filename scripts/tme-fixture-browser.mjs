import {chromium} from 'playwright-core';import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash,randomUUID} from 'node:crypto';import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{PlaywrightTmePort,TmeCoordinator}=require('../build/tme-browser.cjs');
const root=path.resolve('output/playwright/tme-fixture-'+randomUUID());fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.TME_TEST_BROWSER||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
try{
 const page=await browser.newPage();const external=[];await page.route(/^https?:/,route=>{external.push(route.request().url());return route.abort()});
 await page.goto(pathToFileURL(path.resolve('tests/fixtures/tme-form.html')).href);
 const contract={version:'fixture-v1',verified:true,source:'fixture',origin:'null',subject:'#artist-id',displayName:'#artist-name',draftId:'#draft-id',status:'#draft-status',reason:'#draft-reason',uploads:{audio:'#receipt-audio',cover:'#receipt-cover',proof:'#receipt-proof'}};
 const counts={};for(const name of ['歌曲名称','作词','作曲','是否AI音乐','AI工具','生成日期','歌词','音乐人说'])counts[name]=await page.getByLabel(name,{exact:true}).count();
 console.log(JSON.stringify({fixtureLabelCounts:counts}));
 const port=new PlaywrightTmePort(page,'fixture-device','fixture-session',contract),observed=await port.observe();
 let draft={id:'fixture-local-draft',revision:1,source:'fixture',state:'AWAITING_ACCOUNT',issues:[],workId:'fixture-work',workRevision:1,accountId:'fixture-account',title:'Local fixture original',reviewHash:'fixture-review',fingerprint:'fixture-fingerprint',metadata:{lyricist:'Fixture lyricist',composer:'Fixture composer',ownLyricist:false,ownComposer:false,aiMusic:'yes',aiTool:'Suno',generatedOn:'2026-10-15',lyrics:'这是本地合成测试，不是真实歌曲，不连接第三方。',statement:'',existingRemoteId:''},assets:{},uploads:{},remote:null,pendingAction:null};
 for(const role of ['audio','cover','proof']){const bytes=Buffer.from('fixture-'+role);const sha256=createHash('sha256').update(bytes).digest('hex'),file=path.join(root,sha256+'.fixture');fs.writeFileSync(file,bytes);draft.assets[role]={id:role,sha256,bytes:bytes.length,mime:'application/octet-stream',file};}
 const store={async get(){return structuredClone(draft)},async list(){return[draft]},async assertCurrent(){},async update(id,revision,patch){assert.equal(revision,draft.revision);draft={...draft,...patch,revision:revision+1};return structuredClone(draft)},async bind(id,revision,identity){return this.update(id,revision,{identity,state:'CHECKING'})}};
 const runner=new TmeCoordinator(store,port),result=await runner.run(draft.id,{identity:observed.identity,confirmed:true,reviewHash:draft.reviewHash});
 assert.equal(result.state,'DRAFT_SAVED');assert.equal(result.remote.id,'fixture-draft-1');assert.equal(result.remote.source,'fixture');
 assert.equal(await page.getByRole('checkbox',{name:'我是作词人',exact:true}).isChecked(),false);assert.equal(await page.getByRole('checkbox',{name:'我是作曲人',exact:true}).isChecked(),false);
 assert.deepEqual(await page.evaluate(()=>window.uploadCounts),{audio:1,cover:1,proof:1});
 await runner.run(draft.id,{identity:observed.identity,confirmed:true,reviewHash:draft.reviewHash});assert.equal(await page.evaluate(()=>window.saveCount),1);
 await page.screenshot({path:path.join(root,'fixture-saved.png'),fullPage:true});assert.deepEqual(external,[]);
 fs.writeFileSync(path.join(root,'report.json'),JSON.stringify({passed:true,source:'fixture',realProviderCalls:0,uploadedOnceEach:true,savedOnce:true,authorshipRemainsExplicitFalse:true,remoteId:result.remote.id,productionPageVerified:false},null,2));console.log(JSON.stringify({passed:true,root,source:'fixture',productionPageVerified:false}));
}finally{await browser.close();}
