import React, {useRef,useState} from 'react';
export async function connectPublicationBrowser(bridge:(action:string,input:unknown)=>Promise<any>){
 const result=await bridge('connectBrowser',{port:9222,allowConnection:true});
 if(!result?.ok||!result.value?.connected)throw Error(result?.error?.message??'官网浏览器连接未完成');
 return result.value;
}
/** Connection is separate from preparation consent and remains available after restart. */
export default function PublicationBrowserConnection(){
 const locked=useRef(false);const [busy,setBusy]=useState(false),[status,setStatus]=useState('');
 const connect=async()=>{if(locked.current)return;locked.current=true;setBusy(true);setStatus('');try{
  const bridge=(window.rainfall as any).tmeAiPrepare;if(!bridge)throw Error('当前客户端未连接浏览器服务');
  const result=await connectPublicationBrowser(bridge);setStatus(result.reasons?.length?'已连接，官网步骤待校准':'已连接官网浏览器');
 }catch(e){setStatus(e instanceof Error?e.message:'连接未完成')}finally{locked.current=false;setBusy(false)}};
 return <div><button disabled={busy} title="连接本应用所在电脑已开启调试的浏览器；不会启动或修改浏览器" onClick={()=>void connect()}>连接官网浏览器</button>{status&&<small role="status">{status}</small>}</div>;
}
