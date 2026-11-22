import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {chromium} from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {build} from 'esbuild';
import {installFanqieNativeSite} from './fixtures/fanqie-native-site.mjs';
const require=createRequire(import.meta.url);
const {nativeFanqiePage}=require('../output/fanqie-tests/upload.cjs');
const {probeFanqieForm}=require('../output/fanqie-tests/core.cjs');
const {readFanqieArtists}=require('../output/fanqie-tests/core.cjs');
const {readFanqieCatalog,readFanqieCatalogPages,checkFanqieNewUpload}=require('../output/fanqie-tests/core.cjs');
const {FanqieUploadBroker}=require('../output/fanqie-tests/upload.cjs');
const {FanqieCatalogSession}=require('../output/fanqie-tests/session.cjs');

test('a duplicate on a later catalog page remains visible to preflight',async t=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});
 t.after(()=>browser.close());
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`
  <meta charset="utf-8"><div role="tab" aria-selected="true">全部·2</div>
  <input placeholder="请输入作品名称"><section role="tabpanel">
   <table><thead><tr><th>作品信息</th><th>作品状态</th><th>创建时间</th><th>上架时间</th><th>操作</th></tr></thead>
   <tbody><tr><td><div>第一页</div><div>作品ID：9876543210987654321</div></td><td>审核中</td><td>今天</td><td>-</td><td></td></tr></tbody></table>
   <div class="arco-table-pagination"><ul>
    <li aria-current="true" class="arco-pagination-item-active">1</li>
    <li aria-label="下一页" class="arco-pagination-item-next">›</li>
   </ul></div>
  </section><script>
   document.querySelector('.arco-pagination-item-next').onclick=()=>{
    document.querySelector('.arco-pagination-item-active').textContent='2';
    setTimeout(()=>{
     const cells=document.querySelector('tbody tr').cells;
     cells[0].innerHTML='<div class="task-title-content-main"><div class="music-ellipsis-text">第二页重复作品</div><div class="music-ellipsis-text music-ellipsis-holder">截断副本</div></div>'+
       '<div>原创音乐 · 单曲</div><div class="task-title-content-desc"><div class="music-ellipsis-text">作品 ID ： ９８７６５４３２１０９８７６５４３２２</div><button>复制</button></div>';
     cells[1].textContent='处理中';
    },300);
   };
  </script>`}));
 const page=await context.newPage();
 await page.goto('https://www.novelfm.com/creator/music/finished/ugc');
 const first=await readFanqieCatalog({url:async()=>page.url(),playwright:page});
 assert.equal(first.complete,false);
 const full=await readFanqieCatalogPages(page,()=>{});
 assert.equal(full.complete,true);
 assert.deepEqual(full.rows.map(row=>row.id),['9876543210987654321','9876543210987654322']);
 assert.equal(full.rows[1].stage,'unknown');
 assert.equal(checkFanqieNewUpload(full,'第二页重复作品').reason,'FANQIE_OFFICIAL_RECORD_ALREADY_EXISTS');
});

