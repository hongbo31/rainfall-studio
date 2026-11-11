// Offline visual check of the real component; no desktop profile or backend connection.
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import sharp from 'sharp';import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('output/playwright/cover-layout');fs.mkdirSync(out,{recursive:true});
await build({stdin:{contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import './src/renderer/ui-system.css';import './src/renderer/plan-center.css';import './src/renderer/themes.css';
import {Context} from './src/renderer/context';import CoverStudio from './src/renderer/pages/CoverStudio';
const work={id:'preview-work',title:'留一盏灯',story:'下班回家，留灯，一起吃晚饭，把平常陪伴写成对以后的期待。',config:{genre:'温柔恋爱流行',mood:'温柔'},assets:{cover:'preview-cover'},assetHistory:['preview-cover']};
window.calls=[];
const value={data:{works:[work],assets:[{id:'preview-cover',kind:'image',label:'封面',metadata:{width:1440,height:1440},sha256:'preview000000'}],artists:[]},call:async(method,input)=>{window.calls.push({method,input});return method==='cover.task'?{text:'离线预览提示词'}:{requests:[],receipts:[]}},importAsset:async(...args)=>{window.calls.push({import:args})},exportArtifact:async(...args)=>{window.calls.push({export:args})}};
createRoot(document.getElementById('root')).render(<Context.Provider value={value}><main style={{margin:0,padding:32}}><CoverStudio/></main></Context.Provider>);
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,outfile:path.join(out,'fixture.js'),format:'iife',platform:'browser'});
const fixtureCover=await sharp({create:{width:1440,height:1440,channels:3,background:'#d7e2f0'}}).jpeg().toBuffer();
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({serviceWorkers:'block'});
 const cover=await sharp({create:{width:1440,height:1440,channels:3,background:'#d7e2f0'}}).jpeg().toBuffer();
 await context.route('**/*',route=>{
  const url=route.request().url();
  if(url.startsWith('media://asset/'))return route.fulfill({contentType:'image/jpeg',body:cover});
  if(url.endsWith('/fixture.js'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(out,'fixture.js'))});
  if(url.endsWith('/fixture.css'))return route.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(out,'fixture.css'))});
  if(url==='https://layout.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html data-theme="white"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><body><div id="root"></div><script src="/fixture.js"></script></body></html>'});
  return route.abort();
 });
 const page=await context.newPage();await page.goto('https://layout.test/');await page.getByRole('heading',{name:'封面工作室',exact:true}).waitFor();
 const results=[];
 for(const [width,theme] of [[1440,'white'],[1080,'white'],[760,'white'],[1440,'original']]){
  await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.screenshot({path:path.join(out,`cover-${width}-${theme}.png`),fullPage:true});
  const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,buttons:[...document.querySelectorAll('.cover-import-row button,.cover-export-actions button.primary')].map(b=>b.getBoundingClientRect().height)}));
  assert.equal(metrics.overflow,false);assert.deepEqual(metrics.buttons,[40,40]);results.push({width,theme,...metrics});
 }
 await page.getByRole('button',{name:'导入本地封面',exact:true}).click();
 await page.getByRole('button',{name:'导出封面',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>c.import||c.export)),[{import:['cover','preview-work']},{export:['cover',{workId:'preview-work',size:3000,noText:true}]}]);
 await page.getByText('提示词与外部出图',{exact:true}).click();await page.getByRole('button',{name:'生成提示词',exact:true}).click();
 assert.equal(await page.getByLabel('封面任务文本').inputValue(),'离线预览提示词');
 await page.getByText('外部出图请求与接收',{exact:true}).click();assert(await page.getByRole('button',{name:'保存请求',exact:true}).isVisible());
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({offline:true,results,importExportVerified:true,advancedControlsReachable:true},null,2));console.log(JSON.stringify({out,results}));
}finally{await browser.close();}
