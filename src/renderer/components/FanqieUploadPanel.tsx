import React,{useEffect,useRef,useState} from 'react';

/** This dedicated first-step flow does not enable the unrelated multi-platform publication queue. */
export default function FanqieUploadPanel({mode,selectedTitles=[],works=[],artists=[]}:{mode:string;selectedTitles?:string[];works?:any[];artists?:any[]}) {
  const [state,setState]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[title,setTitle]=useState('');
  const [confirmed,setConfirmed]=useState(false),[progress,setProgress]=useState('');const scope=useRef(0),inFlight=useRef(false);
  const [workId,setWorkId]=useState(''),[variant,setVariant]=useState<'A'|'B'>('A'),[ai,setAi]=useState(true);
  const [authors,setAuthors]=useState({lyricist:'',composer:'',singer:''});
  const chooseWork=(id:string)=>{
    setWorkId(id);setConfirmed(false);const work=works.find(work=>work.id===id);if(!work)return;
    setVariant(work.selectedAudioVariant==='B'?'B':'A');setAi(['generated','assisted'].includes(work.ai));
    const metadata=work.publicationMetadata??work.metadata??{};
    setAuthors({lyricist:metadata.lyricist??work.lyricist??state?.defaults?.lyricist??'',composer:metadata.composer??work.composer??state?.defaults?.composer??'',singer:metadata.singer??metadata.artistName??state?.defaults?.singer??artists.find(artist=>artist.id===work.artistId)?.name??''});
  };
  useEffect(()=>{
    const epoch=++scope.current;setState(null);setError('');setConfirmed(false);setBusy(false);setProgress('');setWorkId('');inFlight.current=false;
    if(mode==='production'&&window.rainfall?.fanqieUpload)void window.rainfall.fanqieUpload('status').then(r=>{if(epoch===scope.current&&r.ok)setState(r.value)}).catch(()=>{});
    return()=>{++scope.current};
  },[mode]);
  useEffect(()=>{if(selectedTitles.length===1)setTitle(selectedTitles[0]);},[selectedTitles.join('\0')]);
  useEffect(()=>{
    if(!busy)return;const epoch=scope.current;
    const timer=setInterval(()=>{void window.rainfall.fanqieCatalog('status').then(r=>{if(epoch===scope.current&&r.ok)setProgress(r.value.progress??'')}).catch(()=>{});},1000);
    return()=>clearInterval(timer);
  },[busy]);
  if(mode!=='production')return null;
  const run=async(action:'pick'|'selectWork'|'check'|'prepare'|'upload'|'reconcile'|'recoverOpening'|'publishWork',input:any={})=>{
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setProgress('');const epoch=scope.current;
    try {
      const result=await window.rainfall.fanqieUpload(action,input);if(epoch!==scope.current)return;
      if(!result.ok){setError(result.error.message);const status=await window.rainfall.fanqieUpload('status');if(epoch===scope.current&&status.ok)setState(status.value);return;}
      setState(result.value);if(action==='pick'||action==='selectWork'){setConfirmed(false);if(result.value.bundle)setTitle(result.value.bundle.title);}
    }catch{if(epoch===scope.current)setError('番茄操作未完成，请保留工作窗口并读取已有作品核对。');}
    finally{if(epoch===scope.current){inFlight.current=false;setBusy(false);}}
  };
  const selectedBundle=state?.bundle;
  const bundle=selectedBundle?.source&&(selectedBundle.source.workId!==workId||selectedBundle.source.variant!==variant||selectedBundle.ai!==ai||JSON.stringify(selectedBundle.authors)!==JSON.stringify(authors))?null:selectedBundle;
  const result=state?.result;
  return <section className="panel" aria-label="番茄上传">
    <h2>上传番茄音乐</h2>
    <fieldset disabled={busy}>
      <legend>本地作品</legend>
      <label>作品<select aria-label="番茄上传作品" value={workId} onChange={e=>chooseWork(e.target.value)}><option value="">选择作品</option>{works.filter(work=>work.assets?.audio_A||work.assets?.audio_B).map(work=><option key={work.id} value={work.id}>{work.title}</option>)}</select></label>
      {workId&&<>
        <label>音频版本<select aria-label="番茄音频版本" value={variant} onChange={e=>{setVariant(e.target.value as 'A'|'B');setConfirmed(false);}}><option value="A">A 版</option><option value="B">B 版</option></select></label>
        {(['lyricist','composer','singer'] as const).map(role=><label key={role}>{{lyricist:'词作者',composer:'曲作者',singer:'歌手'}[role]}<input aria-label={'番茄'+{lyricist:'词作者',composer:'曲作者',singer:'歌手'}[role]} value={authors[role]} onChange={e=>{setAuthors({...authors,[role]:e.target.value});setConfirmed(false);}}/></label>)}
        <label><input type="checkbox" checked={ai} onChange={e=>{setAi(e.target.checked);setConfirmed(false);}}/>AI 作品</label>
        <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>歌词与所选音频一致，署名及素材使用权已确认</label><button disabled={!confirmed||!Object.values(authors).every(value=>value.trim())} onClick={()=>void run('publishWork',{workId,variant,authors,ai,rightsConfirmed:true,lyricsMatchConfirmed:true})}>上传番茄</button>
        <small>生成 WAV、歌词和方形封面；小封面等比放大，原素材保留。</small>
      </>}
    </fieldset>
    {busy&&<p role="status">{progress||'处理中…'}</p>}
    {error&&<p role="alert">{error}</p>}
    {result&&<p role="status">{result.title}：{result.uploaded?'官网状态：'+result.officialRecord.officialStatus:result.allowed?'未发现同名作品':result.matches?.length?'已有同名作品，已阻止重复上传':'作品列表未读全，不能开始上传'}</p>}
    {result?.matches?.map((row:any)=><p key={row.id}>{row.officialStatus} · 作品 ID {row.id}</p>)}
    {state?.jobs?.map((job:any)=><div key={job.id}><p role="status">{job.title}：{job.officialRecord?.officialStatus??(job.phase==='unknown'?'待核对，已暂停上传':'上传中')}{job.officialRecord&&` · ${job.officialRecord.id}`}</p><button disabled={busy} onClick={()=>void run('reconcile',{id:job.id})}>更新官网状态</button></div>)}
  </section>;
}
