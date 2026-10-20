import React from 'react';
import {createRoot} from 'react-dom/client';
import ApiSettings from '../../src/renderer/components/ApiSettings';
import {Context} from '../../src/renderer/context';
const testState={failure:'',lastWriteMatched:false,requests:[] as string[]};
(window as any).__credentialTest=testState;
const profile={id:'80c96f21-623b-4c57-9b58-1c72c560661d',kind:'music',providerId:'yourmusic',label:'Synthetic test service',modelId:'chirp-v6',executionEnabled:false,revision:1};
(window as any).rainfall={
 apiCredentialStatus:async()=>({ok:true,value:{profileId:profile.id,state:'stored_unverified',configured:true}}),
 writeApiCredential:async(input:any)=>{testState.requests.push('local-save');testState.lastWriteMatched=input.secret==='SYNTHETIC_INPUT_ONLY';return{ok:true,value:{profileId:profile.id,state:'stored_unverified',configured:true}}},
 clearApiCredential:async()=>({ok:true,value:{profileId:profile.id,state:'absent',configured:false}}),
 checkApiConnection:async()=>{
  testState.requests.push('readonly-check');
  if(testState.failure==='CREDENTIAL_DECRYPT_FAILED')return{ok:false,error:{code:testState.failure,message:'safe'}};
  return{ok:true,value:{profileId:profile.id,providerId:'yourmusic',state:testState.failure==='HTTP_401'?'unauthorized':testState.failure==='DNS'?'unavailable':'connected',httpStatus:testState.failure==='HTTP_401'?401:testState.failure==='DNS'?null:200,failureCode:testState.failure==='DNS'?'HTTP_DNS_FAILED':null,checkedAt:'2026-10-20T00:00:00Z',scope:'authentication_only',paidGenerationRequested:false}};
 }
};
const context:any={runtime:{mode:'production'},call:async(method:string)=>method==='apiProfile.list'?[profile]:method==='generationConfig.read'?{revision:1,roles:{text:null,image:null,music:profile.id}}:null};
createRoot(document.getElementById('root')!).render(<Context.Provider value={context}><ApiSettings /></Context.Provider>);
