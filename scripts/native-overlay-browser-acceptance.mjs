import { launchHeadlessChromium } from "./lib/headless-chromium.mjs";
// Real Chromium DOM with locally fulfilled, explicitly labelled fixture pages. No live Tencent traffic.
import {chromium} from 'playwright-core';import {build} from 'esbuild';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const bundle=await build({entryPoints:['src/main/tme/page-overlays.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {TmePageOverlayGuard}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const out=path.resolve('output/playwright/native-popup-fixtures-'+Date.now());fs.mkdirSync(out,{recursive:true});
const browser=await launchHeadlessChromium(chromium);
const checks=[],screens=[];let fulfilled=0;
const scope=async()=>({subject:'isolated-local-fixture',binding:'owned-fresh-browser',materials:'no-real-song'});
const home='https://y.tencentmusic.com/#/user/musician/index';
const shell=body=>`<!doctype html><meta charset="utf-8"><title>离线弹层验收夹具</title><style>body{background:#15121b;color:#eee;font:20px sans-serif;padding:40px}.el-dialog{margin:60px auto;padding:35px;background:#2d2639;border:1px solid #9072ab;width:600px}button{padding:12px;margin:20px;background:#b799d0;border:0;border-radius:8px}</style><h1>本地浏览器弹层夹具</h1><p>原创测试页面 · 非腾讯实站 · 无真实账号和歌曲</p>${body}`;
async function fixture(html){const p=await browser.newPage({viewport:{width:1280,height:900}});await p.route('**/*',r=>{fulfilled++;return r.fulfill({status:200,contentType:'text/html',body:shell(html)})});await p.goto(home);return p;}
try{
 let p=await fixture('<div class="el-dialog" aria-modal="true"><h2 class="upgrade-dialog__content__title">音乐人指数全新改版</h2><button class="upgrade-dialog__content--arrow" onclick="window.closeCount=(window.closeCount||0)+1;this.parentElement.remove()">收起示例</button></div>');
 const good=await new TmePageOverlayGuard(p,scope).run();assert.equal(good.status,'clear');assert.equal(await p.evaluate(()=>window.closeCount),1);checks.push('Recognized exact homepage notice closes once and re-observes clear on real DOM');await p.close();
 for(const [name,text]of [['unknown','未知弹层'],['terms','同意用户协议'],['login','登录账号'],['captcha','请输入验证码']]){
  p=await fixture(`<div class="el-dialog" aria-modal="true"><h2>${text}</h2><button onclick="window.mutations=(window.mutations||0)+1">确认</button></div>`);
  await assert.rejects(new TmePageOverlayGuard(p,scope).run(),/OVERLAY/);assert.equal(await p.evaluate(()=>window.mutations||0),0);
  const file=path.join(out,name+'-blocked.png');await p.screenshot({path:file});screens.push(file);checks.push(name+' remains blocked with zero clicks on real DOM');await p.close();
 }
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,scope:'real Chromium with offline page fixtures, not live Tencent',checks,screens,fulfilledLocalResponses:fulfilled,realTencentRequests:0},null,2));console.log(JSON.stringify({passed:true,report:path.join(out,'report.json'),checks}));
}finally{await browser.close()}
