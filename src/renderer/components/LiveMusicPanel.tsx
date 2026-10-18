import React,{useEffect,useState} from 'react';
import type {ApiProfile} from '../../shared/api-profiles';
import {leaveALightLyrics,leaveALightStyle} from '../../shared/leave-a-light';
import {useStudio} from '../context';
import HelpNote from './HelpNote';
export default function LiveMusicPanel({profile}:{profile:ApiProfile}){
 const {play,refresh,notify,go}=useStudio();
 const [lyrics,setLyrics]=useState(leaveALightLyrics),[style,setStyle]=useState(leaveALightStyle),[requestId,setRequestId]=useState(()=>crypto.randomUUID()),[state,setState]=useState<any>(null),[busy,setBusy]=useState(false),[consent,setConsent]=useState(false),[error,setError]=useState('');
 const read=async()=>{const r=await window.rainfall.liveMusic('status',{});if(r.ok){setState(r.value);if(r.value){setRequestId(r.value.grant.requestId);setLyrics(r.value.draft.pair.lyrics);setStyle(r.value.draft.pair.musicPrompt)}}};
 useEffect(()=>{void read();const t=setInterval(()=>void read(),3000);return()=>clearInterval(t)},[profile.id]);
 const action=async(kind:'stage'|'submit'|'import'|'recover'|'retryDownloads')=>{setBusy(true);setError('');try{const input=kind==='stage'?{requestId,profileId:profile.id,expectedRevision:profile.revision,lyrics,style,duration:210,balanceBefore:385,creditCap:385,consent:true}:kind==='submit'?{requestId,consent:true}:{};const r=await window.rainfall.liveMusic(kind,input);if(!r.ok)throw Error(r.error.code);await read();await refresh();if(kind==='recover'&&r.value?.state==='not_established')setError('只读核对尚未建立唯一受理证据，继续禁止重发');if(kind==='import'){notify('两个真实音频已导入作品库');go('track',r.value.id)}}catch(e){setError(e instanceof Error?e.message:'操作未完成')}finally{setBusy(false)}};
 const op=state?.operation,ready=state?.candidates?.filter((x:any)=>x.state==='ready').length??0;
 return <section className="panel" aria-label="示例作品A真实生成验证">
  <h3>音乐生成 ·《示例作品A》</h3>
  <p>单次积分未知 · 本次上限385积分 · 不充值、不发布</p>
  <HelpNote label="本次生成参数">Suno chirp-v6，正常模式，MaxMode 关闭；一次请求预期返回 A/B 两版，210秒目标。</HelpNote>
  <label>完整原创歌词<textarea aria-label="示例作品A完整原创歌词" rows={14} value={lyrics} disabled={!!state||busy} onChange={e=>setLyrics(e.target.value)}/></label>
  <label>歌曲风格<textarea aria-label="示例作品A歌曲风格" rows={4} value={style} disabled={!!state||busy} onChange={e=>setStyle(e.target.value)}/></label>
  <label><input type="checkbox" aria-label="确认本次仅使用现有385积分" checked={consent} onChange={e=>setConsent(e.target.checked)}/>已授权本次最多使用现有385积分，不充值、不额外付款</label>
  {!state&&<button disabled={busy||!consent} onClick={()=>void action('stage')}>保存《示例作品A》候选（不扣费）</button>}
  {op?.state==='prepared'&&<button className="primary" disabled={busy||!consent} onClick={()=>void action('submit')}>确认一次真实生成《示例作品A》</button>}
  {op&&<div role="status" aria-label="真实生成状态"><p>状态：{op.state} · 已就绪 {ready}/2 · 费用核对：{op.costState}</p><details><summary>请求记录</summary><p>请求：{op.requestId}</p><p>平台任务：{op.trackingId??'尚未取得'}</p>{(op.songIds??[]).map((id:string)=><p key={id}>平台歌曲：{id}</p>)}</details>{op.state==='unknown'&&<p>受理结果未知 · 禁止重复提交</p>}{(op.reasons??[]).map((r:string)=><p key={r}>{r}</p>)}</div>}
  {state?.candidates?.map((c:any)=><div key={c.id}><p>版本{c.ordinal===0?'A':'B'}：{c.state} · {c.providerMetadata?.model??'chirp-v6'} · {c.providerMetadata?.duration??'待核对'} 秒</p><button disabled={c.state!=='ready'||!c.assetId} onClick={()=>play({id:c.id,title:'示例作品A · '+(c.ordinal===0?'A':'B'),artistId:state.draft.artistId,assets:{audio_A:c.assetId}})}>试听真实版本{c.ordinal===0?'A':'B'}</button></div>)}
  {op?.state==='unknown'&&<button disabled={busy} onClick={()=>void action('recover')}>只读核对原受理结果（不重发）</button>}
  {state?.candidates?.some((c:any)=>c.state==='download_failed')&&<button disabled={busy} onClick={()=>void action('retryDownloads')}>重试原A/B音频下载（不重新生成）</button>}
  {ready===2&&<button disabled={busy} onClick={()=>void action('import')}>将真实A/B音频导入作品库</button>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
