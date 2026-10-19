import HelpNote from "./HelpNote";
import React,{useEffect,useState} from 'react';
import {useStudio} from '../context';
import type {ApiProfile} from '../../shared/api-profiles';
import LiveMusicPanel from './LiveMusicPanel';
export default function LiveMusicWorkspace(){
 const {data,go}=useStudio();const [profiles,setProfiles]=useState<ApiProfile[]>([]),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;setLoading(true);void(async()=>{
  if(data.mode!=='production'){if(active){setProfiles([]);setLoading(false)}return}
  const result=await window.rainfall.call('apiProfile.list');if(!result.ok)throw Error('PROFILE_LOOKUP_FAILED');
  const ready:ApiProfile[]=[];for(const p of result.value.filter((p:ApiProfile)=>p.providerId==='yourmusic'&&p.kind==='music')){const status=await window.rainfall.apiCredentialStatus({profileId:p.id});if(status.ok&&status.value.configured)ready.push(p)}
  if(active){setProfiles(ready);setLoading(false)}
 })().catch(()=>{if(active){setProfiles([]);setLoading(false)}});return()=>{active=false}},[data.mode]);
 if(data.mode!=='production')return null;
 return <section aria-label="音乐生成工作区"><h2>音乐创作与生成</h2><HelpNote label="音乐任务说明">编辑歌词与曲风，跟踪真实生成任务，完成后把A/B音频存入作品库。任务由后台持久化，切页不会停止或重发。</HelpNote>{loading?<p>读取本机音乐配置…</p>:profiles.length?profiles.map(p=><LiveMusicPanel key={p.id} profile={p}/>):<div className="panel"><p>未配置谱乐</p><button onClick={()=>go('accounts')}>配置音乐服务</button></div>}</section>;
}
