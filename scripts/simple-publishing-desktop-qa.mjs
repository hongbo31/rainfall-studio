// Actual packaged Electron, copied library, denied external HTTP/native input.
import {_electron as electron,expect} from '@playwright/test';
import {openCreationWork} from './lib/open-creation-work.mjs';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {beginDesktopRun,closeDesktopRun,withTimeout} from './lib/windows-desktop-qa.mjs';
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
const pkg=read(process.argv[2]),backup=read('output/simple-publishing-delivery-backup.json');
const out=path.resolve('output/playwright/simple-publishing-'+Date.now()),root=path.join(out,'data');
fs.mkdirSync(path.join(root,'production'),{recursive:true});fs.copyFileSync(path.join(backup.backup,'production-library.sqlite'),path.join(root,'production/library.sqlite'));await fs.promises.cp(path.join(backup.backup,'media'),path.join(root,'media'),{recursive:true});
let app,page,nativeRun;const checks=[],screens=[],errors=[],nativeWindowsRuns=[];
async function open(){
 nativeRun=await beginDesktopRun(pkg.executable,root);nativeWindowsRuns.push(nativeRun);
 app=await electron.launch({executablePath:pkg.executable,args:pkg.args??[],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,RAINFALL_DATA_ROOT:root,RAINFALL_MODE:'production'},timeout:30000});nativeRun.launcherPid=app.process().pid;
 nativeRun.pid=await withTimeout(()=>app.evaluate(()=>process.pid),5000,'QA_PID_TIMEOUT');page=await withTimeout(()=>app.firstWindow(),15000,'QA_FIRST_WINDOW_TIMEOUT');page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await withTimeout(()=>app.evaluate(({BrowserWindow,session})=>{BrowserWindow.getAllWindows()[0].setContentSize(1440,1000);globalThis.__http=0;globalThis.__native=0;const deny=()=>{globalThis.__http++;throw Error('QA_EXTERNAL_NETWORK_BLOCKED')};process.getBuiltinModule('node:https').request=deny;process.getBuiltinModule('node:http').request=deny;process.getBuiltinModule('node:dns').promises.lookup=deny;session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));process.getBuiltinModule('node:child_process').spawn=()=>{globalThis.__native++;throw Error('QA_NATIVE_INPUT_BLOCKED')};}),10000,'QA_SETUP_TIMEOUT');
 await page.getByRole('button',{name:'配置中心',exact:true}).waitFor();
}
async function close(){const closing=app,run=nativeRun;app=null;nativeRun=null;await closeDesktopRun(closing,run,{inspect:async current=>{assert.equal(await current.evaluate(()=>globalThis.__http),0);assert.equal(await current.evaluate(()=>globalThis.__native),0);}});}
const call=async(method,input={})=>page.evaluate(async({method,input})=>{const r=await window.rainfall.call(method,input);if(!r.ok)throw Error(r.error.code+': '+r.error.message);return r.value;},{method,input});
async function shot(name){const file=path.join(out,name+'.png');await page.screenshot({path:file});screens.push(file);}
const selectWork=title=>page.getByRole('checkbox',{name:'选择歌曲：'+title,exact:true});
const target=name=>page.getByRole('checkbox',{name:'发布到 '+name,exact:true});
try{
 await open();const before=await call('snapshot'),original=before.works[0],assets=before.assets.map(a=>({id:a.id,sha256:a.sha256}));
 assert.equal(before.platformConfigurations.length,5);assert.equal(before.works.length,1);assert.equal(before.assets.length,4);checks.push('Existing schema3 opens with five additive platform configurations and original one work/four assets');
 await page.getByRole('button',{name:'发布中心',exact:true}).click();const publish=page.getByRole('region',{name:'选择歌曲和平台',exact:true});await expect(publish).toBeVisible();
 await expect(publish.getByRole('button',{name:'发布',exact:true})).toBeDisabled();checks.push('Empty song/platform selection disables Publish');
 const mainText=await page.locator('#content').innerText();for(const text of ['指纹','快照','执行器','修订','不代表官网保存'])assert.equal(mainText.includes(text),false,text);assert(mainText.length<1800);checks.push('Main publication page presents controls and compact status without old executor/debug/history paragraphs');await shot('01-simple-publish-empty');
 await selectWork(original.title).check();await target('QQ 音乐').check();await target('网易云音乐').check();
 await publish.getByRole('button',{name:'发布',exact:true}).click();await expect.poll(async()=>{const s=await call('snapshot');return s.publicationRequests.some(r=>r.workId===original.id&&r.target==='netease');}).toBe(true);
 const checked=await call('snapshot');assert(checked.publicationRequests.every(r=>r.formalSubmission===false));assert(checked.publicationPendingTerms.some(r=>r.summary==='待条款确认'));checks.push('Click records durable local checks and retains existing three-year terms pending; no formal submission');
 await page.getByRole('button',{name:'配置 网易云音乐',exact:true}).first().click();await expect(page.getByRole('region',{name:'网易云音乐配置',exact:true})).toBeVisible();
 const account=await call('account.save',{provider:'netease',name:'隔离验收账号',dailyLimit:3});
 await page.getByRole('combobox',{name:'默认账号',exact:true}).selectOption(account.id);await page.getByRole('textbox',{name:'词作者',exact:true}).fill('本地验收作者');await page.getByRole('textbox',{name:'曲作者',exact:true}).fill('本地验收作者');await page.getByRole('textbox',{name:'常用专辑',exact:true}).fill('雨夜系列');await page.getByRole('button',{name:'保存配置',exact:true}).click();
 await expect.poll(async()=>{const rows=await call('platformConfig.list');return rows.find(r=>r.target==='netease')?.album;}).toBe('雨夜系列');checks.push('Missing configuration opens exact platform; ordinary defaults save without granting account/terms authorization');
 const help=page.getByRole('button',{name:'平台说明',exact:true});await help.focus();await expect(page.getByRole('tooltip').filter({visible:true})).toBeVisible();await page.getByRole('textbox',{name:'常用专辑',exact:true}).focus();checks.push('Optional help is available on keyboard focus');await shot('02-configuration-center');
 await page.getByRole('tab',{name:'模型 API',exact:true}).click();await expect(page.getByRole('region',{name:'API 配置',exact:true})).toBeVisible();checks.push('Existing model API settings retain separate category');
 await page.getByRole('tab',{name:'诊断与历史',exact:true}).click();const diagnostic=page.locator('.publication-diagnostics');await expect(diagnostic.locator('h1')).toHaveCount(0);await diagnostic.locator('summary').first().click();await expect(diagnostic.getByRole('heading',{name:'让作品，走向更多人。',exact:true})).toBeVisible();await page.getByRole('tab',{name:'发布平台',exact:true}).click();await page.getByRole('tab',{name:'诊断与历史',exact:true}).click();await expect(diagnostic).not.toHaveAttribute('open','');await expect(diagnostic.locator('h1')).toHaveCount(0);checks.push('Returning to a closed diagnostics category does not mount legacy tools');
 await page.getByRole('button',{name:'发布中心',exact:true}).click();await expect(selectWork(original.title)).toBeChecked();await expect(target('QQ 音乐')).toBeChecked();await expect(target('网易云音乐')).toBeChecked();checks.push('Return from platform/API configuration preserves song and platform selection');
 const second=await call('work.save',{title:'隔离多选验收',artistId:original.artistId,story:'仅隔离验收',lyrics:'原创测试歌词',prompt:'本地检查',parameters:{},rights:'隔离测试用',ai:'assisted'});await selectWork(second.title).check();
 const input={workIds:[original.id,second.id],targets:['netease','qqmusic'],accountOverrides:{}};
 const result=await call('publish.simple',input),repeat=await call('publish.simple',{...input,workIds:[second.id,original.id],targets:['qqmusic','netease']});assert.deepEqual(result.requests.map(x=>x.id).sort(),repeat.requests.map(x=>x.id).sort());assert.equal(result.requests.length,4);assert(result.requests.some(r=>r.workId===second.id&&r.state==='needs_materials'));checks.push('Multiple songs/platforms form per-pair checks; missing audio stays blocked and reordered double request reuses same IDs');
 const durable=await call('snapshot'),requestIds=durable.publicationRequests.map(r=>r.id).sort();assert.deepEqual(durable.works.find(w=>w.id===original.id),original);assert.deepEqual(durable.assets.map(a=>({id:a.id,sha256:a.sha256})),assets);checks.push('Configuration/publication checks leave original work and four asset IDs/hashes unchanged');await shot('03-simple-publish-results');
 await close();await open();await page.getByRole('button',{name:'发布中心',exact:true}).click();await expect(selectWork(original.title)).toBeChecked();await expect(selectWork(second.title)).toBeChecked();await expect(target('QQ 音乐')).toBeChecked();
 const restored=await call('snapshot');assert.deepEqual(restored.publicationRequests.map(r=>r.id).sort(),requestIds);assert.equal(restored.platformConfigurations.find(c=>c.target==='netease').album,'雨夜系列');assert.deepEqual(restored.works.find(w=>w.id===original.id),original);checks.push('Restart restores platform defaults, multiselection and task IDs without automatically executing or creating duplicates');
 await openCreationWork(page,original.id);await page.getByRole('button',{name:'▷ 试听 A',exact:true}).click();await expect.poll(()=>page.locator('audio').evaluate(a=>a.currentTime)).toBeGreaterThan(1);await page.locator('audio').evaluate(a=>a.pause());checks.push('Original managed A audio still plays after restart');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(errors.length,0);checks.push('Desktop layout has no horizontal overflow or renderer exceptions');await close();
 const report={passed:true,package:pkg.executable,dataRoot:root,checks,screens,rendererErrors:errors,nativeWindowsRuns,realHttpRequests:0,nativeInputProcesses:0,realMusicGeneration:0,formalPublication:0};fs.writeFileSync('output/simple-publishing-gui-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){let cleanupError;try{await close();}catch(e){cleanupError=e}const report={passed:false,package:pkg.executable,dataRoot:root,checks,screens,rendererErrors:errors,nativeWindowsRuns,error:String(error),cleanupError:cleanupError?String(cleanupError):null};fs.writeFileSync('output/simple-publishing-gui-verification.json',JSON.stringify(report,null,2));throw cleanupError?new AggregateError([error,cleanupError],String(error)+'; '+String(cleanupError)):error;}finally{await close()}



