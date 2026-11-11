import fs from 'node:fs';
import path from 'node:path';
import {digest} from './assets';
import {hash, type Row} from './database';

/** Shared mechanics only. Platform journal keys and state names remain compatible. */
export type PublicationPhase = 'prepared' | 'writing' | 'unknown' | 'contract_pending' | 'draft' | 'submitted' | 'reviewing' | 'published' | 'blocked';
export const tmePreparationPhases: Readonly<Record<string,PublicationPhase>> = Object.freeze({ready:'prepared',dispatching:'writing',reconcile_required:'unknown',awaiting_terms_review:'contract_pending',blocked:'blocked'});
export const fanqiePreparationPhases: Readonly<Record<string,PublicationPhase>> = Object.freeze({prepared:'prepared',uploading:'writing',unknown:'unknown',contract_pending:'contract_pending',submitted:'submitted',reviewing:'reviewing',published:'published',rejected:'blocked',withdrawn:'blocked'});
export function publicationPhase(state:string, policy:Readonly<Record<string,PublicationPhase>>):PublicationPhase {
  return policy[state] ?? 'unknown';
}
export function interruptedPublicationState(state:string, policy:Readonly<Record<string,PublicationPhase>>, unknownState:string) {
  return publicationPhase(state,policy)==='writing' ? unknownState : state;
}
export function nextPublicationCheckpoint<T extends {revision:number}>(current:T, patch:Partial<T>, expected=current.revision, conflict='REVISION_CONFLICT'):T {
  if(current.revision!==expected || !Number.isInteger(current.revision) || current.revision<0)throw Error(conflict);
  return {...current,...patch,revision:current.revision+1};
}
/** Existing Tencent family hashes intentionally retain their historical two-component layout. */
export function publicationRecordingKey(platform:'tme'|'fanqie', subject:string, recording:string, artist?:string) {
  if(!['tme','fanqie'].includes(platform)||!subject?.trim() || !/^[a-f0-9]{64}$/.test(recording) || platform==='fanqie'&&!artist?.trim())throw Error('PUBLICATION_RECORDING_SCOPE_REQUIRED');
  return hash(platform==='tme'?[subject,recording]:['fanqie',subject,artist,recording]);
}
export function assertPublicationFile(asset:{file:string;sha256:string;bytes?:number}, policy:{error:string;maxBytes?:number;rejectSymlinks?:boolean}) {
  try {
    if(!path.isAbsolute(asset.file)||!/^[a-f0-9]{64}$/.test(asset.sha256))throw Error('FORMAT');
    const stat=fs.statSync(asset.file);
    if(!stat.isFile()||asset.bytes!==undefined&&stat.size!==asset.bytes||policy.maxBytes!==undefined&&stat.size>policy.maxBytes||
       policy.rejectSymlinks&&fs.lstatSync(asset.file).isSymbolicLink()||digest(asset.file)!==asset.sha256)throw Error('CHANGED');
  }catch{throw Error(policy.error)}
}
export function assertPublicationUploadReceipt(receipt:{remoteId?:string;sha256?:string}|undefined, expectedSha:string, error:string):asserts receipt is {remoteId:string;sha256:string} {
  if(!receipt?.remoteId?.trim()||receipt.sha256!==expectedSha)throw Error(error);
}
/** Retry only a read after a supported recovery; never accepts a write callback. */
export async function readPublicationAfterRecovery<T>(read:()=>Promise<T>, recovery?:{reclaim:()=>Promise<void>;retryable:(error:unknown)=>boolean}):Promise<T> {
  try{return await read()}catch(error){if(!recovery?.retryable(error))throw error;await recovery.reclaim();return read()}
}
/** Common diagnostic schema excludes names, paths, lyrics, contract text and raw errors. */
export function auditPublicationTransition(repo:{audit?:(type:string,id:string,details:Row)=>unknown}, input:{platform:'tme'|'fanqie';id:string;state:string;revision:number;reason?:string|null}) {
  const code=input.reason&&/^[A-Z0-9_]{1,120}$/.test(input.reason)?input.reason:undefined;
  repo.audit?.('publication.checkpoint',input.id,{platform:input.platform,state:input.state,revision:input.revision,...(code?{reason:code}:{})});
}
