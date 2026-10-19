import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Repository} from '../database';
import {InboxChannelSchema} from '../../shared/inbox';
import {PlanDotRequestSchema,PlanDotAssociationSchema,planDotRequestPrefix,planDotAssociationPrefix} from '../../shared/plan-dot';
import {inboxHash} from './service';
import {validateBridgeProject} from './dot-delivery-bridge';
import {assertInboxPath} from './receiver';
import {directory,read,json,writeJson} from './dot-delivery-files';

const statusKey='plan-dot:bridge-projection';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const ProjectionSchema=z.strictObject({
 projectionVersion:z.literal(2),producer:z.literal('rainfall-plan-center'),protocolVersion:z.literal(2),transport:z.literal('local-files'),
 ownerId:z.uuid(),projectionSequence:z.number().int().positive().max(999999999999),
 channelId:z.string().min(1),workspaceId:z.string().min(1),workspaceRef:z.string().min(1),
 requests:z.array(PlanDotRequestSchema),associations:z.array(PlanDotAssociationSchema),
 requestStates:z.array(z.strictObject({requestId:z.string().min(1),state:z.enum(['pending','stopped','expired','consumed','terminal'])})),contentHash:hash,
});
type Manifest=z.infer<typeof ProjectionSchema>;
const StatusSchema=z.strictObject({state:z.enum(['projected','unchanged','not_configured','disabled','blocked']),file:z.string().nullable(),contentHash:hash.nullable(),reason:z.string().optional()});
export type DotBridgeProjection=z.infer<typeof StatusSchema>;
const inactive=(state:'not_configured'|'disabled'):DotBridgeProjection=>({state,file:null,contentHash:null});
const blocked=(reason:string):DotBridgeProjection=>({state:'blocked',file:null,contentHash:null,reason});
const reason=(error:unknown)=>error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'DOT_BRIDGE_REQUEST_SCHEMA_REJECTED';
const filename=(body:Manifest)=>`plan-requests-${String(body.projectionSequence).padStart(12,'0')}-${body.contentHash}.json`;
export function planDotBridgeStatus(repo:Repository):DotBridgeProjection{
 const bridge=repo.maybe('settings','inbox-bridge'),channel=repo.maybe('settings','inbox-channel');
 if(!bridge)return inactive('not_configured');
 if(!bridge.enabled||!channel?.enabled)return inactive('disabled');
 const parsed=StatusSchema.safeParse(repo.maybe('settings',statusKey)?.projection);
 return parsed.success?parsed.data:inactive('not_configured');
}
type Reservation={file:string;body:Manifest;projectRoot:string;bridgeRevision:number;channelRevision:number};
/** Reserve in a standalone durable commit; publishing must never precede this commit. */
function reserve(repo:Repository,inboxRoot:string,at:Date):Reservation|DotBridgeProjection{
 return repo.transaction(()=>{
  const bridge=repo.maybe('settings','inbox-bridge'),savedChannel=repo.maybe('settings','inbox-channel');
  if(!bridge)return inactive('not_configured');
  if(!bridge.enabled||!savedChannel?.enabled)return inactive('disabled');
  if(!['native-directory-picker','authorized-local-setup'].includes(bridge.source))throw Error('BRIDGE_AUTHORIZATION_REQUIRED');
  const channel=InboxChannelSchema.parse(savedChannel.channel),{projectRoot}=validateBridgeProject(bridge.projectRoot,inboxRoot),folder=path.join(projectRoot,'requests');
  assertInboxPath(folder);
  const requests=repo.all('settings').filter(r=>r.id.startsWith(planDotRequestPrefix)).map(r=>PlanDotRequestSchema.parse(r.request))
   .filter(r=>r.channelId===channel.id&&r.workspaceId===channel.workspaceId&&r.workspaceRef===channel.workspaceRef);
  for(const r of requests){const {requestHash,...body}=r;if(inboxHash(body)!==requestHash)throw Error('DOT_REQUEST_HASH_MISMATCH');}
  const owners=new Map(requests.map(r=>[r.requestId,r]));
  const associations=repo.all('settings').filter(r=>r.id.startsWith(planDotAssociationPrefix)).map(r=>PlanDotAssociationSchema.parse(r.association))
   .filter(a=>owners.get(a.requestId)?.requestHash===a.requestHash);
  const requestStates=requests.map(r=>{
   const run=repo.maybe('settings','plan-center:run:'+r.runId)?.value;
   const state=run?.stopRequested||run?.state==='stopped'?'stopped':at.getTime()>=Date.parse(r.expiresAt)?'expired':!run||['completed','failed'].includes(run.state)?'terminal':associations.some(a=>a.requestId===r.requestId)?'consumed':'pending';
   return {requestId:r.requestId,state};
  });
  const ownerKey='plan-dot:bridge-owner:'+inboxHash([projectRoot.toLowerCase(),channel.id,channel.workspaceId]);
  const owner=repo.maybe('settings',ownerKey);
  if(!owner&&fs.existsSync(folder)&&fs.readdirSync(folder).some(name=>/^plan-requests.*\.json$/i.test(name)))throw Error('BRIDGE_REQUEST_OWNERSHIP_CONFLICT');
  const ownerId=z.uuid().parse(owner?.ownerId??randomUUID());
  const snapshot={projectionVersion:2 as const,producer:'rainfall-plan-center' as const,protocolVersion:2 as const,transport:'local-files' as const,
   ownerId,channelId:channel.id,workspaceId:channel.workspaceId,workspaceRef:channel.workspaceRef,requests,associations,requestStates};
  const snapshotHash=inboxHash(snapshot),previous=owner?.reservationId?repo.maybe('settings',owner.reservationId):undefined;
  let body:Manifest;
  if(previous?.snapshotHash===snapshotHash){
   body=ProjectionSchema.parse(previous.body);const {contentHash,...content}=body;
   if(body.ownerId!==ownerId||inboxHash(content)!==contentHash)throw Error('BRIDGE_REQUEST_OWNERSHIP_CONFLICT');
  }else{
   const projectionSequence=(owner?.lastSequence??0)+1;
   if(!Number.isSafeInteger(projectionSequence)||projectionSequence>999999999999)throw Error('BRIDGE_SEQUENCE_EXHAUSTED');
   const content={...snapshot,projectionSequence};body=ProjectionSchema.parse({...content,contentHash:inboxHash(content)});
   if(Buffer.byteLength(JSON.stringify(body),'utf8')>8*1024*1024)throw Error('DOT_BRIDGE_REQUEST_LIMIT');
   const reservationId='plan-dot:bridge-generation:'+inboxHash([ownerId,projectionSequence]);
   repo.save('settings',{id:reservationId,snapshotHash,body,file:path.join(folder,filename(body))});
   repo.save('settings',{id:ownerKey,ownerId,lastSequence:projectionSequence,reservationId});
  }
  return {file:path.join(folder,filename(body)),body,projectRoot,bridgeRevision:bridge.revision,channelRevision:savedChannel.revision};
 });
}
function matchesReservedFile(file:string,body:Manifest){
 try{
  const current=ProjectionSchema.parse(json(read(file,8*1024*1024))),{contentHash,...content}=current;
  return inboxHash(content)===contentHash&&inboxHash(current)===inboxHash(body);
 }catch{return false;}
}
/** Existing immutable generations are never replaced. Consumers scan highest complete sequence. */
export function projectPlanDotBridgeRequests(repo:Repository,inboxRoot:string,at:Date=new Date()):DotBridgeProjection{
 if(repo.db.inTransaction)return blocked('BRIDGE_PROJECTION_REQUIRES_COMMIT');
 let result:DotBridgeProjection;
 try{
  const reservation=reserve(repo,inboxRoot,at);
  if('state' in reservation)result=reservation;
  else{
   const {file,body,projectRoot}=reservation,folder=path.dirname(file),bridge=repo.maybe('settings','inbox-bridge'),channel=repo.maybe('settings','inbox-channel');
   if(!bridge?.enabled||!channel?.enabled)throw Error('BRIDGE_CONFIGURATION_CHANGED');
   if(bridge.revision!==reservation.bridgeRevision||channel.revision!==reservation.channelRevision||path.resolve(bridge.projectRoot)!==projectRoot)throw Error('BRIDGE_CONFIGURATION_CHANGED');
   validateBridgeProject(projectRoot,inboxRoot);assertInboxPath(folder);assertInboxPath(file);
   const relative=path.relative(projectRoot,file);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('BRIDGE_REQUEST_PATH_ESCAPE');
   if(fs.existsSync(file)){
    if(!matchesReservedFile(file,body))throw Error('BRIDGE_REQUEST_OWNERSHIP_CONFLICT');
    result={state:'unchanged',file,contentHash:body.contentHash};
   }else{
    directory(folder);validateBridgeProject(projectRoot,inboxRoot);assertInboxPath(file);
    try{writeJson(folder,filename(body),body,true);result={state:'projected',file,contentHash:body.contentHash};}
    catch(error){
     // Competing sync arrivals are recoverable only when their complete bytes
     // match our already committed reservation. No destination is replaced.
     if(fs.existsSync(file)&&matchesReservedFile(file,body))result={state:'unchanged',file,contentHash:body.contentHash};
     else if(fs.existsSync(file))throw Error('BRIDGE_REQUEST_OWNERSHIP_CONFLICT');
     else throw error;
    }
   }
  }
 }catch(error){result=blocked(reason(error));}
 try{
  const previous=repo.maybe('settings',statusKey)?.projection;
  if(inboxHash(previous??null)!==inboxHash(result))repo.save('settings',{id:statusKey,projection:result});
 }catch(error){return blocked(reason(error));}
 return result;
}
