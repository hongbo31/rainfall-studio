import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {build} from 'esbuild';
await build({entryPoints:['src/main/tme/ai-intake-fields.ts'],outfile:'build/tme-intake-fields.cjs',bundle:true,platform:'node',target:'node24',format:'cjs',packages:'external'});
const require=createRequire(import.meta.url),{fillExistingTmeAiIntakeFields,TME_AI_INTAKE_FIELDS:c}=require('../build/tme-intake-fields.cjs');
const input={title:'便利店门口的晴天',artistName:'离线验收艺人',genre:'流行',consent:true};
test('wrong origin and protected published titles stop before controls are touched',async()=>{
 let touched=0;const page={url:()=> 'https://evil.invalid/',locator:()=>{touched++;throw Error('unexpected')}};
 await assert.rejects(()=>fillExistingTmeAiIntakeFields(page,input),/INTAKE_WORK_SCOPE/);assert.equal(touched,0);
 page.url=()=>c.route;await assert.rejects(()=>fillExistingTmeAiIntakeFields(page,{...input,title:'留一盏灯'}),/INTAKE_WORK_SCOPE/);assert.equal(touched,0);
});
test('wrong artist blocks before any field change',async()=>{
 let changes=0;const page={url:()=>c.route,locator:selector=>({count:async()=>1,innerText:async()=>selector===c.artist?'其他账号':'上传AI歌曲 ( 1首 )\n便利店门口的晴天.wav',inputValue:async()=>input.title,click:async()=>{changes++}})};
 await assert.rejects(()=>fillExistingTmeAiIntakeFields(page,input),/INTAKE_WORK_SCOPE/);assert.equal(changes,0);
});
test('a different existing song cannot be adopted by matching only the artist name',async()=>{
 const page={url:()=>c.route,locator:selector=>({count:async()=>1,innerText:async()=>input.artistName,inputValue:async()=> 'another song'})};
 await assert.rejects(()=>fillExistingTmeAiIntakeFields(page,input),/INTAKE_WORK_SCOPE/);
});
test('explicit consent is required and upload or ownership payloads are rejected',async()=>{
 const page={url:()=>{throw Error('must not touch page')}};
 await assert.rejects(()=>fillExistingTmeAiIntakeFields(page,{...input,consent:false}));
 await assert.rejects(()=>fillExistingTmeAiIntakeFields(page,{...input,audioPath:'C:/other.wav'}));
 await assert.rejects(()=>fillExistingTmeAiIntakeFields(page,{...input,ownComposition:true}));
});
test('a selected album card is read back without reopening its now hidden input',async()=>{
 let changes=0;const page={url:()=>c.route,locator:selector=>({count:async()=>[c.artist,c.title,c.selectedAlbum].includes(selector)?1:0,innerText:async()=>selector===c.artist?input.artistName:selector===c.selectedAlbum?'那场雨':'上传AI歌曲 ( 1首 )\n便利店门口的晴天.wav',inputValue:async()=>{if(selector!==c.title)throw Error('HIDDEN_INPUT_MUST_NOT_BE_READ');return input.title},click:async()=>{changes++}})};
 const result=await fillExistingTmeAiIntakeFields(page,{title:input.title,artistName:input.artistName,albumTitle:'那场雨',consent:true});assert.equal(result.album,'那场雨');assert.equal(changes,0);
 await assert.rejects(()=>fillExistingTmeAiIntakeFields(page,{title:input.title,artistName:input.artistName,albumTitle:'another album',consent:true}),/DIFFERENT_ALBUM_SELECTED_REVIEW_REQUIRED/);assert.equal(changes,0);
});
