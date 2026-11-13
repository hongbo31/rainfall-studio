import React,{useEffect,useState} from 'react';
import {useStudio} from '../context';
export default function CoverInbox({workId,requestId,brief='',disabled,showDirectory=false}:{workId:string;requestId?:string;brief?:string;disabled:boolean;showDirectory?:boolean}){
 const {call}=useStudio();const [state,setState]=useState<any>(null),[error,setError]=useState(''),[open,setOpen]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;setState(null);setError('');setOpen(false);const read=()=>void call('cover.inboxStatus',{workId}).then(rows=>{if(active)setState((requestId?rows.find((r:any)=>r.requestId===requestId):rows.filter((r:any)=>r.state!=='superseded').at(-1))??null)}).catch(()=>{});read();const timer=setInterval(read,5000);return()=>{active=false;clearInterval(timer)};},[workId,requestId]);
 const reason=state?.reason==='COVER_INBOX_MULTIPLE_IMAGES'?'目录中有多张封面，请只保留一张。':
  state?.reason==='COVER_INBOX_DUPLICATE_IMAGE'?'这张图已用于其他作品，请换一张。':state?.reason?'请核对图片和作品内容。':'';
 const generation=state?.generation?.state;
 const status=state?.state==='received'?'封面已匹配':state?.state==='superseded'?'已换用新目录':
  generation==='dispatching'||generation==='downloaded'?'正在生成或导入封面':
  generation==='unknown'?'生成结果待核对，可导入封面':generation==='failed'?'出图失败，可导入封面':'等待图片';
 return <div className="cover-inbox">{!showDirectory&&<button disabled={disabled||busy} onClick={async()=>{setBusy(true);try{setError('');let id=requestId||state?.requestId;if(!id){const request=await call('cover.request',{workId,requestId:crypto.randomUUID(),brief});id=request.id;}setState(await call('cover.watch',{requestId:id}));setOpen(true);}catch(e:any){setError(e.message)}finally{setBusy(false)}}}>自动收图</button>}
 {state&&(showDirectory||open||state.reason)&&<><label>图片保存目录<input readOnly value={state.directory} aria-label="图片保存目录" onFocus={e=>e.target.select()}/></label><small>cover.png / jpg / webp · 只放一张方图 · 建议 2048 × 2048 以上</small><p role="status">{status}{reason&&' · '+reason}</p></>}
 {error&&<p role="alert">{error}</p>}</div>;
}