test('artist reader waits for the roster after its search field has already mounted',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});
 try{
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><input aria-label="请输入艺人名"><script>setTimeout(()=>{document.body.insertAdjacentHTML('beforeend','<div class="artist-item"><div class="artist-name">测试艺人</div><div>艺人ID：123456789</div></div>')},700)</script>`}));
  const page=await context.newPage();await page.goto('https://www.novelfm.com/creator/music/account/artist');
  const result=await readFanqieArtists(nativeFanqiePage(page));assert.deepEqual(result.artists,[{artistId:'123456789',name:'测试艺人'}]);
 }finally{await browser.close();}
});

test('an open account detects a delayed login redirect and turns valid after signing in', async t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-fanqie-login-'));
 const context=await chromium.launchPersistentContext(path.join(root,'profile'),{channel:'chrome',headless:true,serviceWorkers:'block'});
 t.after(async()=>{await context.close();fs.rmSync(root,{recursive:true,force:true});});
 const origin='https://www.novelfm.com', home=origin+'/creator/music/home';
 let signedIn=false, inlineSignIn=false, profileReads=0;
 const now=Date.now.bind(Date);
 let elapsed=0;
 t.mock.method(Date,'now',()=>now()+elapsed);
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin)return route.abort();
  const form='<input placeholder="请输入手机号"><input placeholder="请输入验证码"><button>登录/注册</button>';
  let body='创作首页';
  if(url.pathname==='/creator/music/login')body=form;
  if(url.pathname==='/creator/music/account/profile'){
   profileReads++;
   body=signedIn?'<div class="profile-desc"><span>UID</span><div>12345678</div></div>':inlineSignIn?form:
    '<script>setTimeout(()=>location.replace("/creator/music/login"),350)</script>';
  }
  return route.fulfill({contentType:'text/html; charset=utf-8',body});
 });
 const session=new FanqieCatalogSession({root,available:()=>true,generation:()=>1,launch:async()=>context});
 await session.ui('open');
 const [primary]=context.pages();
 const extraTabs=[];
 context.on('page',page=>extraTabs.push(page));
 assert.equal(await session.loginState(),'expired');
 assert.equal(primary.url(),home);
 assert.equal(context.pages().length,1);
 signedIn=true;
 elapsed=6_000;
 assert.equal(await session.loginState(),'valid');
 signedIn=false;
 inlineSignIn=true;
 elapsed=37_000;
 assert.equal(await session.loginState(),'expired');
 assert.equal(primary.url(),home);
 assert.equal(context.pages().length,1);
 assert.equal(profileReads,3);
 assert.deepEqual(extraTabs,[]);
});

async function nativeFixture(t, options={}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-native-flow-'));
 const context=await chromium.launchPersistentContext(path.join(root,'browser-profile'),{channel:'chrome',headless:true,chromiumSandbox:true,serviceWorkers:'block',acceptDownloads:false});
 t.after(async()=>{await context.close();fs.rmSync(root,{recursive:true,force:true});});
 const dataSize=44100*4*31,wav=Buffer.alloc(44+dataSize);
 wav.write('RIFF');wav.writeUInt32LE(36+dataSize,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(44100*4,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(dataSize,40);
 const cover=await sharp({create:{width:1440,height:1440,channels:3,background:'#123456'}}).png().toBuffer();
 const files={audio:'合成音频.wav',lyrics:'合成歌词.txt',cover:'合成封面.png'};
 for(const [role,bytes] of Object.entries({audio:wav,lyrics:Buffer.from('仅用于离线测试的合成歌词'),cover}))fs.writeFileSync(path.join(root,files[role]),bytes);
 const title='离线新作品',artist='合成艺人';
 const site=await installFanqieNativeSite(context,{title,artist,accountId:'12345678',cover,countDelay:350,...options});
 const manifest=path.join(root,'bundle.json');fs.writeFileSync(manifest,JSON.stringify({version:1,title,ai:true,musicType:'original',authors:{lyricist:artist,composer:artist,singer:artist},files}));
 const session=new FanqieCatalogSession({root,available:()=>true,generation:()=>1,launch:async()=>context});
 const asset=role=>{const file=path.join(root,files[role]);return{file,bytes:fs.statSync(file).size,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')};};
 const broker=new FanqieUploadBroker({root,session,available:()=>true,generation:()=>1,pickBundle:async()=>manifest,
  work:async selection=>({...selection,title,artistId:'00000000-0000-4000-8000-000000000001',ai:'generated',
   ...(options.instrumental?{lyrics:'',instrumental:true}:{lyrics:'仅用于离线测试的合成歌词'}),
   audio:asset('audio'),cover:asset('cover'),fingerprint:'synthetic-current-work'})});
 await session.ui('open');
 return {root,context,site,session,broker,title,files,artist};
}
test('native Playwright snapshot recognizes the calibrated single-song form',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});
 try{
  const context=await browser.newContext({serviceWorkers:'block'});
  // Every request is intercepted; no official network request or upload is sent.
  await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html lang="zh"><meta charset="utf-8"><body><form>
   <p>上传歌曲信息 授权签约模式 预览合同协议</p><div>歌曲1: 合成测试</div>
   <label for="songs_0_name_input">作品名称</label><input id="songs_0_name_input" value="合成测试">
   <div>音乐类型</div><div>完整歌曲</div><div>歌词</div><div>词作者</div><div>曲作者</div><div>歌手</div><div>歌曲封面</div><div>是否为AI作品</div>
  </form></body></html>`}));
  const page=await context.newPage();await page.goto('https://www.novelfm.com/creator/music/finished/ugc/uploadProduct');
  const result=await probeFanqieForm(nativeFanqiePage(page));assert.equal(result.songCount,1);assert.equal(result.firstStepObserved,true,await page.locator('body').ariaSnapshot());
 }finally{await browser.close();}
});

