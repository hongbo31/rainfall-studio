// Isolated packaged-app acceptance. No provider keys, paid generation or site writes.
import {_electron} from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const executablePath=path.resolve(process.argv[2]);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-new-device-'));
const out=path.resolve('output/automation-desktop');fs.mkdirSync(out,{recursive:true});
const env={...process.env,ELECTRON_RUN_AS_NODE:undefined,RAINFALL_DATA_ROOT:root,RAINFALL_MODE:'production',RAINFALL_OFFLINE_ACCEPTANCE:'',CODEX_HOME:undefined};
let app,page;
const launch=async()=>{app=await _electron.launch({executablePath,env,timeout:30000});page=await app.firstWindow();page.setDefaultTimeout(10000);await page.getByRole('button',{name:/配置中心/}).waitFor();};
const call=async(method,input={})=>{const r=await page.evaluate(({method,input})=>window.rainfall.call(method,input),{method,input});assert(r.ok,JSON.stringify(r.error));return r.value;};
try{
 await launch();const snapshot=await call('snapshot');assert.equal(snapshot.works.length,0);
 const work=await call('work.save',{title:'独立设备收图验收',artistId:snapshot.artists[0].id,story:'雨后回家',lyrics:'[Verse]\n灯光照着回家的路\n[Chorus]\n为你留一盏灯',prompt:'温暖窗边，方形构图',parameters:{},rights:'Isolated fixture only',ai:'generated'});
 await page.reload();await page.getByRole('button',{name:/封面工作室/}).click();
 await page.getByRole('button',{name:'自动收图',exact:true}).click();
 const directory=await page.getByRole('textbox',{name:'图片保存目录'}).inputValue();
 assert(directory.startsWith(root+path.sep));
 await sharp({create:{width:1440,height:1440,channels:3,background:'#7888ac'}}).png().toFile(path.join(directory,'cover.png'));
 await page.getByText('封面已匹配',{exact:true}).waitFor({timeout:20000});
 await page.waitForFunction(()=>[...document.images].some(i=>i.alt==='独立设备收图验收 封面'&&i.naturalWidth===1440));
 await page.screenshot({path:path.join(out,'cover.png')});
 await page.getByRole('button',{name:/计划中心/}).first().click();
 assert.equal(await page.getByText('后台运行设置',{exact:true}).count(),1);
 await page.getByText('后台运行设置',{exact:true}).click();
 await page.getByRole('checkbox',{name:'关闭窗口后继续执行'}).check();
 await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByText('已保存',{exact:true}).waitFor();
 assert.deepEqual(await call('runtime.settings'),{backgroundEnabled:true,loginAtStartup:false});
 const hidden=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.close();return{alive:!w.isDestroyed(),visible:w.isVisible()}});
 assert.deepEqual(hidden,{alive:true,visible:false});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
 await app.close();await launch();assert.deepEqual(await call('runtime.settings'),{backgroundEnabled:true,loginAtStartup:false});
 assert.equal((await call('snapshot')).works[0].id,work.id);
 const report={executablePath,root,at:new Date().toISOString(),runtime:await call('runtime'),freshRoot:true,coverInboxMatched:true,previewWidth:1440,backgroundClose:true,restartPreserved:true,loginRegistrationTested:false,liveProviderCalls:false};
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app?.close();}
