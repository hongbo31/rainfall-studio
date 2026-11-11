import React, {useEffect, useRef, useState} from 'react';
import type {FanqieCatalogReport} from '../../shared/fanqie-catalog';
import {checkFanqieNewUpload} from '../../shared/fanqie-catalog';

export default function FanqieCatalogPanel({mode, selectedTitles = []}: {mode: string; selectedTitles?: string[]}) {
  const [connected, setConnected] = useState(false), [busy, setBusy] = useState(false);
  const [report, setReport] = useState<FanqieCatalogReport | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [authorizationIds,setAuthorizationIds]=useState<string[]>([]);
  const epoch = useRef(0);
  useEffect(() => {
    const current = ++epoch.current; setAuthorizationIds([]); setReport(null); setError(''); setConnected(false); setBusy(false);
    if (mode === 'production' && window.rainfall?.fanqieCatalog) void window.rainfall.fanqieCatalog('status').then(r => {
      if (current === epoch.current && r.ok) {setConnected(r.value.connected); setReport(r.value.report);}
    }).catch(() => {});
    return () => {++epoch.current;};
  }, [mode]);
  useEffect(() => {
    if (!busy) return; const current = epoch.current;
    const timer = setInterval(() => {void window.rainfall.fanqieCatalog('status').then(r => {
      if (current === epoch.current && r.ok) setProgress(r.value.progress ?? '');
    }).catch(() => {});}, 1000);
    return () => clearInterval(timer);
  }, [busy]);
  if (mode !== 'production') return null;
  const run = async (action: 'open' | 'read') => {
    if (busy) return; setBusy(true); setError('');
    const current = epoch.current;
    try {
      const result = await window.rainfall.fanqieCatalog(action);
      if (current !== epoch.current) return;
      if (!result.ok) {setError(result.error.message); return;}
      setAuthorizationIds([]);setConnected(result.value.connected); setReport(result.value.report);
    } catch {if (current === epoch.current) setError('番茄窗口连接未完成，请稍后重试。');}
    finally {if (current === epoch.current) setBusy(false);}
  };
  return <section className="panel" aria-label="番茄已有作品">
    <div className="section-title"><h2>番茄已有作品</h2></div>
    <div className="actions">
      <button disabled={busy} onClick={() => void run('open')}>打开番茄工作窗口</button>
      <button disabled={busy || !connected} onClick={() => void run('read')}>{busy ? '处理中…' : '读取已有作品'}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">{progress || '正在连接…'}</p>}
    {!report && <p>在工作窗口登录后读取，核对已有歌曲。</p>}
    {report && <>
      <p role="status">账号 {report.maskedAccount} · 已读 {report.rows.length}/{report.total} 首 · {report.complete ? '列表完整' : '列表未读全'}</p>
      <table><thead><tr><th>选择</th><th>作品</th><th>状态</th><th>作品 ID</th></tr></thead><tbody>
        {report.rows.map(row => <tr key={row.id}><td>{row.stage==='contract_pending'&&<input type="checkbox" aria-label={'授权 '+row.title} disabled={busy} checked={authorizationIds.includes(row.id)} onChange={e=>setAuthorizationIds(ids=>e.target.checked?[...ids,row.id]:ids.filter(id=>id!==row.id))}/>}</td><td>{row.title}</td><td>{row.officialStatus}</td><td>{row.id}</td></tr>)}
      </tbody></table>
      {!!authorizationIds.length&&<button disabled={busy||!report.complete} onClick={async()=>{setBusy(true);setError('');const current=epoch.current;try{const r=await window.rainfall.fanqieUpload('authorizeExisting',{accountKey:report.accountKey,ids:authorizationIds});if(!r.ok)throw Error(r.error.message);if(current===epoch.current)setProgress('授权信息已准备，请在官网确认合同');}catch(e:any){if(current===epoch.current)setError(e.message)}finally{if(current===epoch.current)setBusy(false)}}}>继续授权（{authorizationIds.length} 首）</button>}
      {!busy&&progress&&<p role="status">{progress}</p>}
      <small>读取于 {new Date(report.observedAt).toLocaleString()}；待授权表示尚未签约。</small>
      {selectedTitles.map(title => {
        const check = checkFanqieNewUpload(report, title);
        return <p key={title} role="status">{title}：{check.matches.length ? '已有同名记录，请勿重复上传' : check.allowed ? '本次完整列表中未发现同名作品' : '列表未读全，暂不能排除重复'}</p>;
      })}
    </>}
  </section>;
}
