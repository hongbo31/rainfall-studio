import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";
const out = path.resolve("output/publication-pipeline-ui/render.cjs");
await build({
  stdin: {
    contents: `export {connectPublicationBrowser} from './src/renderer/components/PublicationBrowserConnection';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Progress from './src/renderer/components/PublicationPipelineProgress';export const render=(state)=>renderToStaticMarkup(<Progress jobs={[{id:'job',workId:'cloud-new',title:'新作品',targets:['qqmusic','kugou'],state,reason:'INTERNAL_REASON'}]} data={{mode:'production',works:[{id:'cloud-new',title:'新作品'}]}} onRefresh={async()=>{}} onTrack={()=>{}} onConfigure={()=>{}}/>);`,
    loader: "tsx",
    resolveDir: process.cwd(),
  },
  outfile: out,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const { render,connectPublicationBrowser } = createRequire(import.meta.url)(out);
test("progress combines QQ and Kugou with concise stage and folded diagnostic details", () => {
  const html = render("preparing");
  assert.match(html, /新作品.*QQ 音乐 \/ 酷狗音乐/);
  assert.match(html, /正在准备官网材料/);
  assert.match(html, /<details><summary>诊断<\/summary>/);
  assert.doesNotMatch(html, /官方已发布|官方审核中|已提交/);
});
test("authorization offers compact material consent without manual start/run controls", () => {
  const html = render("awaiting_authorization");
  assert.match(html, /待确认材料准备/);
  assert.match(html, /确认并继续准备/);
  assert.doesNotMatch(html, /开始准备|继续准备到条款预览|本地准备历史/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>确认并继续准备/);
});
test("submission confirmation opens on the actual selected work with submission disabled", () => {
  const html = render("awaiting_confirmation");
  assert.match(html, /<details class="panel" open="">/);
  assert.match(html, /<option value="cloud-new" selected="">新作品/);
  assert.match(html, /<button disabled="">确认授权并提交审核/);
  assert.doesNotMatch(html, /官方已发布|官方审核中/);
});
test("unknown submission presents reconciliation rather than successful publication", () => {
  const html = render("reconcile_required");
  assert.match(html, /结果待核对，请勿重复提交/);
  assert.match(html, /<button disabled="">确认授权并提交审核/);
  assert.doesNotMatch(html, /官方已发布|官方审核中/);
});

test("terminal state alone cannot claim official receipt success", () => {
  for (const state of ["reviewing", "published", "rejected"]) {
    const html = render(state);
    assert.match(html, /官方回执待核对/);
    assert.doesNotMatch(html, /官方已发布|官方审核中|官方已驳回/);
  }
});

test("pipeline exposes local publication metadata before dispatch", () => {
  assert.match(render("blocked"), /<summary>投稿资料<\/summary>/);
  assert.doesNotMatch(render("published"), /<summary>投稿资料<\/summary>/);
});
test('first blocked publication still exposes the explicit existing-browser connection control',()=>{
 const html=render('blocked');assert.match(html,/连接官网浏览器/);assert.match(html,/核对投稿账号/);assert.match(html,/确认并继续准备/);
});

test('restarted unknown submissions expose connection separately from preparation consent',()=>{
 const html=render('reconcile_required');assert.match(html,/连接官网浏览器/);assert.doesNotMatch(html,/确认并继续准备/);
});
test('connection control requests only an authorized existing connection and never dispatches',async()=>{
 const calls=[];await connectPublicationBrowser(async(action,input)=>{calls.push({action,input});return{ok:true,value:{connected:true}}});
 assert.deepEqual(calls,[{action:'connectBrowser',input:{port:9222,allowConnection:true}}]);
});
