import React, {useEffect,useRef,useState} from 'react';
export async function connectPublicationBrowser(bridge:(action:string,input:unknown)=>Promise<any>){
 const result=await bridge('connectBrowser',{port:9222,allowConnection:true});
 if(!result?.ok||!result.value?.connected)throw Error(result?.error?.message??'官网浏览器连接未完成');
 return result.value;
}
export async function inspectPublicationBrowserAccount(bridge:(action:string,input:unknown)=>Promise<any>){
 const result=await bridge('inspectBrowserAccount',{});
 if(!result?.ok)throw Error(result?.error?.code??'BROWSER_ACCOUNT_IDENTITY_UNVERIFIED');
 if(result.value?.readOnly!==true||!result.value.artistName?.trim()||!/^\*\*\*\d{4}$/.test(result.value.maskedKugouId??''))throw Error('BROWSER_ACCOUNT_IDENTITY_UNVERIFIED');
 return result.value;
}
/** Connection is separate from preparation consent and remains available after restart. */
export default function PublicationBrowserConnection(){
 const locked=useRef(false),bindingKey=useRef(''),actionEpoch=useRef(0);const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[connected,setConnected]=useState(false),[account,setAccount]=useState<any>(null);
 useEffect(()=>{let stopped=false;const sync=async()=>{if(locked.current)return;const epoch=actionEpoch.current;try{
  const bridge=(window.rainfall as any).tmeAiPrepare;if(!bridge)return;const result=await bridge('browserStatus',{});if(stopped||epoch!==actionEpoch.current||!result?.ok)return;
  const value=result.value,key=value?.connected?(value.binding?.sessionId??'connected'):'';
  if(key!==bindingKey.current){const hadConnection=!!bindingKey.current;bindingKey.current=key;setAccount(null);setStatus(key?(value.reasons?.length?'已连接，官网步骤待校准':'已连接官网浏览器'):hadConnection?'官网浏览器连接已断开':'');}
  setConnected(!!key);
 }catch{if(!stopped&&epoch===actionEpoch.current){bindingKey.current='';setConnected(false);setAccount(null);setStatus('连接状态待核对');}}};void sync();const timer=setInterval(()=>void sync(),1500);return()=>{stopped=true;clearInterval(timer)};},[]);
 const connect=async()=>{if(locked.current)return;actionEpoch.current++;locked.current=true;setBusy(true);setAccount(null);setStatus('');try{
  const bridge=(window.rainfall as any).tmeAiPrepare;if(!bridge)throw Error('当前客户端未连接浏览器服务');
  const result=await connectPublicationBrowser(bridge);bindingKey.current=result.binding?.sessionId??'connected';setConnected(true);setAccount(null);setStatus(result.reasons?.length?'已连接，官网步骤待校准':'已连接官网浏览器');
 }catch(e){setStatus(e instanceof Error?e.message:'连接未完成')}finally{locked.current=false;setBusy(false)}};
 const inspect=async()=>{if(locked.current||!connected)return;actionEpoch.current++;locked.current=true;setBusy(true);setAccount(null);try{
  const value=await inspectPublicationBrowserAccount((window.rainfall as any).tmeAiPrepare);setAccount(value);
 }catch(e){const code=e instanceof Error?e.message:'';setStatus(code==='ACCOUNT_CHANGED'?'官网账号已变化，请关闭候选后重新连接。':code==='BROWSER_ACCOUNT_PROFILE_REQUIRED'?'请在官网打开“个人资料 → 绑定其他平台账号”，再核对。':'官网账号尚未核实，请检查页面后重试。')}finally{locked.current=false;setBusy(false)}};
 return <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:8,maxWidth:640}}><button disabled={busy||connected} title="连接本应用所在电脑已开启调试的浏览器；不会启动或修改浏览器" onClick={()=>void connect()}>连接官网浏览器</button><button disabled={busy||!connected} title="只读核对官方资料页，不绑定账号或授权投稿" onClick={()=>void inspect()}>核对官网账号</button>{status&&<small role="status">{status}</small>}{account&&<small role="status" title={account.observedAt?'核对时间：'+account.observedAt:undefined}>已核对：{account.artistName} · 酷狗 {account.maskedKugouId}</small>}</div>;
}
