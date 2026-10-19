import type {Repository} from './database';
import {listApiProfiles} from './api-profiles';
import {credentialIdentitySchema} from '../shared/api-profiles';
import {
  planMusicModelIds, planMusicModelContract, planModelEvidenceSchema,
  recordPlanModelEvidenceSchema, type PlanModelCatalogEntry, type PlanModelEvidence,
} from '../shared/plan-models';

const cacheKey=(e:Pick<PlanModelEvidence,'profileId'|'profileRevision'|'providerId'>,modelId:string)=>
  `plan-model-evidence:${e.profileId}:${e.profileRevision}:${e.providerId}:${modelId}`;
const instant=(now:string)=>{const result=Date.parse(now);if(!Number.isFinite(result))throw Error('MODEL_EVIDENCE_TIME_INVALID');return result;};

/** Read-only catalogue. History is an account observation, never current authorization. */
export function planModelCatalog(repo:Repository,now=new Date().toISOString()):PlanModelCatalogEntry[]{
  const time=instant(now),profiles=listApiProfiles(repo).filter(p=>p.kind==='music'&&p.providerId==='yourmusic');
  return (profiles.length?profiles:[null]).flatMap(profile=>planMusicModelIds.map(modelId=>{
    let evidence:PlanModelEvidence|null=null;
    if(profile){
      const identity={profileId:profile.id,profileRevision:profile.revision,providerId:'yourmusic' as const};
      const row=repo.maybe('settings',cacheKey(identity,modelId));
      const parsed=planModelEvidenceSchema.safeParse(row?.evidence);
      if(parsed.success){
        const e=parsed.data;
        if(e.profileId===profile.id&&e.profileRevision===profile.revision&&e.providerId===profile.providerId&&
          e.models.length===1&&e.models[0].modelId===modelId&&Date.parse(e.observedAt)<=time)evidence=e;
      }
    }
    return {id:modelId,modelId,label:modelId,providerId:'yourmusic' as const,
      profileId:profile?.id??null,profileRevision:profile?.revision??null,
      contractStatus:'contract-supported' as const,
      accountStatus:evidence?(Date.parse(evidence.expiresAt)>time?'account-observed-success':'stale'):'unknown',
      verified:false as const,currentAvailability:'unknown' as const,contract:planMusicModelContract,evidence};
  }));
}

/** Internal RPC only. Renderer claims must never be routed to this function. */
export function recordPlanModelEvidence(repo:Repository,raw:unknown,now=new Date().toISOString()):PlanModelCatalogEntry[]{
  const {evidence}=recordPlanModelEvidenceSchema.parse(raw),time=instant(now);
  if(Date.parse(evidence.observedAt)>time||Date.parse(evidence.expiresAt)<=time)throw Error('MODEL_EVIDENCE_EXPIRED');
  return repo.transaction(()=>{
    const profile=listApiProfiles(repo).find(p=>p.id===evidence.profileId);
    if(!profile)throw Error('PROFILE_NOT_FOUND');
    if(profile.revision!==evidence.profileRevision)throw Error('REVISION_CONFLICT');
    if(profile.providerId!==evidence.providerId||profile.kind!=='music')throw Error('PROVIDER_NOT_CONFIGURED');
    for(const model of evidence.models){
      const id=cacheKey(evidence,model.modelId),old=planModelEvidenceSchema.safeParse(repo.maybe('settings',id)?.evidence);
      // A delayed refresh must not replace a newer success. Missing models prove nothing.
      if(old.success&&Date.parse(old.data.observedAt)>Date.parse(evidence.observedAt))continue;
      repo.save('settings',{id,evidence:{...evidence,models:[model]}});
    }
    return planModelCatalog(repo,now);
  });
}

/** Main credential-change hook only. Remove every revision before replacing/clearing its key. */
export function invalidatePlanModelEvidence(repo:Repository,raw:unknown):void{
  const {profileId,expectedRevision}=credentialIdentitySchema.parse(raw);
  repo.transaction(()=>{
    const profile=listApiProfiles(repo).find(p=>p.id===profileId);
    if(!profile)throw Error('PROFILE_NOT_FOUND');
    if(profile.revision!==expectedRevision)throw Error('REVISION_CONFLICT');
    if(profile.providerId!=='yourmusic'||profile.kind!=='music')throw Error('PROVIDER_NOT_CONFIGURED');
    const prefix=`plan-model-evidence:${profileId}:`,remove=repo.db.prepare('DELETE FROM settings WHERE id=?');
    for(const row of repo.all('settings'))if(row.id.startsWith(prefix))remove.run(row.id);
  });
}
