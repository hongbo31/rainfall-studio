import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const folder=path.resolve('output/provider-wiring/publication-scope-ui');
fs.mkdirSync(folder,{recursive:true});
await build({entryPoints:['tests/fixtures/publication-scope-ui.tsx'],outfile:path.join(folder,'app.js'),platform:'browser',bundle:true});
fs.writeFileSync(path.join(folder,'index.html'),'<meta charset="utf-8"><div id="root"></div><script src="./app.js"></script>');
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(p=>fs.existsSync(p));
let browser;
test.before(async()=>{browser=await chromium.launch({executablePath,headless:true,args:['--disable-background-networking','--no-first-run','--no-sandbox']});});
test.after(async()=>browser?.close());
async function fixture(t){const page=await browser.newPage();t.after(()=>page.close());const network=[];await page.route('**/*',route=>{if(route.request().url().startsWith('file:'))return route.continue();network.push(route.request().url());return route.abort();});await page.goto(pathToFileURL(path.join(folder,'index.html')).href);await page.waitForFunction(()=>!!window.ui?.setTask);return {page,network};}
const button=(page,index)=>page.locator('.simple-request').locator('button').nth(index);
test('scoped preparation inspect/register sends exact task+account, lists stay legacy and switching task clears consent',async t=>{
 const {page,network}=await fixture(t);await page.getByTestId('tme-ai-prepare-compact').locator('button').first().click();
 const ids=await page.evaluate(()=>window.ui);const inspect=ids.calls.find(c=>c.action==='inspect');assert.deepEqual(inspect.input,{workId:ids.workId,publicationTaskId:ids.taskA,accountId:ids.accountA});assert.deepEqual(ids.calls.find(c=>c.action==='list').input,{});
 const checks=page.locator('.simple-request input[type=checkbox]');await checks.first().check();const authorize=page.locator('.simple-request button.primary');assert.equal(await authorize.isEnabled(),true);await authorize.click();
 const registered=await page.evaluate(()=>window.ui.calls.find(c=>c.action==='register').input);assert.equal(registered.publicationTaskId,ids.taskA);assert.equal(registered.accountId,ids.accountA);assert.equal(registered.authorizationNonce,'00000000-0000-4000-8000-000000000090');
 await page.evaluate(()=>window.ui.setTask(window.ui.taskB));await page.waitForFunction(()=>document.querySelector('[data-pipeline-id]')?.getAttribute('data-pipeline-id')===window.ui.taskB);assert.equal(await checks.first().isChecked(),false);assert.equal(await checks.first().isDisabled(),true);assert.deepEqual(network,[]);
});
test('submission preflight/status/submit stay scoped and switching task clears reviewed terms and rights',async t=>{
 const {page,network}=await fixture(t);await page.evaluate(()=>window.ui.setKind('submission'));await page.locator('.simple-request select').waitFor();await page.locator('.simple-request .button-row').first().locator('button').first().click();
 const ids=await page.evaluate(()=>window.ui);assert.deepEqual(ids.calls.find(c=>c.action==='preflight').input,{workId:ids.workId,publicationTaskId:ids.taskA,accountId:ids.accountA});assert.ok(!(await page.locator('.simple-request').innerText()).includes('Foreign terms'));
 await page.locator('.simple-request input[type=checkbox]').nth(0).check();await page.locator('.simple-request input[type=checkbox]').nth(1).check();assert.equal(await page.locator('.simple-request .button-row').last().locator('button').first().isEnabled(),true);
 await page.evaluate(()=>window.ui.setTask(window.ui.taskB));await page.waitForFunction(()=>document.querySelector('[data-pipeline-id]')?.getAttribute('data-pipeline-id')===window.ui.taskB);assert.equal(await page.locator('.simple-request input[type=checkbox]').count(),0);assert.ok(!(await page.locator('.simple-request').innerText()).includes('Terms for task A'));
 await page.locator('.simple-request .button-row').first().locator('button').nth(1).click();const status=await page.evaluate(()=>window.ui.calls.find(c=>c.action==='status').input);assert.equal(status.publicationTaskId,ids.taskB);assert.equal(status.accountId,ids.accountB);
 await page.locator('.simple-request input[type=checkbox]').nth(0).check();await page.locator('.simple-request input[type=checkbox]').nth(1).check();await page.locator('.simple-request .button-row').last().locator('button').first().click();const sent=await page.evaluate(()=>window.ui.calls.find(c=>c.action==='authorizeAndSubmit').input);assert.equal(sent.id,'submission-b');assert.equal(sent.publicationTaskId,ids.taskB);assert.equal(sent.accountId,ids.accountB);assert.equal(sent.workId,ids.workId);assert.deepEqual(network,[]);
});
test('late inspection from an unmounted task cannot authorize another account',async t=>{
 const {page,network}=await fixture(t);await page.evaluate(()=>window.ui.deferInspect=true);await page.getByTestId('tme-ai-prepare-compact').locator('button').first().click();await page.waitForFunction(()=>!!window.ui.resolveInspect);
 await page.evaluate(()=>window.ui.setTask(window.ui.taskB));await page.waitForFunction(()=>document.querySelector('[data-pipeline-id]')?.getAttribute('data-pipeline-id')===window.ui.taskB);await page.evaluate(()=>window.ui.resolveInspect());
 assert.equal(await page.getByTestId('tme-ai-prepare-compact').locator('input[type=checkbox]').first().isChecked(),false);assert.equal(await page.getByTestId('tme-ai-prepare-compact').locator('input[type=checkbox]').first().isDisabled(),true);assert.deepEqual(network,[]);
});
test('queue filters persisted task and account independently while legacy workspace keeps old request format',async t=>{
 const {page,network}=await fixture(t);await page.evaluate(()=>window.ui.setKind('center'));await page.getByTestId('publication-task-filter').waitFor();assert.equal(await page.locator('[data-pipeline-id]').count(),2);const ids=await page.evaluate(()=>window.ui);await page.getByTestId('publication-account-filter').selectOption(ids.accountB);assert.equal(await page.locator('[data-pipeline-id]').count(),1);assert.equal(await page.locator('[data-pipeline-id]').getAttribute('data-pipeline-id'),ids.taskB);
 await page.evaluate(()=>{window.ui.setKind('prepare');window.ui.setLegacy(true);});await page.getByTestId('tme-ai-prepare-compact').locator('button').first().click();const legacy=await page.evaluate(()=>window.ui.calls.filter(c=>c.action==='inspect').at(-1).input);assert.deepEqual(legacy,{workId:ids.workId});assert.deepEqual(network,[]);
});