test('native broker reads delayed catalog, uploads once, verifies saved ID and refuses a duplicate', {timeout:60000},async t=>{
 const f=await nativeFixture(t);
 const foregroundTabs=t.mock.method(f.context,'newPage');
 const read=await f.session.ui('read');assert.equal(read.report.complete,true);assert.equal(read.report.total,1);
 assert.equal(read.report.rows[0].stage,'unknown');
 assert.equal(checkFanqieNewUpload(read.report,'已有合成作品').reason,'FANQIE_OFFICIAL_RECORD_ALREADY_EXISTS');
 assert.equal(foregroundTabs.mock.callCount(),0,'Catalog reads must stay in the background');
 const selection={workId:'00000000-0000-4000-8000-000000000003',variant:'A'};
 await assert.rejects(f.broker.ui('publishConfigured',selection),/FANQIE_CONFIGURATION_REQUIRED/);
 await f.broker.ui('saveConfiguration',{version:1,authors:{lyricist:f.artist,composer:f.artist,singer:f.artist},useWorkMaterials:true,publicationConsent:true});
 const done=await f.broker.ui('publishConfigured',selection);
 assert.equal(foregroundTabs.mock.callCount(),1,'Only the upload editor may open in the foreground');
 assert.equal(done.jobs[0].phase,'contract_pending');assert.equal(done.jobs[0].officialRecord.id,'9876543210987654321');
 const picked=f.site.events.filter(event=>event.kind==='file');assert.deepEqual(picked.map(event=>event.role),['audio','lyrics','cover']);
 const saved=JSON.parse(fs.readFileSync(path.join(f.root,'production/fanqie/uploads',done.jobs[0].id+'.json'),'utf8'));
 for(const event of picked){const material=saved.input.assets[event.role];assert.equal(event.files.length,1);assert.equal(event.files[0].name,path.basename(material.file));assert.equal(event.files[0].sha256,createHash('sha256').update(fs.readFileSync(material.file)).digest('hex'));}
 assert.deepEqual(f.site.events.filter(event=>event.kind==='credit').map(event=>event.role),['lyricist_id_list','composer_id_list','singer_id_list']);
 assert.equal(f.site.events.filter(event=>event.kind==='crop').length,1);assert.equal(f.site.events.filter(event=>event.kind==='confirm-upload').length,1);
 assert.equal(f.site.events.some(event=>event.kind==='SIGN_FORBIDDEN'),false);
 const count=f.site.events.length;
 const duplicate=await f.broker.ui('check',{title:f.title});assert.equal(duplicate.result.reason,'FANQIE_OFFICIAL_RECORD_ALREADY_EXISTS');
 const again=await f.broker.ui('prepare',{rightsConfirmed:true,lyricsMatchConfirmed:true});assert.equal(again.ready,false);assert.equal(f.site.events.length,count);
 assert.deepEqual(f.site.failures,[]);
 const editor=f.context.pages().find(page=>page.url().endsWith('/uploadProduct'));assert(editor);assert.equal(await editor.getByRole('heading',{name:'选择签约模式',exact:true}).count(),1);
});

