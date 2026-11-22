import type {ApiCredentials} from './api-credentials';
import sharp from 'sharp';
import {COVER_API_IMAGE_MAX_BYTES,COVER_IMAGE_POLICY,coverResolutionSchema} from '../shared/cover-handoff';

type ImageTask = {
  requestId: string;
  profileId: string;
  expectedRevision: number;
  modelId?: string;
  manualGeneration?: boolean;
};

export async function resizeCover(bytes:Buffer,rawResolution:unknown,outputFormat?:'jpeg') {
  if(rawResolution===undefined)return bytes;
  const size=coverResolutionSchema.parse(rawResolution);
  const image=sharp(bytes,{limitInputPixels:COVER_IMAGE_POLICY.maxPixels});
  const {width,height,pages,format}=await image.metadata();
  if(!width||height!==width||width<COVER_IMAGE_POLICY.minEdge||width>COVER_IMAGE_POLICY.maxEdge||(pages??1)>1)
    throw Error('IMAGE_DIMENSIONS');
  if(width===size&&(!outputFormat||format===outputFormat))return bytes;
  const resized=image.resize(size,size);
  const output=await resized.clone().jpeg({quality:85,mozjpeg:true}).toBuffer();
  return output.length<=COVER_API_IMAGE_MAX_BYTES ? output : resized.jpeg({quality:65,mozjpeg:true}).toBuffer();
}

export function createPlanCoverImageRunner(options:{
  rpc:(method:string,input?:unknown)=>Promise<any>;
  credentials:Pick<ApiCredentials,'apiCredentialStatus'|'generatePlanCover'>;
  available:()=>boolean;
  generation:()=>number;
}){
  let busy=false;
  async function rpc(action:string,input:unknown={}){
    const result=await options.rpc('internal.planCoverImage.'+action,input);
    if(!result.ok)throw Error(result.error?.code??'IMAGE_OPERATION_FAILED');
    return result.value;
  }
  return {
    async pump(){
      if(busy||!options.available())return;
      busy=true;
      const generation=options.generation();
      const current=()=>options.available()&&generation===options.generation();
      const guard=()=>{if(!current())throw Error('WORKSPACE_CHANGED');};
      try{
        const tasks:ImageTask[]=await rpc('list');
        for(const {requestId,profileId,expectedRevision,modelId,manualGeneration} of tasks){
          guard();
          const scope={requestId};
          const status=await options.credentials.apiCredentialStatus({profileId});
          if(!status.configured){
            if(manualGeneration)await rpc('failure',{...scope,unknown:false,reason:'CREDENTIAL_REQUIRED'});
            continue;
          }
          let dispatched=false;
          try{
            const task=await rpc('prepare',scope);
            const bytes=await options.credentials.generatePlanCover({profileId,expectedRevision,...(modelId?{modelId}:{})},task.prompt,async()=>{
              guard();
              await rpc('dispatch',scope);
              dispatched=true;
              guard();
            },guard,task.coverResolution);
            guard();
            const cover=await resizeCover(bytes,task.coverResolution);
            guard();
            await rpc('receive',{...scope,bytes:new Uint8Array(cover)});
            return;
          }catch(error){
            if(!current())return;
            const reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'IMAGE_OPERATION_FAILED';
            if(!manualGeneration&&!dispatched&&['COVER_IMPORT_PENDING','COVER_SCOPE_MISMATCH'].includes(reason))continue;
            const unknown=dispatched&&!/^IMAGE_HTTP_4\d\d$/.test(reason);
            await rpc('failure',{...scope,unknown,reason});
            if(dispatched)return;
          }
        }
      }finally{busy=false;}
    },
  };
}
