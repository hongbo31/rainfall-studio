import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import {createRequire} from 'node:module';
import {launchHeadlessChromium} from '../scripts/lib/headless-chromium.mjs';

test('browser task center expands the linked run and stops the current task through its session', async t => {
 const built = await build({entryPoints:['src/main/browser-studio.ts'], bundle:true, platform:'node', format:'esm', write:false});
 const {startBrowserStudio} = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].contents).toString('base64'));
 const at = '2026-11-21T08:00:00Z';
 const plans = ['日常创作', '番茄上传'].map(title => ({id:randomUUID(), title, revision:1}));
 const removedPlanId = randomUUID();
 const task = {id:randomUUID(), title:'晚间发行', revision:1, enabled:true, consent:true,
  execution:{kind:'scheduled', unit:'day', localTime:'20:00'}, steps:[{kind:'plans', planIds:[...plans.map(plan=>plan.id),removedPlanId]}]};
 const nextTask = {...task, id:randomUUID(), title:'周末作品整理', execution:{kind:'manual'}};
 const report = run => ({...run, taskId:task.id, source:'manual', startedAt:at, updatedAt:at, plans, linked:[], logs:[], snapshot:task});
 let run = report({id:randomUUID(), state:'partial', detail:'执行完毕 · 成功 1 个 · 失败 2 个'});
 const failedPlan = {planId:plans[1].id, title:plans[1].title, state:'failed', runId:randomUUID(), updatedAt:at,
  reason:'PULE_DOWNLOAD_TIMEOUT', items:[{id:'song-1', ordinal:1, state:'failed', title:'夜里的灯', stages:[
   {id:'stage-1', stage:'music_submit', state:'succeeded'},
   {id:'stage-2', stage:'music_assets', state:'failed', reason:'PULE_DOWNLOAD_TIMEOUT'},
  ]}]};
 const data = {mode:'production', works:[], assets:[], artists:[], accounts:[], series:[], plans:[], targets:[], exceptions:[],
  resources:{finished:0, cost:{}, candidate:{}}};
 const calls = [];
 const initialDashboard = Promise.withResolvers();
 const ok = value => ({ok:true, value});
 const server = startBrowserStudio(path.resolve('build/ui'), {
  media:async()=>new Response(null,{status:404}),
  dispatch:async(channel,[method,input])=>{
   assert.equal(channel,'rainfall:call');
   if(method==='snapshot')return ok(data);
   if(method==='runtime')return ok({});
   if(method==='publicationTasks.list'){
    await initialDashboard.promise;
    const expanded=input?.expandedTaskId===task.id;
    const removed={planId:removedPlanId,title:'不可用计划',state:run.state==='partial'?'failed':run.state==='stopped'?'skipped':'queued',items:[]};
    const planProgress=expanded ? [...(run.state==='partial'
     ? [{planId:plans[0].id,title:plans[0].title,state:'completed',items:[],updatedAt:at},failedPlan]
     : plans.map(plan=>({planId:plan.id,title:plan.title,state:run.state==='stopped'?'skipped':'queued',items:[]}))),removed] : undefined;
    return ok({tasks:[{task,run,planProgress},{task:nextTask}],plans});
   }
   if(method==='publicationTasks.start'){
    calls.push([method,input.id]);
    run=report({id:randomUUID(),state:'waiting',detail:'等待计划 1/3 · 日常创作 · 另一次执行尚未结束'});
    return ok(run);
   }
   if(method==='publicationTasks.stop'){
    calls.push([method,input.id]);
    assert.equal(input.id,run.id);
    run={...run,state:'stopped',detail:'已停止后续步骤'};
    return ok(run);
   }
   return {ok:false,error:{code:'UNEXPECTED_FIXTURE_CALL',message:String(method)}};
  },
 });
 t.after(()=>server.close());
 const url=await server.ready, origin=new URL(url).origin;
 const browser=await launchHeadlessChromium(chromium);
 t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1434,height:900}});
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 await page.goto(url);
 await page.getByRole('navigation').getByRole('button',{name:'任务中心',exact:true}).click();
 const panel=page.getByRole('region',{name:'任务列表'});
 await expect(panel).toHaveAttribute('aria-busy','true');
 await expect(panel.locator('.loading-spinner')).toBeVisible();
 initialDashboard.resolve();
 const taskName=page.getByRole('button',{name:task.title,exact:true});
 await taskName.click();
 const plansPanel=page.getByRole('region',{name:`${task.title}的关联计划`});
 const fault=plansPanel.getByRole('article',{name:plans[1].title});
 await expect(fault.getByText(/谱乐音频下载超过 10 分钟/u)).toBeVisible();
 await fault.getByText('阶段明细',{exact:true}).click();
 await expect(fault.getByText('下载歌曲',{exact:true})).toBeVisible();

 const preview=process.env.RAINFALL_TASK_CENTER_PREVIEW;
 if(preview){
  await fs.mkdir(preview,{recursive:true});
  await page.screenshot({path:path.join(preview,'task-center-original.png'),animations:'disabled'});
 }
 await page.getByRole('button',{name:'白色',exact:true}).click();
 await page.setViewportSize({width:860,height:900});
 await expect(fault.getByText('下载歌曲',{exact:true})).toBeVisible();
 assert.ok(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth));
 if(preview)await page.screenshot({path:path.join(preview,'task-center-compact.png'),animations:'disabled'});

 const row=page.getByRole('row').filter({has:taskName});
 await row.getByRole('button',{name:'立即执行',exact:true}).click();
 const stop=row.getByRole('button',{name:'停止',exact:true});
 await expect(stop).toBeEnabled();
 await expect(row.getByText(/另一次执行尚未结束/u)).toBeVisible();
 const runningId=run.id;
 await stop.click();
 await expect(row.getByText('已停止',{exact:true})).toBeVisible();
 await expect(row.getByRole('button',{name:'立即执行',exact:true})).toBeEnabled();
 assert.deepEqual(calls,[['publicationTasks.start',task.id],['publicationTasks.stop',runningId]]);
 assert.deepEqual(errors,[]);
});

