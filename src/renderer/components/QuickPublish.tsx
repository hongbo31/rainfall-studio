import HelpNote from "./HelpNote";
import React, {useState} from 'react';
import {useStudio, names, label, Badge} from '../context';
import {resolveQuickPublish, type RecordingSelection} from '../../shared/quick-publish';
const platforms = ['netease','qishui','qqmusic','kugou','douyin'];
export default function QuickPublish({onBatch}:{onBatch:(id:string)=>void}) {
  const {data,selected,setSelected,call,go} = useStudio();
  const [targets,setTargets] = useState<string[]>([]), [query,setQuery] = useState('');
  const [scopes,setScopes] = useState<Record<string,string>>({}), [overrides,setOverrides] = useState<Record<string,string>>({});
  const [busy,setBusy] = useState(false), [message,setMessage] = useState('');
  const works = data.works.filter((w:any) => selected.includes(w.id));
  const recordings:RecordingSelection[] = works.flatMap((w:any) => {
    const scope = scopes[w.id];
    return (scope === 'both' ? ['audio_A','audio_B'] : scope ? [scope] : []).map(slot => ({workId:w.id,slot:slot as RecordingSelection['slot']}));
  });
  const input={workIds:works.map((w:any)=>w.id),targets,recordings,accountOverrides:overrides};
  const resolved=resolveQuickPublish({mode:data.mode,works:data.works,accounts:data.accounts,bindings:data.bindings},input);
  const toggleWork=(id:string)=>{setMessage('');setSelected(selected.includes(id)?selected.filter(x=>x!==id):[...selected,id]);};
  const publish=async()=>{
    if(busy)return;setBusy(true);setMessage('');
    try {
      const result=await call('publish.quick',input);onBatch(result.batch.id);
      setMessage(result.started?'已加入本地模拟队列；未向平台投稿。':'已保存本地预检批次。请查看下方需处理事项；没有重新提交已有批次。');
    }catch(e:any){setMessage(e.message);}finally{setBusy(false);}
  };
  return <section className="panel quick-publish" aria-label="选择音乐并发布">
    <div className="section-title"><div><h2>选择音乐，准备发布</h2><HelpNote label="发布准备说明">已有素材自动带入，只处理缺少的信息。</HelpNote></div><Badge>{works.length} 首已选</Badge></div>
    <div className="quick-publish-grid">
      <div className="quick-publish-music">
        <h3>1 · 选择音乐</h3>
        <label>搜索作品<input type="search" placeholder="输入歌名" value={query} onChange={e=>setQuery(e.target.value)}/></label>
        <div className="quick-music-list">
          {data.works.filter((w:any)=>w.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((w:any)=><article className={'quick-music-row '+(selected.includes(w.id)?'is-selected':'')} key={w.id}>
            <label className="inline-check"><input type="checkbox" checked={selected.includes(w.id)} onChange={()=>toggleWork(w.id)}/><b>{w.title}</b></label>
            <small>{data.artists.find((a:any)=>a.id===w.artistId)?.name || '艺人待确认'} · {w.assets?.audio_A?'音频 A 已有':'缺少音频'}{w.assets?.audio_B?' / B 已有':''} · {w.assets?.cover?'封面已有':'缺少封面'} · {w.lyrics?.trim()?'歌词已有':'缺少歌词'}</small>
            {selected.includes(w.id)&&w.assets?.audio_B&&<label>本次发行录音<select aria-label={w.title+'本次发行录音'} value={scopes[w.id]||''} onChange={e=>{setScopes({...scopes,[w.id]:e.target.value});setMessage('');}}><option value="">请选择 A、B 或两版</option><option value="audio_A">仅 A 版</option><option value="audio_B">仅 B 版</option><option value="both">A、B 两版分别准备</option></select></label>}
          </article>)}
          {!data.works.length&&<p>作品库暂无音乐。<button onClick={()=>go('creation')}>去创作</button></p>}
        </div>
      </div>
      <div>
        <h3>2 · 选择平台</h3>
        <div className="quick-platform-list">{platforms.map(target=><label className={'quick-platform '+(targets.includes(target)?'is-selected':'')} key={target}><input type="checkbox" checked={targets.includes(target)} onChange={()=>{setTargets(targets.includes(target)?targets.filter(x=>x!==target):[...targets,target]);setMessage('');}}/><span><b>{names[target]}</b><small>{target==='douyin'?'视频投稿 · 需 MP4':'音频发行'}</small></span></label>)}</div>
        {targets.map(target=>{
          const options=resolved.options[target]||[], destination=resolved.destinations.find(d=>d.target===target);
          const available=options.filter(o=>o.eligible);
          return <div className="quick-account" key={target}><small>{names[target]} · {destination?data.accounts.find((a:any)=>a.id===destination.accountId)?.name:'账号授权待处理'}</small>
            {available.length>1&&<label>选择发布账号<select aria-label={names[target]+'发布账号'} value={overrides[target]||''} onChange={e=>{setOverrides({...overrides,[target]:e.target.value});setMessage('');}}><option value="">请选择账号</option>{available.map(o=><option key={o.account.id} value={o.account.id}>{o.account.name}</option>)}</select></label>}
          </div>;
        })}
        <details className="quick-advanced"><summary>高级设置 · 账号与默认资料</summary>
          <HelpNote label="账号选择说明">唯一有效艺人绑定自动带入。账号登录状态须核实，昵称不能替代账号身份。</HelpNote>
          {targets.map(target=><label key={target}>{names[target]}账号<select value={overrides[target]||''} onChange={e=>{const next={...overrides};if(e.target.value)next[target]=e.target.value;else delete next[target];setOverrides(next);setMessage('');}}><option value="">自动选择唯一有效账号</option>{(resolved.options[target]||[]).map(o=><option key={o.account.id} value={o.account.id}>{o.account.name} · {label(o.account.authStatus)}</option>)}</select></label>)}
          {works.map((w:any)=><div className="quick-defaults" key={w.id}><b>{w.title}</b><small>曲风 {w.config?.genre||'待填'} · 语言 {w.config?.language||'待填'}</small><small>权益依据：{w.rights||'待确认'}</small><small>作者与协议待核对</small><button onClick={()=>go('track',w.id)}>查看素材与授权依据</button></div>)}
          <button onClick={()=>go('accounts')}>管理账号与艺人绑定</button>
        </details>
      </div>
    </div>
    <div className="quick-publish-footer">
      {resolved.issues.length>0&&<div className="notice" aria-live="polite">{resolved.issues.map(issue=><div key={issue}>{platforms.reduce((text,p)=>text.replace(p,names[p]),issue)}</div>)}</div>}
      <div className="button-row"><button className="primary" disabled={busy||resolved.issues.length>0} onClick={publish}>{busy?'正在预检…':data.mode==='simulation'?'发布（本地模拟）':'发布（先检查材料）'}</button><small>{data.mode==='simulation'?'仅本地演练，费用 ¥0。':'仅本地预检 · 未上传'}</small></div>
      {message&&<p className="notice" role="status">{message}</p>}
    </div>
  </section>;
}
