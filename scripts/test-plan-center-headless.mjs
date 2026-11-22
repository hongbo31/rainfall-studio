import { launchHeadlessChromium } from "./lib/headless-chromium.mjs";
import {build} from 'esbuild';
// Real built React UI + real isolated SQLite Core, with NO Main credentials/external executors.
import {chromium,expect} from '@playwright/test';
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import readline from 'node:readline';import assert from 'node:assert/strict';
process.chdir(path.resolve(import.meta.dirname, '..'));
const runtime=process.env.RAINFALL_TEST_RUNTIME==='node'?process.execPath:(await import('electron')).default;
const out=path.resolve('output/plan-center-headless-'+Date.now()),ui=path.resolve('build/ui');fs.mkdirSync(out,{recursive:true});
await build({stdin:{contents:'export {createPlanAlbumBroker} from "./src/main/plan-albums";export {executeInternalPlanAlbums} from "./src/core/plan-albums-integration";export {validate} from "./src/shared/schemas";',resolveDir:process.cwd()},outfile:path.resolve('output/album-integration/full-ui-main.cjs'),bundle:true,platform:'node',format:'cjs',packages:'external'});
const child=spawn(runtime,['tests/fixtures/plan-center-ui-host.cjs',path.join(out,'data')],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
let seq=0;const waiting=new Map(),errors=[],albumErrors=[],checks=[],screens=[];let childError='';child.stderr.on('data',b=>childError+=b);readline.createInterface({input:child.stdout}).on('line',line=>{try{const p=JSON.parse(line);const done=waiting.get(p.id);if(done){waiting.delete(p.id);done(p.result)}}catch{}});
const rpc=(method,input={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{waiting.delete(id);reject(Error('FIXTURE_RPC_TIMEOUT '+childError))},15000);waiting.set(id,r=>{clearTimeout(timer);if(method.startsWith('planAlbums.')&&!r.ok)albumErrors.push(r.error.code);resolve(r)});child.stdin.write(JSON.stringify({id,method,input})+'\n')});
const server=http.createServer(async(req,res)=>{if(req.url==='/rpc'&&req.method==='POST'){let b='';for await(const chunk of req)b+=chunk;if(b.length>1e6){res.writeHead(413).end();return}try{const q=JSON.parse(b),r=await rpc(q.method,q.input);res.setHeader('content-type','application/json');res.end(JSON.stringify(r))}catch(e){res.writeHead(500).end(JSON.stringify({error:e.message}))}return}if(req.url?.startsWith('/fixture-media/')){try{const result=await rpc('__fixture.asset',{id:req.url.slice('/fixture-media/'.length)});if(!result.ok)throw Error('ASSET_NOT_FOUND');res.setHeader('content-type',result.value.mime);res.end(Buffer.from(result.value.base64,'base64'));}catch{res.writeHead(404).end()}return}const file=path.resolve(ui,'.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));if(!file.startsWith(ui+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return}const ext=path.extname(file);res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[ext]??'application/octet-stream');res.end(ext==='.js'?fs.readFileSync(file,'utf8').replaceAll('media://asset/','/fixture-media/'):ext==='.html'?fs.readFileSync(file,'utf8').replace('media-src media:;',"media-src 'self' media:;"):fs.readFileSync(file))});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
let browser;try{
 browser=await launchHeadlessChromium(chromium, {args:['--no-startup-window','--disable-background-networking','--disable-sync','--no-first-run']});
 const page=await browser.newPage({viewport:{width:1480,height:1050},deviceScaleFactor:1});page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await page.exposeBinding('__fixtureRpc',(_source,method,input)=>rpc(method,input));await page.addInitScript(()=>{window.rainfall={call:async(method,input={})=>{if(method==='planCenter.preview'&&window.__mutateBeforePreview){window.__mutateBeforePreview=false;const rows=await window.__fixtureRpc('planCenter.list',{});const plan=rows.value.plans.find(p=>p.id===input.id);await window.__fixtureRpc('planCenter.save',{plan:{...plan,theme:plan.theme+' changed in another window'},expectedRevision:plan.revision});}return window.__fixtureRpc(method,input)},apiCredentialStatus:async()=>({ok:true,value:{configured:false,state:'absent'}}),productionFlow:async()=>({ok:true,value:{plans:[],runs:[]}}),liveText:async()=>({ok:true,value:[]}),liveMusic:async()=>({ok:true,value:null}),setMode:async()=>({ok:false,error:{code:'FIXTURE_ONLY',message:'仅离线夹具'}})};});
 await page.goto(origin);await page.getByRole('button',{name:'计划中心',exact:true}).click();await expect(page.getByRole('heading',{name:'计划中心',exact:true})).toBeVisible();
 await expect(page.getByText('高级选项',{exact:true})).toHaveCount(0);
 const workspace=(await rpc('snapshot')).value;
 const catalog=(await rpc('planCenter.catalog')).value;
 const artist=workspace.accountLocalArtists[0], textProfile=catalog.profiles.find(p=>p.kind==='text');
 await page.getByRole('button',{name:'＋ 新建计划',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'新建计划',exact:true});
 await expect(editor.getByRole('checkbox',{name:'生成封面',exact:true})).toBeChecked();
 await expect(editor.locator('fieldset > legend')).toHaveText(['封面配置','工作流程']);
 await expect(editor.getByText(/高级设置|启用定时执行/)).toHaveCount(0);
 await editor.getByLabel('名称',{exact:true}).fill('离线工作流');
 await editor.getByRole('combobox',{name:'艺人信息',exact:true}).selectOption(artist.id);
 const palette=editor.getByRole('group',{name:'流程模块'});
 await palette.getByRole('button',{name:'AI作词',exact:true}).click();
 await palette.getByRole('button',{name:'创作中心',exact:true}).click();
 await editor.getByRole('button',{name:'AI作词输出',exact:true}).press('Enter');
 await editor.getByRole('button',{name:'创作中心输入',exact:true}).press('Enter');
 await editor.getByRole('button',{name:'保存计划',exact:true}).click();
 const workflowRow=page.getByRole('row',{name:/离线工作流/});
 await expect(workflowRow).toBeVisible();
 const draft=(await rpc('__fixture.state')).value.plans[0];
 assert.equal(draft.outputs.cover,true);assert.equal(draft.enabled,false);
 await workflowRow.getByRole('button',{name:'删除',exact:true}).click();
 await page.getByRole('button',{name:'确认删除',exact:true}).click();
 await expect(workflowRow).toHaveCount(0);
 checks.push('Actual graph editor offers a checked cover option above the canvas and deletes an unused plan from its row');

 const legacy=await rpc('planCenter.save',{expectedRevision:null,plan:{
  id:crypto.randomUUID(),title:'离线两首素材计划',artistId:artist.id,count:2,
  schedule:{kind:'weekly',localTime:'09:30',weekdays:[1]},
  material:{source:'dot',channel:catalog.dot.channelId,identity:'creator'},
  outputs:{lyrics:true,cover:false,music:false},
  routing:{text:{source:'override',profileId:textProfile.id},image:{source:'default'},music:{source:'default'}},
  text:{profileId:textProfile.id,profileRevision:textProfile.revision,modelId:textProfile.modelId,budgetMicros:50_000,consent:true},
  music:{route:'manual'},authorization:{text:true,music:false,publish:false},
  publishTargets:['qqmusic','kugou'].map((platform,index)=>({
   platform,accountId:artist.accountId,enabled:true,album:{mode:'new',title:'离线专辑意向'+(index===0?'一':'二')},
  })),
 }});
 assert.equal(legacy.ok,true,legacy.error?.code);
 const planRow=page.getByRole('row',{name:/离线两首素材计划/});
 const details=page.getByRole('dialog',{name:'计划详情',exact:true});
 const result=details.getByRole('region',{name:'执行结果',exact:true});
 const runButton=planRow.getByRole('button',{name:'立刻执行',exact:true});
 await planRow.getByRole('button',{name:'编辑',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'编辑计划'}).getByText('时间安排',{exact:true})).toHaveCount(0);
 await page.getByText('其他平台设置',{exact:true}).click();
 for(const platform of ['netease','qishui','douyin']){const option=page.getByLabel('发布平台 1',{exact:true}).locator(`option[value="${platform}"]`);await expect(option).toHaveCount(1);await expect(option).toHaveJSProperty('disabled',true);await expect(option).toContainText('未实现，已禁用');}checks.push('Unimplemented album platforms are explicitly disabled in the actual plan form');
 const shot=async name=>{const f=path.join(out,name+'.png');await page.screenshot({path:f,fullPage:false});screens.push(f)};await shot('01-plan-editor');
 await page.getByRole('button',{name:'保存计划',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'编辑计划'})).toHaveCount(0);
 let state=(await rpc('__fixture.state')).value;
 assert.equal(state.plans.length,1);assert.equal(state.plans[0].count,2);assert.equal(state.plans[0].schedule.kind,'weekly');assert.equal(state.plans[0].enabled,false);
 await page.evaluate(()=>window.__mutateBeforePreview=true);
 await runButton.click();
 await expect(page.getByRole('alert')).toContainText('配置已变化');
 const modal=page.getByRole('dialog',{name:'立刻执行此计划？'});
 await expect(modal).toHaveCount(0);
 assert.equal((await rpc('__fixture.state')).value.runs.length,0);
 checks.push('Concurrent edit during preview rejects the stale plan and creates no run');
 await runButton.click();
 await expect(result.getByRole('heading',{name:'第 1 次执行',exact:true})).toBeVisible();
 await expect(modal).toHaveCount(0);
 await shot('02-run-started');
 await expect(runButton).toBeDisabled();
 state=(await rpc('__fixture.state')).value;
 assert.equal(state.runs.length,1);assert.equal(state.items.length,2);assert.equal(state.runs[0].source,'manual');assert.equal(state.occurrences.length,0);
 assert(state.items.every(i=>i.state==='waiting_external_dot'));
 await details.getByRole('button',{name:'停止后续步骤',exact:true}).click();
 await expect(result).toContainText('已停止本次');
 await details.getByRole('button',{name:'返回执行记录',exact:true}).click();
 await expect(details.getByRole('heading',{name:'执行记录（共 1 次）'})).toBeVisible();
 await details.getByRole('button',{name:/第 1 次执行.*已完成 0\/2/}).click();
 await expect(result).toContainText('已停止本次');
 await shot('03-plan-history');
 state=(await rpc('__fixture.state')).value;
 assert.equal(state.runs[0].stopRequested,true);assert.equal(state.plans[0].enabled,false);
 checks.push('Manual execution writes two items and shows the persisted status and results inside Plan Details');
 await details.getByRole('button',{name:'关闭',exact:true}).click();await planRow.getByRole('button',{name:'编辑',exact:true}).click();await page.getByLabel('生成音乐',{exact:true}).check();await page.getByLabel('音乐生成路由',{exact:true}).selectOption({label:'离线音乐配置'});await page.getByText('音乐生成与版本',{exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole('dialog')).toContainText('chirp-v6');await page.getByText('模型状态',{exact:true}).click();await expect(page.getByRole('dialog')).toContainText('当前账号可用性未获验证');await page.getByLabel('音乐总预算',{exact:true}).fill('300');await page.getByLabel('音乐单次预留',{exact:true}).fill('150');await page.getByLabel('授权音乐已有积分',{exact:true}).check();await shot('04-channel-capability');checks.push('Contract models are selectable, account history and current availability remain separate; explicit existing-credit policy and budgets are actionable');await page.getByRole('button',{name:'关闭',exact:true}).click();
 await expect(page.getByRole('button',{name:'手动模板',exact:true})).toHaveCount(0);checks.push('Retired template page is absent from navigation');
 const seeded=(await rpc('__fixture.materials')).value;
 await page.getByRole('button',{name:'计划中心',exact:true}).click();
 const materialRow=page.getByRole('row').filter({has:page.getByRole('rowheader',{name:seeded.title,exact:true})});await materialRow.getByRole('button',{name:'详情',exact:true}).click();await details.getByRole('button',{name:/已完成/}).click();
 await page.getByLabel('绑定已有作品 1',{exact:true}).selectOption(seeded.workId);await page.getByRole('button',{name:'绑定原始音频',exact:true}).click();await expect(page.getByRole('button',{name:'选择 B',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'选择 B',exact:true}).click();await expect(page.getByText('版本 B · 已选',{exact:true})).toBeVisible();
 await page.getByLabel('材料授权依据 1',{exact:true}).fill('本地原创验收素材：词曲、合成测试音和示例封面均由本测试创建。');await page.getByLabel('确认本版材料 1',{exact:true}).check();
 const cover=page.getByAltText('当前绑定封面');await expect(cover).toBeVisible();await expect.poll(()=>cover.evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true);
 const audio=page.getByLabel('试听版本 B',{exact:true});await audio.evaluate(el=>el.load());await expect.poll(()=>audio.evaluate(el=>el.readyState)).toBeGreaterThan(0);await shot('05-bound-versions-and-materials');
 await page.getByRole('button',{name:'确认材料并继续',exact:true}).click();for(let n=0;n<6;n++)await rpc('__fixture.tick');
 state=(await rpc('__fixture.state')).value;const bound=state.items.find(i=>i.id===seeded.itemId);assert.equal(bound.selectedVersion,'B');assert.equal(bound.materials.audioAssetId,seeded.audioB);assert.equal(state.runs.find(r=>r.id===seeded.runId).state,'completed');checks.push('Actual UI binds original A/B assets, loads real local tone metadata and original example cover, selects B, confirms rights/alignment, and completes local material preparation with no generation POST');
 assert.deepEqual(errors,[]);assert.deepEqual(albumErrors,[]);const report={passed:true,scope:'headless Chrome + actual isolated SQLite Core; synthetic profiles only; no native desktop GUI',screens,checks,errors,nativeGuiLaunched:false,externalExecutorsInstalled:false,formalDataTouched:false,mediaTransport:'fixture-only localhost path adaptation for the production media://asset scheme',out};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync('output/plan-center-headless-latest.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){const p=browser?.contexts()[0]?.pages()[0];if(p){fs.writeFileSync(path.join(out,'failure-body.txt'),await p.locator('body').innerText());await p.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:error.message,errors,childError},null,2));throw error;}finally{await browser?.close();await new Promise(r=>server.close(r));child.stdin.end();await new Promise(resolve=>{child.once('exit',resolve);setTimeout(()=>{if(child.exitCode===null)child.kill();resolve()},3000)});}
