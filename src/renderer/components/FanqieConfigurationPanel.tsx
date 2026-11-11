import React,{useEffect,useState} from 'react';
import {useStudio} from '../context';
import FanqieCatalogPanel from './FanqieCatalogPanel';
export default function FanqieConfigurationPanel(){
 const {data}=useStudio();
 const [authorizationPreference,setAuthorizationPreference]=useState<{mode:'exclusive'|'nonexclusive';platforms:('fanqie_music'|'fanqie_audio')[];confirmContractManually:true}>({mode:'exclusive',platforms:['fanqie_music','fanqie_audio'],confirmContractManually:true});
 const [authors,setAuthors]=useState({lyricist:'',composer:'',singer:''}),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let active=true;void window.rainfall.fanqieUpload('configuration').then(r=>{if(!active)return;if(!r.ok){setError(r.error.message);return;}const value=r.value;setAuthors(value.configuration?.authors??value.suggestedAuthors??{lyricist:'',composer:'',singer:''});setConsent(!!value.configuration?.publicationConsent);if(value.configuration?.authorizationPreference)setAuthorizationPreference(value.configuration.authorizationPreference);}).catch(()=>{if(active)setError('无法读取平台配置');});return()=>{active=false};},[data.mode]);
 if(data.mode!=='production')return <p>请在真实本地库中配置番茄音乐。</p>;
 return <section className="panel platform-configuration" aria-label="番茄音乐配置">
  <h2>番茄音乐</h2>
  <form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');setMessage('');try{const r=await window.rainfall.fanqieUpload('saveConfiguration',{version:1,authors,useWorkMaterials:true,publicationConsent:consent,authorizationPreference});if(!r.ok)throw Error(r.error.message);setMessage('已保存署名和签约偏好');}catch(e:any){setError(e.message);}finally{setBusy(false)}}}>
   <fieldset className="platform-fields" disabled={busy}>
    <div className="form-grid">{(['lyricist','composer','singer'] as const).map(role=><label key={role}>{{lyricist:'默认词作者',composer:'默认曲作者',singer:'默认歌手'}[role]}<input required maxLength={40} value={authors[role]} onChange={e=>{setAuthors({...authors,[role]:e.target.value});setMessage('')}}/></label>)}</div>
    <p className="muted">歌词、封面与 AI 标注跟随每首作品；音频使用发布时选定的版本，格式和尺寸自动处理。</p>
    <div className="form-grid"><label>签约模式<select value={authorizationPreference.mode} onChange={e=>setAuthorizationPreference({...authorizationPreference,mode:e.target.value as 'exclusive'|'nonexclusive'})}><option value="exclusive">独家签约</option><option value="nonexclusive">非独家签约</option></select></label></div>
    <fieldset><legend>发布平台</legend>{(['fanqie_music','fanqie_audio'] as const).map(platform=><label className="inline-check" key={platform}><input type="checkbox" disabled={platform==='fanqie_music'} checked={authorizationPreference.platforms.includes(platform)} onChange={e=>setAuthorizationPreference({...authorizationPreference,platforms:e.target.checked?[...authorizationPreference.platforms,platform]:authorizationPreference.platforms.filter(p=>p!==platform)})}/>{platform==='fanqie_music'?'番茄音乐':'番茄畅听'}</label>)}</fieldset>
    <p className="muted">上传后自动准备授权信息，最终合同由你确认；完整客户端流程仍待官网验收。</p>
    <label className="inline-check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>我仅选择有权发布、歌词与音频已核对的作品；点击发布即允许自动上传，停在待授权。</label>
    <button className="primary" disabled={!authorizationPreference.platforms.length||!consent||!Object.values(authors).every(v=>v.trim())}>保存配置</button>
   </fieldset>
  </form>
  {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  <details className="platform-connection"><summary>账号连接与官网作品</summary><FanqieCatalogPanel mode={data.mode}/></details>
 </section>;
}
