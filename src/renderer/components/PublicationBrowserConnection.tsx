import React, {useEffect,useRef,useState} from 'react';
const accountObservationLifetimeMs=5*60*1000;
const connectedMessage='浏览器已连接（连接不代表登录）';
export async function connectPublicationBrowser(bridge:(action:string,input:unknown)=>Promise<any>){
 const result=await bridge('connectBrowser',{port:9222,allowConnection:true});
 if(!result?.ok||!result.value?.connected)throw Error(result?.error?.message??'官网浏览器连接未完成');
 return result.value;
}
export async function inspectPublicationBrowserAccount(bridge:(action:string,input:unknown)=>Promise<any>){
 const result=await bridge('inspectBrowserAccount',{});
 if(!result?.ok)throw Error(result?.error?.code??'BROWSER_ACCOUNT_IDENTITY_UNVERIFIED');
 const observedAt=Date.parse(result.value?.observedAt),age=Date.now()-observedAt;
 if(result.value?.readOnly!==true||!result.value.artistName?.trim()||!/^\*\*\*\d{4}$/.test(result.value.maskedKugouId??'')||!Number.isFinite(observedAt)||age < -5000||age>=accountObservationLifetimeMs)throw Error('BROWSER_ACCOUNT_IDENTITY_UNVERIFIED');
 return result.value;
}
/** Connection is separate from preparation consent and remains available after restart. */
export default function PublicationBrowserConnection(){
 const locked=useRef(false),bindingKey=useRef(''),actionEpoch=useRef(0),observationExpires=useRef(0);const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[connected,setConnected]=useState(false),[account,setAccount]=useState<any>(null);
 useEffect(()=>{let stopped=false;const sync=async()=>{if(locked.current)return;const epoch=actionEpoch.current;try{
  if(observationExpires.current&&Date.now()>=observationExpires.current){observationExpires.current=0;setAccount(null);setStatus('最近账号核对已过期（5分钟），请重新核对官网登录与身份。');}
  const bridge=(window.rainfall as any).tmeAiPrepare;if(!bridge)return;const result=await bridge('browserStatus',{});if(stopped||epoch!==actionEpoch.current)return;if(!result?.ok)throw Error('BROWSER_STATUS_UNAVAILABLE');
  const value=result.value,key=value?.connected?(value.binding?.sessionId??'connected'):'';
  if(key!==bindingKey.current){const hadConnection=!!bindingKey.current;bindingKey.current=key;observationExpires.current=0;setAccount(null);setStatus(key?connectedMessage:hadConnection?'官网浏览器连接已断开，请重新连接并核对账号。':'');}
  setConnected(!!key);
 }catch{if(!stopped&&epoch===actionEpoch.current){bindingKey.current='';observationExpires.current=0;setConnected(false);setAccount(null);setStatus('浏览器连接状态待核对；官网登录状态未知。');}}};void sync();const timer=setInterval(()=>void sync(),1500);return()=>{stopped=true;clearInterval(timer)};},[]);
 const connect=async()=>{if(locked.current)return;actionEpoch.current++;locked.current=true;setBusy(true);setAccount(null);setStatus('');try{
  const bridge=(window.rainfall as any).tmeAiPrepare;if(!bridge)throw Error('当前客户端未连接浏览器服务');
  const result=await connectPublicationBrowser(bridge);bindingKey.current=result.binding?.sessionId??'connected';observationExpires.current=0;setConnected(true);setAccount(null);setStatus(connectedMessage);
 }catch(e){setStatus(e instanceof Error?e.message:'连接未完成')}finally{locked.current=false;setBusy(false)}};
 const inspect=async()=>{if(locked.current||!connected)return;actionEpoch.current++;locked.current=true;setBusy(true);observationExpires.current=0;setAccount(null);try{
  const value=await inspectPublicationBrowserAccount((window.rainfall as any).tmeAiPrepare);observationExpires.current=Date.parse(value.observedAt)+accountObservationLifetimeMs;setAccount(value);setStatus(connectedMessage);
 }catch(e){const code=e instanceof Error?e.message:'';setStatus(code==='ACCOUNT_CHANGED'?'官网账号已变化，请关闭客户端后重新连接并核对。':['CLOUD_BROWSER_SESSION_REQUIRED','PAGE_ORIGIN_CHANGED','BROWSER_OFFICIAL_ORIGIN_REQUIRED'].includes(code)?'浏览器会话不可用，请检查官网页面；连接断开后重新连接。':code==='BROWSER_ACCOUNT_PROFILE_REQUIRED'?'官网身份页不可读，请确认已登录预期账号并检查“个人资料 → 绑定其他平台账号”。':'官网登录或账号身份未核实，请在官网检查登录、绑定信息或验证提示后重试。')}finally{locked.current=false;setBusy(false)}};
 return <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:8,maxWidth:640}}><button disabled={busy||connected} title="连接本应用所在电脑已开启调试的浏览器；不会启动或修改浏览器" onClick={()=>void connect()}>连接官网浏览器</button><button disabled={busy||!connected} title="只读核对官方资料页，不绑定账号或授权投稿；观察5分钟后需重新核对" onClick={()=>void inspect()}>核对官网账号</button>{status&&<small role="status">{status}</small>}{account&&<small role="status" title="最近一次可见身份观察，不代表持续登录或投稿授权">最近核对：{account.artistName} · 酷狗 {account.maskedKugouId} · <time dateTime={account.observedAt}>{new Date(account.observedAt).toLocaleString()}</time></small>}</div>;
}
