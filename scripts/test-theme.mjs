import { launchHeadlessChromium } from "./lib/headless-chromium.mjs";
import {build} from 'esbuild';import {chromium,expect} from '@playwright/test';import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import {spawn} from 'node:child_process';import readline from 'node:readline';import electron from 'electron';import assert from 'node:assert/strict';
const base=path.resolve('output/provider-directory-acceptance'),out=path.join(base,'theme-'+Date.now()),data=path.join(out,'data'),ui=path.resolve('build/ui');fs.mkdirSync(out,{recursive:true});
await build({stdin:{contents:"export {createProviderTextBroker} from './src/main/provider-text';export {ProviderTextAdapter} from './src/core/workflow/provider-text';",resolveDir:process.cwd()},outfile:path.join(base,'qa.cjs'),bundle:true,platform:'node',format:'cjs',packages:'external'});
const child=spawn(electron,['tests/fixtures/provider-directory-ui-host.cjs',data],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});let seq=0,stderr='';const waiting=new Map(),errors=[],checks=[],screens=[];child.stderr.on('data',b=>stderr+=b);readline.createInterface({input:child.stdout}).on('line',line=>{try{const row=JSON.parse(line),done=waiting.get(row.id);if(done){waiting.delete(row.id);done(row.result)}}catch{}});
const emptyCoverRequests=[];
const rpc=(method,input={})=>{if(method==='cover.list'&&!input.workId)emptyCoverRequests.push(input);return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{waiting.delete(id);reject(Error('QA_TIMEOUT '+method+' '+stderr))},20000);waiting.set(id,r=>{clearTimeout(timer);resolve(r)});child.stdin.write(JSON.stringify({id,method,input})+'\n')});};
const draftTitle='雨后把路走慢';let browser;const server=http.createServer((req,res)=>{const file=path.resolve(ui,'.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));if(!file.startsWith(ui+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[path.extname(file)]??'application/octet-stream');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const report={passed:false,scope:'actual built React + actual isolated SQLite Core + actual provider broker with QA-only intercepted text transport; HeadlessChrome, not native GUI; no real credentials or external API',out,data,checks,screens,errors};const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
try{
 browser=await launchHeadlessChromium(chromium, {args:['--no-startup-window','--disable-background-networking','--disable-sync','--no-first-run']});const page=await browser.newPage({viewport:{width:1480,height:1050},deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await page.exposeBinding('__qaRpc',(_source,method,input)=>rpc(method,input));await page.addInitScript(()=>{window.rainfall={call:(method,input={})=>window.__qaRpc(method==='directoryTasks.chooseDirectory'?'__qa.chooseDirectory':method,input),apiCredentialStatus:async({profileId})=>({ok:true,value:{profileId,state:'absent',configured:false}}),checkApiConnection:async()=>({ok:false,error:{code:'QA_NO_NETWORK',message:'离线体验不联网'}}),writeApiCredential:async()=>({ok:false,error:{code:'QA_CREDENTIAL_WRITE_DISABLED',message:'体验环境不保存凭据'}}),clearApiCredential:async()=>({ok:false,error:{code:'QA_CREDENTIAL_WRITE_DISABLED'}}),productionFlow:async()=>({ok:true,value:{plans:[],runs:[]}}),liveText:async()=>({ok:true,value:[]}),liveMusic:async()=>({ok:true,value:null}),setMode:async()=>({ok:false,error:{code:'QA_MODE_FIXED'}})};});
 const shot=async name=>{const file=path.join(out,name+'.png');await page.screenshot({path:file,fullPage:false,animations:'disabled'});screens.push(file);save();};
 await page.goto(origin);
 const topTheme=page.locator('header').getByRole('group',{name:'主题切换',exact:true});
 await expect(topTheme).toBeVisible();
 await topTheme.getByRole('button',{name:'白色',exact:true}).click();
 await expect(topTheme.getByRole('button',{name:'白色',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'配置中心',exact:true}).click();
 await page.getByRole('tab',{name:'外观',exact:true}).click();
 await expect(page.getByRole('radio',{name:'白色主题',exact:true})).toBeChecked();
 await page.getByRole('radio',{name:'原主题',exact:true}).check();
 await expect(topTheme.getByRole('button',{name:'原主题',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.reload();
 await expect(topTheme.getByRole('button',{name:'原主题',exact:true})).toHaveAttribute('aria-pressed','true');
 const inactive=page.locator('aside nav button:not(.active)').first();
 await expect(inactive).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await expect(inactive).toHaveCSS('border-top-color','rgba(0, 0, 0, 0)');
 await page.getByRole('button',{name:'配置中心',exact:true}).click();
 await expect(page.locator('.first-setup')).toHaveCSS('border-top-width','0px');
 await expect(page.locator('.platform-configuration')).toHaveCSS('border-top-width','0px');
 await expect(page.getByLabel('词作者',{exact:true})).toHaveCSS('border-top-width','1px');
 await page.getByRole('tab',{name:'外观',exact:true}).click();
 await expect(page.locator('.first-setup')).not.toBeVisible();
 for(const width of [1024,1480,2560]) {
  await page.setViewportSize({width,height:1050});
  const fits=await page.locator('header').evaluate(el=>{const r=el.getBoundingClientRect();return [...el.children].every(c=>c.getBoundingClientRect().right<=r.right+1)&&document.documentElement.scrollWidth<=innerWidth});
  assert(fits,'Header and theme switch must fit viewport '+width);
 }
 await page.setViewportSize({width:1480,height:1050});
 checks.push('Visible header theme controls share settings radios and persisted preference; quiet navigation and flat configuration preserve input borders; header fits 1024–2560');
 await page.goto(origin);assert.equal(await page.locator('html').getAttribute('data-theme'),'original');await expect(page.locator('body')).toHaveCSS('background-color','rgb(16, 16, 21)');
 await page.getByRole('button',{name:'配置中心',exact:true}).click();await page.getByRole('tab',{name:'外观',exact:true}).click();await page.getByRole('radio',{name:'白色主题',exact:true}).check();await expect(page.locator('html')).toHaveAttribute('data-theme','white');await expect(page.locator('body')).toHaveCSS('background-color','rgb(244, 247, 252)');await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','white');checks.push('Explicit white preference survives full renderer reload');
 for(const theme of ['white','original']){
  await page.getByRole('button',{name:'配置中心',exact:true}).click();await page.getByRole('tab',{name:'外观',exact:true}).click();await page.getByRole('radio',{name:theme==='white'?'白色主题':'原主题',exact:true}).check();await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  for(const [slug,name]of [['overview','总览'],['plans','计划中心'],['publish','任务中心'],['settings','配置中心']]){await page.getByRole('button',{name,exact:true}).click();await shot(theme+'-'+slug);const style=await page.evaluate(()=>({bg:getComputedStyle(document.body).backgroundColor,text:getComputedStyle(document.body).color,panel:getComputedStyle(document.documentElement).getPropertyValue('--panel').trim(),controls:[...document.querySelectorAll('button,input,select,textarea')].filter(x=>x.getBoundingClientRect().width>0).slice(0,100).map(x=>({tag:x.tagName,bg:getComputedStyle(x).backgroundColor,color:getComputedStyle(x).color,opacity:getComputedStyle(x).opacity}))}));report[theme+'-'+slug]=style;}
  await page.getByRole('button',{name:'计划中心',exact:true}).click();await page.getByRole('button',{name:'＋ 新建计划',exact:true}).click();await expect(page.getByLabel('收件通道',{exact:true})).not.toBeVisible();await expect(page.getByLabel('收件艺人身份',{exact:true})).not.toBeVisible();await expect(page.getByRole('dialog')).toHaveCSS('background-color',theme==='white'?'rgb(255, 255, 255)':'rgb(26, 25, 34)');await shot(theme+'-plan-dialog');await page.getByRole('button',{name:'取消',exact:true}).click();await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
 }
 await page.evaluate(()=>localStorage.setItem('rainfall.ui.theme.v1','invalid-choice'));await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','original');await page.evaluate(()=>localStorage.removeItem('rainfall.ui.theme.v1'));await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','original');checks.push('Original theme persists; invalid or absent explicit preference restores historical original theme');
 assert.deepEqual(errors,[]);report.passed=true;report.calls=(await rpc('__qa.calls')).value;assert.equal(report.calls.providerCalls,0);assert.equal(report.calls.realNetworkCalls,0);report.scope='Actual built React and isolated Core; theme headless browser acceptance, no native claim';save();fs.writeFileSync(path.join(base,'theme-latest.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,out,checks,calls:report.calls}));
}catch(e){report.error=e.message;const page=browser?.contexts()[0]?.pages()[0];if(page){fs.writeFileSync(path.join(out,'failure-body.txt'),await page.locator('body').innerText());await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}save();throw e;
}finally{await browser?.close();await new Promise(r=>server.close(r));child.stdin.end();await new Promise(resolve=>{child.once('exit',resolve);setTimeout(()=>{if(child.exitCode===null)child.kill();resolve()},3000)});}
