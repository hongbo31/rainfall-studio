import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import {createRequire} from 'node:module';

test('browser workbench reuses publication requests and Tencent advances while Fanqie waits',async t=>{
 const built=await build({entryPoints:['src/main/publish-workbench.ts'],bundle:true,platform:'node',format:'esm',write:false});
 const {startPublishWorkbench}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].contents).toString('base64'));
 const workId=randomUUID(),audioId=randomUUID(),accountId=randomUUID();
 const selection={workIds:[],targets:[],accountOverrides:{qqmusic:accountId}};
 const data={mode:'production',works:[{id:workId,title:'隔离测试歌曲',assets:{audio_A:audioId},revision:1}],
  assets:[{id:audioId,kind:'audio',bytes:123,sha256:'a'.repeat(64)}],artists:[],accounts:[{id:accountId,provider:'tme',name:'离线腾讯账号'}],
  targets:[],platformConfigurations:[],materialWorkbench:{materials:[],sources:[]},publishSelection:selection};
 const calls=[];
 let finishFanqie;
 const waiting=new Promise(resolve=>{finishFanqie=resolve;});
 const server=startPublishWorkbench(path.resolve('build/ui'),async request=>{
  calls.push(request);
  if(request.channel==='fanqieUpload'){
   if(request.method==='configuration')return {ok:true,value:{configuration:{}}};
   if(request.method==='publishBatch'){await waiting;return {ok:false,error:{message:'番茄登录已过期'}};}
  }
  if(request.channel==='fanqieCatalog')return {ok:true,value:{connected:false}};
  if(request.method==='snapshot')return {ok:true,value:data};
  if(request.method==='publish.selection.save'){data.publishSelection=request.input;return {ok:true,value:request.input};}
  if(request.method==='publish.simple')return {ok:true,value:{requests:[],pipeline:[],reused:false}};
  return {ok:false,error:{message:'unexpected'}};
 });
 t.after(()=>{finishFanqie();server.close();});
 const url=await server.ready,origin=new URL(url).origin,key=new URL(url).hash.slice(1);
 const post=(method,headers)=>fetch(origin+'/rpc',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({channel:'call',method,input:{}})});
 assert.equal((await post('snapshot',{Origin:origin})).status,403);
 assert.equal((await post('snapshot',{Origin:'https://unrelated.invalid',Authorization:'Bearer '+key})).status,403);
 assert.equal((await post('account.save',{Origin:origin,Authorization:'Bearer '+key})).status,403);
 const browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});
 t.after(()=>browser.close());
 const page=await browser.newPage();
 const failures=[];
 page.on('pageerror',error=>failures.push(error.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 await page.goto(url);
 await page.getByRole('checkbox',{name:'选择歌曲 隔离测试歌曲'}).check();
 await page.getByRole('checkbox',{name:'发布到 番茄音乐'}).check();
 await page.getByRole('checkbox',{name:'发布到 QQ 音乐'}).check();
 const publish=page.getByRole('button',{name:'发布所选作品'});
 await publish.evaluate(button=>{button.click();button.click();});
 await page.getByText('QQ 音乐 · 已整理发布材料',{exact:true}).waitFor();
 assert.equal(calls.filter(r=>r.method==='publishBatch').length,1);
 assert.equal(calls.filter(r=>r.method==='publish.simple').length,1);
 assert.deepEqual(calls.find(r=>r.method==='publish.simple').input.targets,['qqmusic']);
 finishFanqie();
 await page.getByRole('alert').filter({hasText:'番茄登录已过期'}).waitFor();
 await page.reload();
 await page.getByRole('heading',{name:'发布中心'}).waitFor();
 assert.equal(await page.getByRole('checkbox',{name:'选择歌曲 隔离测试歌曲'}).isChecked(),true);
 assert.deepEqual(failures,[]);
});

test('account windows use separate profiles and retain the last artist on reopening',async t=>{
 const bundle=path.resolve('output/work-window-fixture.cjs');
 await build({entryPoints:['src/main/browser-accounts.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:bundle});
 const {PlatformBrowserSessions,accountBrowserDirectory}=createRequire(import.meta.url)(bundle);
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rainfall-work-windows-'));
 const profiles=[];
 const launch=async profile=>{
  profiles.push(profile);await fs.mkdir(profile,{recursive:true});
  const context=new EventEmitter();
  let url='about:blank';
  const page={url:()=>url,goto:async next=>{url=new URL(next).href;},isClosed:()=>false,bringToFront:async()=>{}};
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
});
