import React,{useEffect,useState} from 'react';
import {useStudio} from '../context';
export default function CoverInbox({workId,requestId,brief='',disabled}:{workId:string;requestId?:string;brief?:string;disabled:boolean}){
 const {call}=useStudio();const [state,setState]=useState<any>(null),[error,setError]=useState(''),[open,setOpen]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;setState(null);setError('');setOpen(false);const read=()=>void call('cover.inboxStatus',{workId}).then(rows=>{if(active)setState((requestId?rows.find((r:any)=>r.requestId===requestId):rows.filter((r:any)=>r.state!=='superseded').at(-1))??null)}).catch(()=>{});read();const timer=setInterval(read,5000);return()=>{active=false;clearInterval(timer)};},[workId,requestId]);
 const reason=state?.reason==='COVER_INBOX_MULTIPLE_IMAGES'?'目录中有多张封面，请只保留一张。':state?.reason?'图片暂未接收，请检查格式、尺寸及作品内容是否已变更。':'';
 return <div className="cover-inbox"><button disabled={disabled||busy} onClick={async()=>{setBusy(true);try{setError('');let id=requestId||state?.requestId;if(!id){const request=await call('cover.request',{workId,requestId:crypto.randomUUID(),brief});id=request.id;}setState(await call('cover.watch',{requestId:id}));setOpen(true);}catch(e:any){setError(e.message)}finally{setBusy(false)}}}>自动收图</button>
 {state&&(open||state.reason)&&<><label>图片保存目录<input readOnly value={state.directory} aria-label="图片保存目录" onFocus={e=>e.target.select()}/></label><small>cover.png / jpg / webp · 只放一张方图 · 建议 3000 × 3000</small><p role="status">{state.state==='received'?'封面已匹配':state.state==='superseded'?'已换用新目录':'等待图片'}{reason&&' · '+reason}</p></>}
 {error&&<p role="alert">{error}</p>}</div>;
}
