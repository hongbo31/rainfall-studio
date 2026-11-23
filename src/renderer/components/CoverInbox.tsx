import React,{useEffect,useState} from 'react';
import {manualCoverPrices,paidCoverModelId,supportsManualCover} from '../../shared/api-profiles';
import {useStudioRequest} from '../context';
export default function CoverInbox({workId,disabled}:{workId:string;disabled:boolean}){
 const call=useStudioRequest();const [state,setState]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;setState(null);setError('');const read=()=>void call('cover.inboxStatus',{workId}).then(rows=>{
  if(!active)return;
  setState(rows.filter((row:any)=>!row.manualGeneration&&!row.variant&&row.state!=='superseded').at(-1)??null);
 }).catch(()=>{});read();const timer=setInterval(read,5000);return()=>{active=false;clearInterval(timer)};},[workId,call]);
 const paidRetry = paidCoverModelId(state?.modelId);
 const retryProvider = state?.provider==='doubao_image'?'豆包':'智谱';
 const generationError: Record<string,string> = {
  CREDENTIAL_REQUIRED:'请在平台管理保存图像模型的 API Key。',
  IMAGE_HTTP_401:'请核对图像模型的 API Key。',
  IMAGE_HTTP_403:'请核对所选模型的开通状态和账号权限。',
  IMAGE_HTTP_429:'图像服务限流，请稍后再试。',
  IMAGE_DOWNLOAD_URL_REJECTED:'已出图，图片地址校验失败。',
  IMAGE_DOWNLOAD_FAILED:'已出图，图片下载失败。',
  ZHIPU_COVER_CONFIG_REQUIRED:'请在平台管理选择可用的默认图像模型。',
  COVER_GENERATION_CONFIG_CHANGED:'封面配置已变化，请核对配置后重试。',
  IMAGE_MODEL_CONFIRMATION_REQUIRED:'封面模型已变化，请重新打开页面核对模型和费用。',
  COVER_CONTEXT_CHANGED:'作品内容已变化，请重新生成封面。',
 };
 const reason=state?.reason==='COVER_VERSION_DUPLICATE_IMAGE'?'A、B 两版需要不同的封面。':state?.reason==='COVER_INBOX_MULTIPLE_IMAGES'?'目录中有多张封面，请只保留一张。':
  state?.reason==='COVER_INBOX_DUPLICATE_IMAGE'?'这张图已用于其他作品，请换一张。':state?.reason?'请核对图片和作品内容。':'';
 const generation=state?.generation?.state;
 const canRetry=state?.state==='waiting'&&state.reason!=='COVER_CONTEXT_CHANGED'&&state.planItemId&&supportsManualCover(state.provider)&&
  (generation==='unknown'||generation==='failed');
 const retry = async () => {
  setBusy(true);setError('');
  try {
   const queued=await call('cover.retryImage',{workId,requestId:state.requestId,...(paidRetry?{confirmedModelId:paidRetry}:{})});
   setState({...queued,provider:state.provider,modelId:state.modelId});
  } catch(e) {setError(e instanceof Error?generationError[e.message]??e.message:'封面重试未完成。');}
  finally {setBusy(false);}
 };
 const status=state?.state==='received'?'封面已匹配':state?.state==='superseded'?'已换用新目录':
  generation==='dispatching'||generation==='downloaded'?'正在生成或导入封面':
  generation==='unknown'?'生成结果待核对，可导入封面':generation==='failed'?'出图失败，可导入封面':'等待图片';
 return <div className="cover-inbox">
 {canRetry&&<button type="button" disabled={disabled||busy} onClick={()=>void retry()}>
  重试{retryProvider}封面{paidRetry?`（${manualCoverPrices[paidRetry]}）`:''}
 </button>}
 {state&&<><label>图片保存目录<input readOnly value={state.directory} aria-label="图片保存目录" onFocus={e=>e.target.select()}/></label><small>cover.png / jpg / webp · 只放一张方图 · {state.coverResolution?`目标 ${state.coverResolution} × ${state.coverResolution}`:'建议 2048 × 2048 以上'}</small><p role="status">{status}{reason&&' · '+reason}</p></>}
 {error&&<p role="alert">{error}</p>}</div>;
}
