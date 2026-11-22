import type {ApiCredentials} from './api-credentials';
import { z } from 'zod';
import {ProviderTextJobSchema,ProviderTextRequestSchema,type ProviderTextResult} from '../shared/provider-text';
type Options={credentials:Pick<ApiCredentials,'withProviderTextAdapter'|'apiCredentialStatus'>;rpc:(method:string,input?:unknown)=>Promise<any>;available:()=>boolean;generation?:()=>number;queue?:'lyricWriting'};
const {id,profileId,profileRevision,state,stopRequested}=ProviderTextJobSchema.shape;
const queueItem=z.object({id,profileId,profileRevision,state,stopRequested});
export function createProviderTextBroker(options:Options){
 let busy=false,stopped=false;
 const queue=options.queue??'providerText';
 const schema=options.queue ? queueItem : ProviderTextJobSchema;
 const rpc=async(action:string,input:unknown={})=>{const r=await options.rpc(`internal.${queue}.${action}`,input);if(!r.ok)throw Error(r.error?.code??'TEXT_RPC_FAILED');return r.value;};
 return{
  stop(){stopped=true;},
  async pump():Promise<{processed:number}>{
   if(busy||stopped||!options.available())return{processed:0};busy=true;let processed=0;
   const epoch=options.generation?.(),guard=()=>{if(stopped||!options.available()||options.generation?.()!==epoch)throw Error('WORKSPACE_CHANGED');};
   try{
    const jobs=(await rpc('list') as unknown[]).map(raw=>schema.parse(raw)).filter(j=>j.state==='ready'&&!j.stopRequested);
    for(const job of jobs){
     try{
      guard();const status=await options.credentials.apiCredentialStatus({profileId:job.profileId});guard();if(!status.configured){await rpc('note',{id:job.id,reason:status.state==='unavailable'?'SECURE_STORAGE_UNAVAILABLE':'CREDENTIAL_REQUIRED'});continue;}
      await options.credentials.withProviderTextAdapter({profileId:job.profileId,expectedRevision:job.profileRevision},async adapter=>{
      guard();const claim=await rpc('claim',{id:job.id}),request=ProviderTextRequestSchema.parse(claim.request);guard();
      let result:ProviderTextResult;
      try{result=await adapter.invoke(request,async()=>{guard();const current=await rpc('context',{id:job.id});guard();if(!current.dispatchAllowed||current.job.stopRequested||current.job.operationId!==request.operationId)throw Error('TEXT_DISPATCH_BLOCKED');});}catch{result={operationId:request.operationId,providerId:request.providerId,requestedModelId:request.modelId,status:'unknown',providerRequestId:null,providerModel:null,finishReason:null,httpStatus:null,usage:null,content:null,reason:'TEXT_OUTCOME_UNKNOWN'};}
      guard();await rpc('record',{id:job.id,operationId:request.operationId,result});processed++;
     },guard);}catch(error){guard();const message=error instanceof Error?error.message:'';const reason=['CREDENTIAL_REQUIRED','SECURE_STORAGE_UNAVAILABLE','TEXT_TRANSPORT_UNAVAILABLE','TEXT_PROFILE_OR_PRICE_REQUIRED','REVISION_CONFLICT'].includes(message)?message:'TEXT_CONFIGURATION_UNAVAILABLE';await rpc('note',{id:job.id,reason});}
    }
    return{processed};
   }finally{busy=false;}
  },
 };
}
