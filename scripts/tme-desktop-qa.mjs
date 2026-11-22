import {_electron as electron} from '@playwright/test';import electronPath from 'electron';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {randomUUID,createHash} from 'node:crypto';import sharp from 'sharp';import assert from 'node:assert/strict';
import {windowsDesktopDirectory} from './lib/powershell-7.mjs';
import {readVerifiedDesktop,verifiedDesktopPointerPath} from './lib/verified-desktop.mjs';
const require=createRequire(import.meta.url),{Studio}=require('../build/core.cjs');
const run=path.resolve('output/playwright/tme-desktop-'+randomUUID()),root=path.join(run,'data');fs.mkdirSync(run,{recursive:true});
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const current=readVerifiedDesktop();
const productionDatabase=root=>path.join(root,'production','library.sqlite');
const protectedFiles=[verifiedDesktopPointerPath(),path.join(windowsDesktopDirectory(),'Rainfall Studio 音乐客户端.lnk'),productionDatabase(current.dataRoot)];
const legacy=process.env.APPDATA&&productionDatabase(path.join(process.env.APPDATA,'RainfallStudio'));
if(legacy&&fs.existsSync(legacy)&&!protectedFiles.includes(legacy))protectedFiles.push(legacy);
const before=Object.fromEntries(protectedFiles.map(p=>[p,hash(p)]));
const audio=path.join(run,'synthetic-fixture.wav'),rate=8000,n=rate*2,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.sin(i*2*Math.PI*220/rate)*500,44+i*2);fs.writeFileSync(audio,b);
const cover=path.join(run,'original-fixture.png');await sharp(Buffer.from('<svg width="1000" height="1000"><rect width="1000" height="1000" fill="#30273d"/><circle cx="650" cy="330" r="180" fill="#ae8bc2"/><text x="70" y="900" fill="white" font-size="50">LOCAL FIXTURE ONLY</text></svg>')).png().toFile(cover);
const proof=path.join(run,'fixture-proof.txt');fs.writeFileSync(proof,'LOCAL QA FIXTURE ONLY. Synthetic tone, original local test image. Not a real song or rights document.');
const s=new Studio(root,'production');const account=await s.call('account.save',{provider:'tme',name:'本地测试备注 · 非真实授权',dailyLimit:1});const work=s.saveWork({title:'本地合成样本 · 腾讯草稿验收',artistId:s.all('artists')[0].id,story:'仅本地QA，不是真实歌曲，不提交腾讯。',lyrics:'[Verse]\n测试雨声只在本地回响\n[Chorus]\n这是一段合成音调测试\n[雨声]\n不是真实歌曲也不会发布',prompt:'Isolated synthetic fixture, not a production song.',parameters:{},rights:'本地测试用原创建样本，无平台投递。',ai:'none'});
await s.importFile(audio,'audio_A',work.id);await s.importFile(cover,'cover',work.id);const proofAsset=await s.importFile(proof,'rights',work.id);s.close();
let app;const errors=[],requests=[],checks=[];
try{
 app=await electron.launch({executablePath:electronPath,args:['.'],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,RAINFALL_DATA_ROOT:root,RAINFALL_MODE:'production'},timeout:30000});
 await app.evaluate(({session})=>{globalThis.__tmeRequests=[];session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(d,cb)=>{globalThis.__tmeRequests.push(d.url);cb({cancel:true})})});
 const page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,1000));
 await page.getByRole('button',{name:'发布中心',exact:true}).click();await page.getByRole('button',{name:'腾讯音乐人草稿通道 →',exact:true}).click();
 await page.getByTestId('tme-draft-studio').waitFor();assert.equal(await page.getByLabel('本人是否作词人',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('腾讯是否AI音乐').inputValue(),'unknown');checks.push('Author/AI confirmations start unknown, no implicit authorship');
 await page.getByLabel('腾讯试传作品').selectOption(work.id);await page.getByLabel('腾讯账号备注').selectOption(account.id);await page.waitForFunction(()=>document.querySelector('[aria-label="腾讯正式歌词"]').value.includes('测试雨声'));
 assert((await page.getByLabel('腾讯原始歌词').inputValue()).includes('[Verse]'));assert(!(await page.getByLabel('腾讯正式歌词').inputValue()).includes('[Verse]'));assert((await page.getByLabel('腾讯正式歌词').inputValue()).includes('[雨声]'));checks.push('Original lyrics retained, known tags removed, unknown bracketed content preserved');
 await page.getByLabel('腾讯作词署名').fill('本地测试署名');await page.getByLabel('腾讯作曲署名').fill('本地测试署名');await page.getByLabel('本人是否作词人',{exact:true}).selectOption('false');await page.getByLabel('本人是否作曲人',{exact:true}).selectOption('false');await page.getByLabel('腾讯是否AI音乐').selectOption('no');await page.getByLabel('腾讯创作证明').selectOption(proofAsset.id);
 await page.getByRole('button',{name:'运行本地预检',exact:true}).click();
 for(const label of ['作品权利及已有证明真实有效','作词 / 作曲署名及本人身份已核实','AI 音乐声明、工具和日期已核实','已检查原稿与正式歌词清理差异','已试听选定音频，正式歌词逐行与音频一致'])await page.getByRole('checkbox',{name:label,exact:true}).check();
 await page.getByRole('button',{name:'保存本地待核对任务',exact:true}).click();await page.getByText('预检通过 · 待核对真实账号',{exact:true}).waitFor();checks.push('Explicit local fixture confirmations create a persistent awaiting-account task');
 await page.getByRole('button',{name:'只读检查浏览器连接',exact:true}).click();await page.getByText(/尚未连接用户已授权的浏览器会话/).waitFor();assert(await page.getByRole('button',{name:'仅上传并保存草稿',exact:true}).isDisabled());assert.equal(await page.getByRole('button',{name:'提交审核',exact:true}).count(),0);checks.push('Missing authorized connection blocks actual uploads; no review submission button');
 await page.screenshot({path:path.join(run,'studio-full.png'),fullPage:true});await page.getByRole('heading',{name:'资料预检 · 确认当前版本',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(run,'metadata-preview.png')});await page.getByRole('heading',{name:'草稿任务与状态回读',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(run,'draft-status.png')});
 requests.push(...await app.evaluate(()=>globalThis.__tmeRequests));assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await app.close();app=undefined;
 const persisted=new Studio(root,'production');try{const rows=await persisted.call('tme.list');assert.equal(rows.length,1);assert.equal(rows[0].state,'AWAITING_ACCOUNT');assert.equal(rows[0].remote,null);assert.equal(persisted.get('works',work.id).lyrics,work.lyrics);}finally{persisted.close()}
 assert.deepEqual(Object.fromEntries(protectedFiles.map(p=>[p,hash(p)])),before);checks.push('Local draft persists, original lyrics unchanged, existing desktop/data hashes unchanged');
 fs.writeFileSync(path.join(run,'report.json'),JSON.stringify({passed:true,checks,source:'isolated-local-fixture',realUploads:0,reviewSubmissions:0,rendererErrors:errors,observedElectronRequests:requests,productionPageVerified:false,root},null,2));console.log(JSON.stringify({passed:true,run,checks},null,2));
}finally{if(app)await app.close();}
