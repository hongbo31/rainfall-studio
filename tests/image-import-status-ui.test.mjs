import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
const {ProfileCard,Context}=require(process.env.RAINFALL_IMAGE_STATUS_UI_BUNDLE);
const render=(providerId)=>renderToStaticMarkup(React.createElement(Context.Provider,{value:{call:async()=>{throw Error('SSR_MUST_NOT_CALL')}}},React.createElement(ProfileCard,{profile:{id:'00000000-0000-4000-8000-000000000001',revision:1,label:'Offline image import',kind:'image',providerId,modelId:null},simulation:false,refresh:async()=>{}})));
test('local and dot import cards never imply a missing image API credential',()=>{
 for(const provider of ['local_image','dot_image']){
  const html=render(provider);
  assert.match(html,/无需 API Key/);
  assert.doesNotMatch(html,/未保存 Key|正在读取状态|接口与模型配置完成后，再开放凭据录入/);
  assert.doesNotMatch(html,/type="password"/);
  assert.match(html,/客户端不直接调用图片模型/);
 }
});
test('unimplemented image API remains clearly unavailable without credential entry',()=>{
 const html=render('image_pending');
 assert.match(html,/图片 API 未接入/);
 assert.doesNotMatch(html,/未保存 Key|正在读取状态|type="password"/);
});