test('account windows use separate profiles and retain the last artist on reopening',async t=>{
 const bundle=path.resolve('output/work-window-fixture.cjs');
 await build({stdin:{contents:`export {PlatformBrowserSessions,accountBrowserDirectory} from './src/main/browser-accounts';
   export {platformAccountLoginUrl,platformPageUrls} from './src/shared/platform-directory';`,resolveDir:process.cwd()},
  bundle:true,platform:'node',format:'cjs',packages:'external',outfile:bundle});
 const {PlatformBrowserSessions,accountBrowserDirectory,platformAccountLoginUrl,platformPageUrls}=createRequire(import.meta.url)(bundle);
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rainfall-work-windows-'));
 const profiles=[], visited=[];
 const launch=async profile=>{
  profiles.push(profile);await fs.mkdir(profile,{recursive:true});
  const context=new EventEmitter();
  let url='about:blank';
  const page={url:()=>url,goto:async next=>{url=new URL(next).href;visited.push(url);},isClosed:()=>false,bringToFront:async()=>{}};
  return Object.assign(context,{pages:()=>[page],close:async()=>context.emit('close')});
 };
 const first={id:randomUUID(),provider:'tme',name:'测试账号 A',dailyLimit:1};
 const second={id:randomUUID(),provider:'netease',name:'测试账号 B',dailyLimit:1};
 const artistA=randomUUID(),artistB=randomUUID(),manager=new PlatformBrowserSessions(root,launch);
 t.after(()=>manager.close());
 const url='https://fixture.invalid',guard=()=>{};
 await Promise.all([manager.open(first,url,guard,artistA),manager.open(second,url,guard,artistA)]);
 await manager.open(first,url,guard,artistB);
 assert.deepEqual(profiles,[accountBrowserDirectory(root,first.id),accountBrowserDirectory(root,second.id)]);
 await manager.close();
 const restored=new PlatformBrowserSessions(root,launch);
 t.after(()=>restored.close());
 assert.equal(restored.workWindow(first).artistId,artistB);
 assert.equal(restored.workWindow(second).artistId,artistA);
 await restored.open(first,url,guard,artistB);
 assert.equal(profiles[2],profiles[0]);
 const suno={id:randomUUID(),provider:'suno',name:'Suno 测试账号',dailyLimit:1};
 const sunoCn={id:randomUUID(),provider:'suno_cn',name:'苏诺之音测试账号',dailyLimit:1};
 const sunoCnInvite='https://11619989.share.suno.cn/home/#/?from=invite&invite_id=11619989';
 assert.equal(platformPageUrls.suno_cn,sunoCnInvite);
 await restored.open(suno,platformPageUrls.suno,guard);
 await restored.open(sunoCn,platformAccountLoginUrl(sunoCn.provider),guard);
 assert.deepEqual(visited.slice(-2),['https://suno.com/',sunoCnInvite]);
 assert.deepEqual(profiles.slice(-2),[accountBrowserDirectory(root,suno.id),accountBrowserDirectory(root,sunoCn.id)]);
 assert.equal(restored.workWindow(sunoCn).provider,'suno_cn');
});
