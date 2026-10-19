import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Studio} from './studio';
import type {Row} from './database';
import {InboxChannelSchema} from '../shared/inbox';
import {PlanDotRequestSchema,PlanDotAssociationSchema,planDotRequestPrefix,planDotAssociationPrefix,type PlanDotRequest,type PlanDotAssociation} from '../shared/plan-dot';
import {inboxHash} from './inbox/service';
import {assertInboxPath} from './inbox/receiver';
import {projectPlanDotBridgeRequests,planDotBridgeStatus} from './inbox/plan-dot-bridge';

type DotStudio=Pick<Studio,'repo'|'now'|'root'|'mode'|'planCenterService'>;
type Blocker={itemId?:string;candidateId?:string;reason:string};
const now=(s:DotStudio)=>s.now().toISOString();
function requests(s:DotStudio):PlanDotRequest[]{return s.repo.all('settings').filter(r=>r.id.startsWith(planDotRequestPrefix)).map(r=>PlanDotRequestSchema.parse(r.request));}
function associations(s:DotStudio):PlanDotAssociation[]{return s.repo.all('settings').filter(r=>r.id.startsWith(planDotAssociationPrefix)).map(r=>PlanDotAssociationSchema.parse(r.association));}
function saveAssociation(s:DotStudio,a:PlanDotAssociation){s.repo.save('settings',{id:planDotAssociationPrefix+a.requestId,association:PlanDotAssociationSchema.parse(a)});}
function sameIdentity(c:Row,r:PlanDotRequest){return c.source?.verification==='local_channel'&&c.source.channelId===r.channelId&&c.externalItemId===r.expectedExternalItemId&&c.artistId===r.artistId&&(c.artistRef??c.source.artistRef)===r.artistRef&&(!c.source.workspaceId||c.source.workspaceId===r.workspaceId)&&(!c.source.workspaceRef||c.source.workspaceRef===r.workspaceRef);}
function matches(c:Row,r:PlanDotRequest){return sameIdentity(c,r)&&c.externalRevision===r.revision;}
function collect(s:DotStudio,blockers:Blocker[]){
 const service=s.planCenterService(),rows=service.list(),allRequests=requests(s),allAssociations=associations(s);
 for(const r of allRequests){
  let associated=allAssociations.find(a=>a.requestId===r.requestId);
  if(associated&&associated.status!=='received'){
   // A text-only import may have been acknowledged before its separately verified cover arrived.
   // Preserve the original ownership/status and append only that candidate's first exact cover.
   const c=s.repo.maybe('textCandidates',associated.candidateId);
   if(c?.cover&&!associated.coverAssetId&&matches(c,r))saveAssociation(s,{...associated,coverAssetId:c.cover.assetId,coverSha256:c.cover.sha256});
   continue;
  }
  const run=rows.runs.find(run=>run.id===r.runId),item=rows.items.find(item=>item.id===r.itemId);
  if(!run||!item){blockers.push({itemId:r.itemId,reason:'DOT_REQUEST_OWNER_MISSING'});continue;}
  const candidates=s.repo.all('textCandidates').filter(c=>matches(c,r));
  const valid=candidates.filter(c=>{
   const echo=c.source.requestEcho;
   if(echo)return inboxHash(echo)===inboxHash(r);
   // All historical requests count, including consumed, stopped and expired ones.
   // Reusing a custom ID therefore never makes an old candidate the next run's material.
   // A v1 producer did not echo a request. Revisions alone cannot establish which
   // run requested a reused custom ID, even though v2 allocation now increments them.
   const owners=allRequests.filter(other=>sameIdentity(c,other));
   if(owners.length!==1){blockers.push({itemId:r.itemId,candidateId:c.id,reason:'DOT_LEGACY_AMBIGUOUS'});return false;}
   return true;
  }).filter(c=>!allAssociations.some(a=>a.candidateId===c.id&&a.requestId!==r.requestId));
  if(valid.length!==1){if(valid.length>1)blockers.push({itemId:r.itemId,reason:'DOT_CANDIDATE_AMBIGUOUS'});continue;}
  const c=valid[0],draft=s.repo.maybe('drafts',c.draftId);
  if(!draft||draft.artistId!==r.artistId){blockers.push({itemId:r.itemId,reason:'DOT_DRAFT_SCOPE_MISMATCH'});continue;}
  const stopped=run.stopRequested||run.state==='stopped',expired=Date.parse(now(s))>=Date.parse(r.expiresAt),late=stopped||expired||['completed','failed'].includes(run.state);
  let status:PlanDotAssociation['status']=stopped?'stopped':expired?'expired':late?'late':'received',reason:string|undefined;
  if(!late){
   try{service.attachDot({itemId:r.itemId,candidateId:c.id});status='attached';}
   catch(e){reason=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'DOT_ATTACH_BLOCKED';blockers.push({itemId:r.itemId,candidateId:c.id,reason});}
  }
  const a:PlanDotAssociation={requestId:r.requestId,requestHash:r.requestHash,planId:r.planId,runId:r.runId,itemId:r.itemId,candidateId:c.id,draftId:c.draftId,externalItemId:c.externalItemId,revision:c.externalRevision,channelId:r.channelId,artistRef:r.artistRef,protocolVersion:c.source.requestEcho?2:1,status,late,receivedAt:associated?.receivedAt??now(s),...(reason?{reason}:{}),...(c.cover?{coverAssetId:c.cover.assetId,coverSha256:c.cover.sha256}:{})};
  saveAssociation(s,a);if(!associated)allAssociations.push(a);
 }
}
/** Local protocol only. This creates no remote dot task and never scores candidates. */
export function syncPlanDot(s:DotStudio){
 const blockers:Blocker[]=[];
 s.repo.transaction(()=>{
  const rows=s.planCenterService().list(),existing=requests(s),configured=InboxChannelSchema.safeParse(s.repo.maybe('settings','inbox-channel')?.channel);
  // Repository.transaction uses BEGIN IMMEDIATE. Read both imported and reserved
  // revisions under that writer lock, including every stopped/expired request.
  // Existing request snapshots are never rewritten on restart or re-export.
  const revisions=new Map<string,number>(),revisionKey=(channelId:string,externalId:string)=>inboxHash([channelId,externalId]);
  const observe=(channelId:string,externalId:string,revision:number)=>{
   if(Number.isInteger(revision)&&revision>0){const key=revisionKey(channelId,externalId);revisions.set(key,Math.max(revisions.get(key)??0,revision));}
  };
  for(const r of existing)observe(r.channelId,r.expectedExternalItemId,r.revision);
  for(const c of s.repo.all('textCandidates'))if(typeof c.source?.channelId==='string'&&typeof c.externalItemId==='string')observe(c.source.channelId,c.externalItemId,c.externalRevision);
  for(const run of rows.runs){
   if(run.stopRequested||['completed','failed','stopped'].includes(run.state)||run.snapshot.material.source!=='dot')continue;
   for(const item of rows.items.filter(i=>i.runId===run.id)){
    if(existing.some(r=>r.itemId===item.id))continue;
    const material=run.snapshot.material;
    if(!configured.success||configured.data.id!==material.channel||configured.data.artistRefs[material.identity]!==run.snapshot.artistId){blockers.push({itemId:item.id,reason:'DOT_CHANNEL_IDENTITY_REQUIRED'});continue;}
    const channel=configured.data,createdAt=run.createdAt;
    const revision=(revisions.get(revisionKey(channel.id,item.expectedExternalItemId))??0)+1;
    if(revision>1000000){blockers.push({itemId:item.id,reason:'DOT_REVISION_EXHAUSTED'});continue;}
    const body={requestVersion:2 as const,requestId:randomUUID(),planId:run.planId,planRevision:run.planRevision,runId:run.id,itemId:item.id,ordinal:item.ordinal,profileIdentity:material.identity,channelId:channel.id,workspaceId:channel.workspaceId,workspaceRef:channel.workspaceRef,artistId:run.snapshot.artistId,artistRef:material.identity,expectedExternalItemId:item.expectedExternalItemId,revision,outputs:run.snapshot.outputs,brief:{title:run.snapshot.title,theme:run.snapshot.theme,styleTemplate:run.snapshot.styleTemplate},createdAt,expiresAt:new Date(Date.parse(createdAt)+7*24*60*60*1000).toISOString()};
    const request=PlanDotRequestSchema.parse({...body,requestHash:inboxHash(body)});
    s.repo.save('settings',{id:planDotRequestPrefix+request.requestId,request});existing.push(request);observe(channel.id,item.expectedExternalItemId,revision);
   }
  }
  collect(s,blockers);
  s.repo.save('settings',{id:'plan-dot:status',blockers});
 });
 return planDotStatus(s);
}
/** Safe local snapshots: no credentials, remote paths or live-write claims. */
export function planDotStatus(s:DotStudio){return {protocolVersion:2 as const,transport:'local-files' as const,requests:requests(s),associations:associations(s),blockers:(s.repo.maybe('settings','plan-dot:status')?.blockers??[]) as Blocker[],bridgeProjection:planDotBridgeStatus(s.repo)};}
/** Call after syncPlanDot on the business tick. Only existing active trusted bridge config is used. */
export function exportPlanDotBridge(s:DotStudio){return projectPlanDotBridgeRequests(s.repo,path.join(s.root,s.mode,'inbox-v1'),s.now());}
/** Explicit local export. A file bridge can read this file and return an Inbox v2 package. */
export function exportPlanDotRequests(s:DotStudio){
 const status=syncPlanDot(s),folder=path.join(s.root,s.mode,'inbox-v1','requests');
 assertInboxPath(folder);fs.mkdirSync(folder,{recursive:true});assertInboxPath(folder);
 const file=path.join(folder,'plan-dot-requests.json'),temp=path.join(folder,randomUUID()+'.tmp');assertInboxPath(file);
 const body={protocolVersion:2,transport:'local-files',exportedAt:now(s),requests:status.requests,associations:status.associations};
 const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(body,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(temp,file);
 return {protocolVersion:2 as const,transport:'local-files' as const,file,requestCount:status.requests.length,requests:status.requests,bridgeProjection:exportPlanDotBridge(s)};
}