test('native upload stops after account changes and preserves the uncertain operation', {timeout:60000},async t=>{
 let uid='12345678';
 const f=await nativeFixture(t,{accountId:()=>uid,beforeEvent:event=>{if(event.kind==='credit')uid='87654321';}});
 await f.broker.ui('pick');const ready=await f.broker.ui('prepare',{rightsConfirmed:true,lyricsMatchConfirmed:true});
 await assert.rejects(f.broker.ui('upload',{token:ready.token,consent:true}),/FANQIE_CATALOG_SCOPE_CHANGED/);
 assert.equal(f.broker.status().jobs[0].phase,'unknown');assert.equal(f.site.events.some(event=>event.kind==='file'||event.kind==='confirm-upload'),false);
 assert.equal(f.context.pages().filter(page=>page.url().endsWith('/uploadProduct')).length,1);assert.deepEqual(f.site.failures,[]);
});

test('instrumental form uploads audio and cover and omits lyrics and lyricist', {timeout:60000},async t=>{
 const f=await nativeFixture(t,{instrumental:true});
 await f.broker.ui('saveConfiguration',{version:1,authors:{lyricist:'Unused',composer:f.artist,singer:f.artist},useWorkMaterials:true,publicationConsent:true});
 const result=await f.broker.ui('publishConfigured',{workId:'00000000-0000-4000-8000-000000000003',variant:'A'});
 assert.equal(result.jobs[0].phase,'contract_pending');
 assert.deepEqual(f.site.events.filter(e=>e.kind==='file').map(e=>e.role),['audio','cover']);
 assert.deepEqual(f.site.events.filter(e=>e.kind==='credit').map(e=>e.role),['composer_id_list','singer_id_list']);
 assert.equal(f.site.events.filter(e=>e.kind==='confirm-upload').length,1);
 assert.deepEqual(f.site.failures,[]);
});

test('library upload UI binds the exact version and invalidates prepared materials after editing',async()=>{
 const built=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Panel from './src/renderer/components/FanqieUploadPanel';
 const work={id:'00000000-0000-4000-8000-000000000003',title:'测试作品',ai:'generated',assets:{audio_A:'a',audio_B:'b'},publicationMetadata:{lyricist:'测试艺人',composer:'测试艺人',singer:'测试艺人'}};
 let bundle=null;window.calls=[];window.rainfall={fanqieCatalog:async()=>({ok:true,value:{}}),fanqieUpload:async(action,input)=>{window.calls.push({action,input});if(action==='selectWork')bundle={title:work.title,ai:input.ai,authors:input.authors,source:{workId:input.workId,variant:input.variant},files:{audio:{name:'测试.wav',bytes:123}}};return{ok:true,value:{bundle,ready:action==='prepare',token:'test',jobs:[]}};}};
 createRoot(document.getElementById('root')).render(<Panel mode="production" works={[work]}/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife'});
 const browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});
 try{
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><div id="root"></div><script>'+built.outputFiles[0].text+'</script>'}));
  const page=await context.newPage();await page.goto('https://fixture.invalid');
  await page.getByLabel('番茄上传作品').selectOption('00000000-0000-4000-8000-000000000003');await page.getByLabel('番茄音频版本').selectOption('B');
  await page.getByLabel('歌词与所选音频一致，署名及素材使用权已确认').check();
  await page.getByRole('button',{name:'上传番茄',exact:true}).click();
  const calls=await page.evaluate(()=>window.calls);const selected=calls.find(call=>call.action==='publishWork');assert.equal(selected.input.variant,'B');assert.equal(selected.input.rightsConfirmed,true);
  await page.getByLabel('番茄音频版本').selectOption('A');assert.equal(await page.getByRole('button',{name:'上传番茄',exact:true}).isEnabled(),false);
  assert.equal(calls.some(call=>['selectWork','prepare','upload','recoverOpening'].includes(call.action)),false);
 }finally{await browser.close();}
});
