import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';
const {renderPublish,renderManual,receiptScope}=createRequire(import.meta.url)('../build/quick-publish-ui.cjs');
test('legacy diagnostics preserves music, five platforms, explicit A/B scope and closed advanced settings',()=>{
 const {html,actions}=renderPublish();
 for(const text of ['选择音乐，准备发布','1 · 选择音乐','2 · 选择平台','本地原创曲','网易云音乐','汽水音乐','QQ 音乐','酷狗音乐','抖音视频','请选择 A、B 或两版','高级设置','仅本地预检 · 未上传'])assert.ok(html.includes(text),text);
 assert.ok(html.includes('<option value="" selected="">请选择 A、B 或两版</option>'));assert.ok(!html.includes('<details open'));assert.equal(actions.length,0);assert.ok(!html.includes('role="dialog"'));assert.ok(!html.includes('modal-backdrop'));
});
test('simulation and production are clearly distinguished and manual receipt stays inline',()=>{
 assert.ok(renderPublish('simulation',false).html.includes('发布（本地模拟）'));assert.ok(renderPublish('production',false).html.includes('发布（先检查材料）'));
 const manual=renderManual();assert.ok(manual.includes('仅登记官方核对证据'));assert.ok(!manual.includes('role="dialog"'));assert.ok(!manual.includes('modal-backdrop'));
});
test('legacy diagnostics selection flow contains no browser, shell or native-dialog entry point',()=>{
 const source=fs.readFileSync('src/renderer/components/QuickPublish.tsx','utf8');
 for(const action of ['window.open','openOfficial','tmeInspect','tmeSaveDraft','showOpenDialog','showSaveDialog','confirm(','alert(','exportArtifact('])assert.ok(!source.includes(action),action);
 assert.ok(source.includes("call('publish.quick',input)"));
});
test('switching receipt unit changes React form identity and shows the new song, recording and account',()=>{
 const a=receiptScope({id:'unit-a',snapshot:{title:'第一首'},recordingSlot:'audio_A'});
 const b=receiptScope({id:'unit-b',snapshot:{title:'第二首'},recordingSlot:'audio_B',accountId:'account-b'});
 assert.equal(a.key,'unit-a');assert.equal(b.key,'unit-b');assert.notEqual(a.key,b.key);
 for(const text of ['第二首','B 版','账号乙','unit-b'])assert.ok(b.html.includes(text),text);
 assert.ok(!b.html.includes('checked=""'));
});
