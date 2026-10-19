import {credentialIdentitySchema} from '../shared/api-profiles';
import {planModelEvidenceSchema,type PlanModelEvidence} from '../shared/plan-models';
import type {ApiCredentials} from './api-credentials';

type Options={
  credentials:Pick<ApiCredentials,'readMusicModelEvidence'>&Partial<Pick<ApiCredentials,'withMusicModelEvidence'>>;
  rpc:(method:string,input:any)=>Promise<{ok:true;value:any}|{ok:false;error:{code:string}}>;
  available:()=>boolean;
  generation:()=>number;
};
/** Main owns the read-only credential use; the UI can request refresh, never supply evidence. */
export function createPlanModelBroker(o:Options){
  return {async ui(action:string,input?:unknown){
    if(action!=='refresh')throw Error('PLAN_MODEL_ACTION_UNSUPPORTED');
    const identity=credentialIdentitySchema.parse(input),generation=o.generation();
    const active=()=>{if(o.generation()!==generation)throw Error('WORKSPACE_CHANGED');if(!o.available())throw Error('PRODUCTION_REQUIRED');};
    active();
    const record=async(raw:PlanModelEvidence)=>{
      active();
      const evidence=planModelEvidenceSchema.parse(raw);
      if(evidence.profileId!==identity.profileId||evidence.profileRevision!==identity.expectedRevision)throw Error('MODEL_EVIDENCE_SCOPE_MISMATCH');
      const result=await o.rpc('internal.planCenter.recordModelEvidence',{evidence});
      active();
      if(!result.ok)throw Error(result.error.code);
      return result.value;
    };
    if(o.credentials.withMusicModelEvidence)return o.credentials.withMusicModelEvidence(identity,record);
    // Read-only injected services may not own a mutable credential vault.
    return record(await o.credentials.readMusicModelEvidence(identity));
  }};
}
