import {assertPublicationUploadReceipt,readPublicationAfterRecovery} from '../../core/publication-foundation';
import type {TmeAsset,TmeDraft,TmeIdentity,TmeRemote} from '../../shared/tme';
export type UploadRole='audio'|'cover'|'proof';
export type Observation={identity:TmeIdentity|null;contractVerified:boolean;blockedReason:string|null;source:'browser'|'fixture'};
export type Reconciled={known:boolean;identity:TmeIdentity|null;uploads:TmeDraft['uploads'];remote:TmeRemote|null;fingerprint:string|null};
export interface TmeBrowserPort{
 observe(draft?:TmeDraft):Promise<Observation>;
 reconcile(draft:TmeDraft):Promise<Reconciled>;
 fillFields(draft:TmeDraft):Promise<void>;
 upload(role:UploadRole,asset:TmeAsset):Promise<{remoteId:string;sha256:string}>;
 saveDraft():Promise<void>;
}
export interface DraftStore{
 get(id:string):Promise<TmeDraft>;list():Promise<TmeDraft[]>;
 update(id:string,revision:number,patch:Partial<TmeDraft>):Promise<TmeDraft>;
 assertCurrent(draft:TmeDraft):Promise<void>;
 bind(id:string,revision:number,identity:TmeIdentity):Promise<TmeDraft>;
}
export type DraftAuthorization={identity:TmeIdentity;reviewHash:string;confirmed:boolean};
const identityEqual=(a:TmeIdentity|null,b:TmeIdentity)=>!!a&&(['subject','device','session','source'] as const).every(k=>a[k]===b[k]);
export class TmeCoordinator{
 private busy=false;
 constructor(private store:DraftStore,private browser:TmeBrowserPort){}
 async run(id:string,authorization:DraftAuthorization){
  if(!authorization.confirmed)throw Error('USER_CONFIRMATION_REQUIRED');
  if(this.busy)throw Error('TME_BUSY');
  this.busy=true;
  let d:TmeDraft;
  try{
   d=await this.store.get(id);
   if(d.reviewHash!==authorization.reviewHash)throw Error('REVIEW_STALE');
   if(d.issues.length)throw Error('PREFLIGHT_BLOCKED');
  }catch(e){this.busy=false;throw e;}
  const update=async(p:Partial<TmeDraft>)=>d=await this.store.update(d.id,d.revision,p);
  const guard=async()=>{
   await this.store.assertCurrent(d);
   const observed=await readPublicationAfterRecovery(()=>this.browser.observe(d));
   if(!observed.contractVerified)throw Error('PAGE_CONTRACT_UNVERIFIED');
   if(observed.blockedReason)throw Error(observed.blockedReason);
   if(!identityEqual(observed.identity,authorization.identity))throw Error('ACCOUNT_CHANGED');
   if(d.source==='local'&&observed.source!=='browser')throw Error('FIXTURE_CANNOT_AUTHORIZE_PRODUCTION');
  };
  const reconcile=async()=>{
   await guard();const r=await this.browser.reconcile(d);
   if(!r.known)throw Error('REMOTE_STATE_UNKNOWN');
   if(!identityEqual(r.identity,authorization.identity))throw Error('ACCOUNT_CHANGED');
   for(const role of ['audio','cover','proof'] as const){
    const receipt=r.uploads[role];
    if(receipt&&receipt.sha256!==d.assets[role]?.sha256)throw Error('REMOTE_ASSET_MISMATCH');
    if(d.uploads[role]&&!receipt)throw Error('REMOTE_STATE_UNKNOWN');
   }
   await update({uploads:{...d.uploads,...r.uploads},remote:r.remote});
   return r;
  };
  try{
   await guard();d=await this.store.bind(d.id,d.revision,authorization.identity);
   const r=await reconcile();
   if(r.remote){
    if(d.metadata.existingRemoteId&&r.remote.id!==d.metadata.existingRemoteId)throw Error('REMOTE_ID_CHANGED');
    if(r.remote.status!=='draft'){
     const state={submitted:'REMOTE_SUBMITTED',rejected:'REMOTE_REJECTED',published:'REMOTE_PUBLISHED'} as const;
     return await update({state:state[r.remote.status],pendingAction:null,reason:r.remote.reason});
    }
    if(r.fingerprint===d.fingerprint)return await update({state:'DRAFT_SAVED',pendingAction:null,reason:''});
    // Existing user drafts are read-only in this MVP, including rejected-title edits.
    throw Error('EXISTING_DRAFT_REQUIRES_USER_REVIEW');
   }
   if(d.metadata.existingRemoteId)throw Error('EXISTING_REMOTE_NOT_FOUND');
   if(d.pendingAction==='save')throw Error('REMOTE_STATE_UNKNOWN');
   if(d.pendingAction&&d.pendingAction!=='fields'&&d.pendingAction!=='save'&&!r.uploads[d.pendingAction as UploadRole])throw Error('REMOTE_STATE_UNKNOWN');
   await update({state:'FILLING',pendingAction:'fields',reason:''});await guard();await this.browser.fillFields(d);await update({pendingAction:null});
   for(const role of ['audio','cover','proof'] as const){
    if(d.uploads[role])continue;
    const asset=d.assets[role];if(!asset)throw Error('ASSET_MISSING');
    await update({state:'UPLOADING',pendingAction:role});await guard();
    const receipt=await this.browser.upload(role,asset);
    assertPublicationUploadReceipt(receipt,asset.sha256,'UPLOAD_NOT_VERIFIED');
    await update({uploads:{...d.uploads,[role]:receipt},pendingAction:null});
   }
   await update({state:'SAVING',pendingAction:'save'});await guard();await this.browser.saveDraft();
   const saved=await reconcile();
   if(!saved.remote?.id||saved.remote.status!=='draft'||saved.fingerprint!==d.fingerprint)throw Error('DRAFT_READBACK_UNVERIFIED');
   return await update({state:'DRAFT_SAVED',pendingAction:null,reason:''});
  }catch(e){
   const reason=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'BROWSER_OPERATION_FAILED';
   const unknown=d.pendingAction!==null||['REMOTE_STATE_UNKNOWN','DRAFT_READBACK_UNVERIFIED'].includes(reason);
   return await update({state:unknown?'RECONCILE_REQUIRED':'BLOCKED',reason});
  }finally{this.busy=false;}
 }
}
