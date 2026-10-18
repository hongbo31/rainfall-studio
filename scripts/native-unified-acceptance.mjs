// Actual packaged Windows Electron, original fixtures only. No real platform mutations.
import {_electron as electron,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {createRequire} from 'node:module';
import {beginDesktopRun,closeDesktopRun,withTimeout} from './lib/windows-desktop-qa.mjs';
const pkg=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const fixture=JSON.parse(fs.readFileSync('output/native-acceptance/fixture.json','utf8'));
const out=path.resolve('output/playwright/native-unified-'+Date.now());fs.mkdirSync(out,{recursive:true});
const report={package:pkg.executable,sourceCommit:pkg.sourceCommit,dataRoot:fixture.root,source:'original-local-fixtures',checks:[],screens:[],runs:[],errors:[],externalRequests:[],noRealPlatformMutation:true};
let app,page,run;
const require=createRequire(import.meta.url);
const call=async(method,input={})=>page.evaluate(async({method,input})=>{const r=await window.rainfall.call(method,input);if(!r.ok)throw Error(r.error.code+': '+r.error.message);return r.value;},{method,input});
async function shot(name){const file=path.join(out,name+'.png');await page.screenshot({path:file,fullPage:true});report.screens.push(file);}
async function open(){
 run=await beginDesktopRun(pkg.executable,fixture.root);report.runs.push(run);
 app=await electron.launch({executablePath:pkg.executable,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,RAINFALL_DATA_ROOT:fixture.root,RAINFALL_MODE:'production'},timeout:30000});run.launcherPid=app.process().pid;
 run.pid=await withTimeout(()=>app.evaluate(()=>process.pid),5000,'PID_TIMEOUT');
 page=await withTimeout(()=>app.firstWindow(),15000,'FIRST_WINDOW_TIMEOUT');page.setDefaultTimeout(12000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))report.externalRequests.push(r.url())});
 await app.evaluate(({BrowserWindow,ipcMain,session})=>{
  const win=BrowserWindow.getAllWindows()[0];win.setContentSize(1440,1000);
  globalThis.__qa={calls:[],nativeAttempts:0};
  const handler=ipcMain._invokeHandlers.get('rainfall:call');ipcMain._invokeHandlers.set('rainfall:call',(event,method,input)=>{globalThis.__qa.calls.push({method,input});return handler(event,method,input)});
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));
  process.getBuiltinModule('node:child_process').spawn=()=>{globalThis.__qa.nativeAttempts++;throw Error('QA_NATIVE_INPUT_BLOCKED')};
 });
 await page.getByRole('button',{name:'发布中心',exact:true}).waitFor();
 report.nativeWindow=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return{visible:w.isVisible(),bounds:w.getBounds(),title:w.getTitle(),appVersion:process.versions.electron}});
 assert.equal(report.nativeWindow.visible,true);
 await page.getByRole('button',{name:'发布中心',exact:true}).click();
}
async function close(){const current=app,currentRun=run;app=null;run=null;await closeDesktopRun(current,currentRun,{inspect:async a=>{const qa=await a.evaluate(()=>globalThis.__qa);report.calls=(report.calls??[]).concat(qa.calls);assert.equal(qa.nativeAttempts,0);}});}
async function choose(id){const s=await call('snapshot');for(const w of s.works){const cb=page.getByRole('checkbox',{name:'选择歌曲：'+w.title,exact:true});await cb.setChecked(w.id===id);}await page.getByRole('checkbox',{name:'发布到 QQ 音乐',exact:true}).check();}
try{
 await open();const selectRegion=page.getByRole('region',{name:'选择歌曲和平台',exact:true});
 await expect(selectRegion.getByRole('button',{name:'发布',exact:true})).toBeDisabled();report.checks.push('Empty selection disables publish');
 await choose(fixture.ids.missing);await selectRegion.getByRole('button',{name:'发布',exact:true}).evaluate(el=>{el.click();el.click()});
 await expect(page.getByRole('region',{name:'发布进度'})).toBeVisible();
 await expect.poll(async()=>(await call('snapshot')).publicationPipelineJobs.find(j=>j.workId===fixture.ids.missing)?.state).toBe('needs_materials');
 assert.equal((await app.evaluate(()=>globalThis.__qa.calls)).filter(c=>c.method==='publish.simple').length,1);
 report.checks.push('Actual double click calls publish.simple once; missing materials persists needs_materials');await shot('01-missing-materials');
 await choose(fixture.ids.complete);await selectRegion.getByRole('button',{name:'发布',exact:true}).click();
 await expect.poll(async()=>(await call('snapshot')).publicationPipelineJobs.find(j=>j.workId===fixture.ids.complete)?.state,{timeout:15000}).toBe('awaiting_authorization');
 const full=(await call('snapshot')).publicationPipelineJobs.find(j=>j.workId===fixture.ids.complete);report.completeTaskId=full.id;
 assert.equal(full.dispatchedAt,undefined);report.checks.push('Complete selected work traverses Renderer IPC Core journal Main pump and stops before preparation consent');
 const progress=page.getByRole('region',{name:'发布进度'});const metadata=progress.locator('.publication-metadata-form');await metadata.locator('summary').click();
 await metadata.getByLabel('专辑介绍',{exact:true}).fill('本次原生隔离验收：只保存本地资料');await metadata.getByRole('button',{name:'保存投稿资料',exact:true}).click();
 await expect.poll(async()=>(await call('snapshot')).works.find(w=>w.id===fixture.ids.complete)?.publicationMetadata.albumDescription).toBe('本次原生隔离验收：只保存本地资料');
 report.checks.push('Metadata form saves the selected work locally without authorizing upload');await shot('02-metadata-pending');
 const browserStatus=await page.evaluate(()=>window.rainfall.tmeAiPrepare('browserStatus',{}));report.browserStatus=browserStatus;assert.equal(browserStatus.value.connected,false);assert.equal(browserStatus.value.identityCalibrated,false);
 await progress.getByRole('button',{name:'连接官网浏览器',exact:true}).click();
 await expect(progress.getByRole('button',{name:'连接官网浏览器',exact:true})).toBeEnabled();
 const connectionText=await progress.innerText();assert.ok(/未完成|失败|拒绝|REJECTED|ECONNREFUSED/.test(connectionText));report.connectionMessage=connectionText.split('\n').filter(l=>/未完成|失败|拒绝|REJECTED|ECONNREFUSED/.test(l));
 report.checks.push('Existing-browser connection UI fails closed without configured CDP; identity/prepare/submit contracts remain uncalibrated');await shot('03-browser-connection-blocked');
 for(const id of [fixture.ids.protectedA,fixture.ids.protectedB]){await choose(id);await selectRegion.getByRole('button',{name:'发布',exact:true}).click();await expect.poll(async()=>(await call('snapshot')).publicationPipelineJobs.find(j=>j.workId===id)?.reason).toBe('PROTECTED_PUBLISHED_WORK');}
 report.checks.push('Both already published titles are blocked before preparation even in a fresh empty journal');await shot('04-protected-published-title');
 const before=await call('snapshot');report.beforeRestartJobs=before.publicationPipelineJobs.map(j=>({id:j.id,state:j.state,reason:j.reason}));await close();
 // Simulate an interrupted Main dispatch exclusively in the now-closed fixture DB.
 const {Repository}=require('../output/unified-tests/core.cjs');const db=new Repository(path.join(fixture.root,'production/library.sqlite'));
 try{const row=db.maybe('settings','unified-publication:v1:'+full.id);db.save('settings',{id:row.id,value:{...row.value,state:'preparing',dispatchedAt:new Date().toISOString(),revision:row.value.revision+1}});}finally{db.close()}
 await open();await choose(fixture.ids.complete);
 await expect.poll(async()=>(await call('snapshot')).publicationPipelineJobs.find(j=>j.id===full.id)?.state).toBe('reconcile_required');
 await expect(page.getByRole('region',{name:'发布进度'})).toContainText('结果待核对，请勿重复提交');
 const replayRegion=page.getByRole('region',{name:'选择歌曲和平台'});await replayRegion.getByRole('button',{name:'发布',exact:true}).evaluate(el=>{el.click();el.click()});
 await expect.poll(async()=>(await call('snapshot')).publicationPipelineJobs.find(j=>j.id===full.id)?.state).toBe('reconcile_required');
 const restored=await call('snapshot');assert.equal(restored.publicationPipelineJobs.filter(j=>j.workId===fixture.ids.complete).length,1);assert.equal(restored.publicationPipelineJobs.find(j=>j.id===full.id).reason,'PREPARATION_INTERRUPTED');
 assert.equal(restored.works.find(w=>w.id===fixture.ids.complete).publicationMetadata.albumDescription,'本次原生隔离验收：只保存本地资料');
 assert.equal(restored.tmeAiPreparation?.grants?.length??0,0);report.checks.push('Restart converts interrupted preparing intent to reconcile_required; repeat click reuses ID and cannot replay upload; metadata persists');await shot('05-restart-recovery');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);
 report.checks.push('Actual visible native window: no horizontal overflow, renderer errors or external renderer requests');
 await close();report.passed=true;
}catch(e){report.passed=false;report.error=String(e);if(page)await shot('failure').catch(()=>{});try{await close()}catch(closeError){report.cleanupError=String(closeError)}}
finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync('output/native-acceptance/latest-native-report.json',JSON.stringify({path:path.join(out,'report.json'),passed:report.passed,error:report.error},null,2));console.log(JSON.stringify({passed:report.passed,report:path.join(out,'report.json'),checks:report.checks,error:report.error}));if(!report.passed)process.exitCode=1;}
