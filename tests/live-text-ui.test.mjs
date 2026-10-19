import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
import path from 'node:path';
import {createRequire} from 'node:module';
const implemented=fs.existsSync('src/renderer/components/LiveTextWorkspace.tsx');
let render;
if(implemented){await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {Context} from './src/renderer/context';import Panel from './src/renderer/components/LiveTextWorkspace';export const render=(mode)=>renderToStaticMarkup(<Context.Provider value={{data:{mode,artists:[{id:'a',name:'创作者'}]},call:async()=>[],notify:()=>{},go:()=>{}} as any}><Panel/></Context.Provider>);`,resolveDir:process.cwd(),loader:'tsx'},outfile:'output/live-text-ui-test.cjs',bundle:true,platform:'node',format:'cjs',packages:'external'});({render}=createRequire(import.meta.url)(path.resolve('output/live-text-ui-test.cjs')))}
test('production text UI requires explicit budget and consent and distinguishes local checks',()=>{assert.equal(typeof render,'function');const html=render('production');assert(html.includes('DeepSeek 歌词与曲风'));assert(html.includes('本轮文本预算（美元）'));assert(html.includes('确认本轮文本调用预算'));assert(html.includes('本地规则检查'));assert(html.includes('准备本轮文本任务'));assert(!html.includes('评分通过'));assert(!html.includes('已连接成功'))});
test('production text controls do not appear in simulation',()=>{assert.equal(typeof render,'function');assert.equal(render('simulation'),'')});

test('fee summary stays visible while full rates and date remain in accessible help',()=>{
 const html=render('production');
 assert(html.includes('<p>费用按用量估算（USD）· 非最终账单</p>'));
 const help=html.match(/<span class="help-note help-hint"><button[^>]*>费率参考[\s\S]*?<span[^>]*role="tooltip">([\s\S]*?)<\/span><\/span>/);
 assert(help,'rate reference must remain associated with a focusable help button');
 for(const text of ['$0.30/$1.20','$1.32/$3.96','2026-10-16','音乐生成、封面出图及平台授权另行处理'])assert(help[1].includes(text),text);
 assert(html.includes('确认本轮文本调用预算及最多改写次数；准备本身不联网生成。'));
 assert(!html.includes('checked=""'));
});
