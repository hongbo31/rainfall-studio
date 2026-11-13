import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Context} from '../context';
import {createSelectionWriter} from '../publish-selection';
import type {PublishSelection} from '../../shared/platform-config';
import PublishCenter from './PublishCenter';

function connect(){
  const key=location.hash.slice(1)||sessionStorage.getItem('rainfall-workbench');
  if(!key||!/^[a-f0-9]{64}$/.test(key))return;
  sessionStorage.setItem('rainfall-workbench',key);
  history.replaceState(null,'',location.pathname);
  const request=async(channel:string,method:string,input:unknown={})=>{
    const response=await fetch('/rpc',{method:'POST',headers:{
      'Content-Type':'application/json','Authorization':'Bearer '+key,
    },body:JSON.stringify({channel,method,input})});
    if(!response.ok)throw Error('请从 Rainfall Studio 重新打开浏览器发布台。');
    return response.json();
  };
  const bridge={
    call:(method:string,input?:unknown)=>request('call',method,input),
    fanqieCatalog:(method:string,input?:unknown)=>request('fanqieCatalog',method,input),
    fanqieUpload:(method:string,input?:unknown)=>request('fanqieUpload',method,input),
  };
  Object.defineProperty(window,'rainfall',{value:bridge});
  return bridge;
}
export default function BrowserPublishWorkbench(){
  const [bridge]=useState(connect);
  const [data,setData]=useState<any>();
  const [message,setMessage]=useState('');
  const [selection,setSelection]=useState<PublishSelection>();
  const initialized=useRef(false);
  const writer=useRef(createSelectionWriter(async input=>{
    const result=await bridge!.call('publish.selection.save',input);
    if(!result.ok)throw Error(result.error.message);
  }));
  const refresh=useCallback(async()=>{
    if(!bridge)throw Error('请从 Rainfall Studio 打开浏览器发布台。');
    const result=await bridge.call('snapshot');
    if(!result.ok)throw Error(result.error.message);
    setData(result.value);
    if(!initialized.current){initialized.current=true;setSelection(result.value.publishSelection);}
  },[bridge]);
  useEffect(()=>{void refresh().catch(e=>setMessage(e.message));},[refresh]);
  const call=async(method:string,input:unknown={})=>{
    const result=await bridge!.call(method,input);
    if(!result.ok)throw Error(result.error.message);
    await refresh().catch(()=>{});
    return result.value;
  };
  return <main>
    {message&&<p role="status">{message}</p>}
    {data?<Context.Provider value={{
      data,runtime:{},call,refresh,notify:setMessage,selected:selection?.workIds??[],setSelected:()=>{},
      publishSelection:selection,setPublishSelection:next=>{setSelection(next);return writer.current.enqueue(next);},
      flushPublishSelection:()=>writer.current.flush(),
      go:page=>setMessage(page==='accounts'?'请在 Rainfall Studio 配置账号。':'请在 Rainfall Studio 查看作品。'),
      play:()=>{},importAsset:async()=>{},exportArtifact:async()=>{},
    }}><PublishCenter browser/></Context.Provider>:!message&&<p role="status">正在读取作品库…</p>}
  </main>;
}
