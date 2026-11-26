import {ProviderTextRequestSchema,providerTextModelMatches,type ProviderTextRequest,type ProviderTextResult} from '../../shared/provider-text';
import {textProviderBaseUrls} from '../../shared/api-profiles';
import type {HttpTransport} from './yourmusic';
type Options={request:HttpTransport;credential:()=>Promise<string>;assertActive?:()=>void;providerId?:'deepseek'|'doubao';profileId?:string;profileRevision?:number;modelId?:string};
export class ProviderTextAdapter{
 constructor(private options:Options){}
 async invoke(raw:ProviderTextRequest,assertDispatch?:()=>Promise<void>):Promise<ProviderTextResult>{
  const input=ProviderTextRequestSchema.parse(raw);
  const base:ProviderTextResult={operationId:input.operationId,providerId:input.providerId,requestedModelId:input.modelId,status:'unknown',providerRequestId:null,providerModel:null,finishReason:null,httpStatus:null,usage:null,content:null,reason:'TEXT_OUTCOME_UNKNOWN'};
  for(const field of ['providerId','profileId','profileRevision','modelId'] as const)if(this.options[field]!==undefined&&this.options[field]!==input[field])return{...base,status:'confirmed_unsent',reason:'TEXT_CREDENTIAL_SCOPE'};
  let response,blocked=false,dispatched=false;
  const checkDispatch=async()=>{
   try{await assertDispatch?.();}catch(error){
    blocked=error instanceof Error&&error.message==='TEXT_DISPATCH_BLOCKED';
    throw error;
   }
  };
  try{this.options.assertActive?.();const credential=await this.options.credential();this.options.assertActive?.();await checkDispatch();this.options.assertActive?.();
   if(!credential||/[\r\n]/.test(credential))return{...base,status:'confirmed_unsent',reason:'TEXT_CREDENTIAL_FORMAT'};
   response=await this.options.request({method:'POST',url:textProviderBaseUrls[input.providerId]+'/chat/completions',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json',Accept:'application/json'},body:{model:input.modelId,messages:input.messages,thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:input.maxOutputTokens,stream:false},assertActive:this.options.assertActive,assertDispatch:checkDispatch,onDispatch:()=>{dispatched=true;}});
  }catch(error){
   if(blocked)return{...base,status:'confirmed_unsent',reason:'TEXT_DISPATCH_BLOCKED'};
   if(!dispatched)return{...base,status:'confirmed_unsent',reason:'TEXT_REQUEST_PREPARATION_FAILED'};
   return base;
  }
  const b=response.body,safe=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max?v:null;
  const metadata={...base,httpStatus:response.status,providerRequestId:safe(b?.id,500),providerModel:safe(b?.model,200),finishReason:safe(b?.choices?.[0]?.finish_reason,100)};
  // Error responses commonly omit usage. Classify clear balance/quota failures
  // before usage validation so they are not mistaken for an unknown receipt.
  const providerError=b?.error;
  const errorCode=typeof providerError?.code==='string'?providerError.code.toLowerCase():'';
  const errorType=typeof providerError?.type==='string'?providerError.type.toLowerCase():'';
  const errorMessage=typeof providerError?.message==='string'?providerError.message.toLowerCase():'';
  const creditErrorCodes=new Set(['insufficient_quota','insufficient_balance','billing_hard_limit_reached','quota_exceeded','credits_exhausted','payment_required']);
  const explicitCreditMessage=/(insufficient[_ -](?:account[_ -])?(?:balance|quota|credits?)|(?:balance|quota|credits?)\s+(?:is\s+)?(?:insufficient|exhausted|depleted|too low)|(?:余额|额度|点数|积分)(?:不足|已用尽|耗尽)|账户余额不足)/i.test(errorMessage);
  if(response.status===402||creditErrorCodes.has(errorCode)||creditErrorCodes.has(errorType)||explicitCreditMessage)
   return{...metadata,status:'invalid',reason:'TEXT_PROVIDER_CREDITS_REQUIRED'};
  const prompt=b?.usage?.prompt_tokens,completion=b?.usage?.completion_tokens,cached=input.providerId==='deepseek'?b?.usage?.prompt_cache_hit_tokens:(b?.usage?.prompt_tokens_details?.cached_tokens??0);
  if(![prompt,completion,cached].every(v=>Number.isInteger(v)&&v>=0&&v<=10_000_000)||cached>prompt)return{...metadata,reason:'TEXT_USAGE_UNKNOWN'};
  if(input.providerId==='deepseek'&&(!Number.isInteger(b?.usage?.prompt_cache_miss_tokens)||b.usage.prompt_cache_miss_tokens<0||cached+b.usage.prompt_cache_miss_tokens>prompt))return{...metadata,reason:'TEXT_USAGE_UNKNOWN'};
  if(!providerTextModelMatches(input,metadata.providerModel))return{...metadata,reason:'TEXT_MODEL_UNVERIFIED'};
  const measured={...metadata,usage:{promptTokens:prompt,completionTokens:completion,cachedTokens:cached}};
  if(response.status!==200||!metadata.providerRequestId||metadata.finishReason!=='stop')return{...measured,status:'invalid',reason:'TEXT_RESPONSE_METADATA_INVALID'};
  const content=b?.choices?.[0]?.message?.content;
  if(typeof content!=='string'||Buffer.byteLength(content,'utf8')>1_000_000)return{...measured,status:'invalid',reason:'TEXT_CONTENT_INVALID'};
  return{...measured,status:'complete',content,reason:null};
 }
}
