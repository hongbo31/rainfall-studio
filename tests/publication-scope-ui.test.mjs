import { launchHeadlessChromium } from "../scripts/lib/headless-chromium.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const {outputFiles}=await build({entryPoints:['tests/fixtures/publication-scope-ui.tsx'],outdir:'build',platform:'browser',bundle:true,write:false});
let browser;
test.before(async()=>{browser=await launchHeadlessChromium(chromium, {args:['--disable-background-networking','--no-first-run','--no-sandbox']});});
test.after(async()=>browser?.close());
async function fixture(t){
 const page=await browser.newPage();t.after(()=>page.close());const network=[];
 await page.route('**/*',route=>{network.push(route.request().url());return route.abort();});
 await page.setContent('<meta charset="utf-8"><div id="root"></div>');
 await page.addStyleTag({content:outputFiles.find(file=>file.path.endsWith('.css')).text});
 await page.addScriptTag({content:outputFiles.find(file=>file.path.endsWith('.js')).text});
 await page.waitForFunction(()=>!!window.ui?.setTask);return {page,network};
}
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
test('desktop and browser publish centers show the task list and history without the platform records panel',async t=>{
 const {page,network}=await fixture(t);
 for(const kind of ['center','center-browser']){
  await page.evaluate(value=>window.ui.setKind(value),kind);
  const tasks=page.getByRole('region',{name:'发布任务',exact:true});
  const row=tasks.getByRole('row',{name:/已保存的发布任务/});
  await row.waitFor();
  assert.equal(await page.getByText('平台处理与投稿记录',{exact:true}).count(),0);
  assert.equal(await page.getByText('番茄音乐 · 测试番茄账号',{exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'＋ 新建任务',exact:true}).isEnabled(),true);
  await row.getByRole('button',{name:'记录',exact:true}).click();
  const history=page.getByRole('dialog',{name:'执行记录',exact:true});
  await history.getByText('测试投稿已记录',{exact:true}).waitFor();
  assert.equal(await history.getByRole('button',{name:'查看平台处理',exact:true}).count(),0);
  await history.getByRole('button',{name:'关闭',exact:true}).click();
 }
 assert.deepEqual(network,[]);
});
test('the standalone preparation panel retains the legacy request format',async t=>{
 const {page,network}=await fixture(t);
 await page.evaluate(()=>window.ui.setLegacy(true));
 await page.waitForFunction(()=>document.querySelector('[data-pipeline-id="legacy-task"]'));
 await page.getByTestId('tme-ai-prepare-compact').locator('button').first().click();
 const {calls,workId}=await page.evaluate(()=>window.ui);
 assert.deepEqual(calls.filter(c=>c.action==='inspect').at(-1).input,{workId});
 assert.deepEqual(network,[]);
});
