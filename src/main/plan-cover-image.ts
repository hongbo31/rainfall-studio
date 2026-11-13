import type {ApiCredentials} from './api-credentials';

type ImageTask = {
  requestId: string;
  profileId: string;
  expectedRevision: number;
};

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
        for(const {requestId,profileId,expectedRevision} of tasks){
          guard();
          const scope={requestId};
          const status=await options.credentials.apiCredentialStatus({profileId});
          if(!status.configured)continue;
          let dispatched=false;
          try{
            const task=await rpc('prepare',scope);
            const bytes=await options.credentials.generatePlanCover({profileId,expectedRevision},task.prompt,async()=>{
              guard();
              await rpc('dispatch',scope);
              dispatched=true;
              guard();
            },guard);
            guard();
            await rpc('receive',{...scope,bytes:new Uint8Array(bytes)});
            return;
          }catch(error){
            if(!current())return;
            const reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'IMAGE_OPERATION_FAILED';
            if(!dispatched&&['COVER_IMPORT_PENDING','COVER_SCOPE_MISMATCH'].includes(reason))continue;
            const unknown=dispatched&&!/^IMAGE_HTTP_4\d\d$/.test(reason);
            await rpc('failure',{...scope,unknown,reason:unknown?'IMAGE_OUTCOME_UNKNOWN':reason});
            if(dispatched)return;
          }
        }
      }finally{busy=false;}
    },
  };
}
