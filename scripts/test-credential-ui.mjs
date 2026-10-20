import {build} from 'esbuild';import fs from 'node:fs';import assert from 'node:assert/strict';import {chromium} from '@playwright/test';
await build({entryPoints:['tests/fixtures/credential-input.tsx'],outfile:'output/credential-ui/fixture.js',bundle:true,platform:'browser',format:'iife'});
// Dedicated headless test context only; never attaches to the user's Edge/profile or app.
const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
try{
 const page=await browser.newPage(),requests=[],consoleMessages=[];
 await page.route('**/*',route=>{requests.push(route.request().url());return route.abort()});page.on('console',m=>consoleMessages.push(m.text()));
 await page.setContent('<div id="root"></div>');await page.addScriptTag({content:fs.readFileSync('output/credential-ui/fixture.js','utf8')});
 await page.getByRole('tab',{name:'音乐生成',exact:true}).click();
 const input=page.getByLabel('新的 API Key',{exact:true});await input.waitFor();
 assert.equal(await input.getAttribute('type'),'text');assert.equal(await input.inputValue(),'');
 await input.fill('SYNTHETIC_INPUT_ONLY');await page.getByRole('button',{name:'隐藏输入',exact:true}).click();assert.equal(await input.getAttribute('type'),'password');
 await page.getByRole('button',{name:'显示输入',exact:true}).click();assert.equal(await input.getAttribute('type'),'text');assert.equal(await input.inputValue(),'SYNTHETIC_INPUT_ONLY');
 await page.getByRole('button',{name:'保存 Key',exact:true}).click();await page.waitForFunction(()=>document.querySelector('input[aria-label="新的 API Key"]').value==='');
 assert.equal(await page.evaluate(()=>window.__credentialTest.lastWriteMatched),true);
 assert.ok(!(await page.locator('#root').innerHTML()).includes('SYNTHETIC_INPUT_ONLY'));
 await page.evaluate(()=>{window.__credentialTest.failure='CREDENTIAL_DECRYPT_FAILED'});await page.getByRole('button',{name:'检查连接（只读）',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'CREDENTIAL_DECRYPT_FAILED'}).waitFor();
 await page.evaluate(()=>{window.__credentialTest.failure='HTTP_401'});await page.getByRole('button',{name:'检查连接（只读）',exact:true}).click();await page.getByTestId('api-connection-result').filter({hasText:'HTTP 401'}).waitFor();
 await page.evaluate(()=>{window.__credentialTest.failure='DNS'});await page.getByRole('button',{name:'检查连接（只读）',exact:true}).click();await page.getByTestId('api-connection-result').filter({hasText:'HTTP_DNS_FAILED'}).waitFor();
 assert.equal(requests.length,0);assert.ok(!consoleMessages.join('\n').includes('SYNTHETIC_INPUT_ONLY'));
 console.log('Credential UI: visible/hidden input, save clearing, no stored echo, decrypt/401/DNS classification, no network or secret logs: PASS');
}finally{await browser.close()}
