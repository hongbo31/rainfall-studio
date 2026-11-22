import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {FanqieAuthorizationResult} from '../../shared/fanqie';
import type {FanqieCatalogRow} from '../../shared/fanqie-catalog';
import {fanqieCatalogError} from './catalog-session';

export type BatchItem={workId:string;variant:'A'|'B'};
export type BatchState={
  id:string;accountKey:string;state:'running'|'paused'|'complete';
  items:(BatchItem&{state:'queued'|'running'|'complete'|'paused';result?:unknown;error?:string})[];
  authorization?:FanqieAuthorizationResult[];
  authorizationError?:string;
  configurationHash?:string;
  updatedAt:string;
};
/** Durable sequential queue. A failed item stops the batch; restart never blindly replays writes. */
export class FanqieBatch {
  private busy=false;
  constructor(root:string,private readonly directory=path.join(root,'production','fanqie')){}
  private file(){return path.join(this.directory,'batch.json');}
  read():BatchState|null{
    if(!fs.existsSync(this.file()))return null;
    const state=JSON.parse(fs.readFileSync(this.file(),'utf8')) as BatchState;
    if(!this.busy&&state.state==='running'){state.state='paused';for(const item of state.items)if(item.state==='running'){item.state='paused';item.error='FANQIE_RECONCILIATION_REQUIRED';}this.save(state);}
    return state;
  }
  private save(state:BatchState){state.updatedAt=new Date().toISOString();fs.mkdirSync(path.dirname(this.file()),{recursive:true});fs.writeFileSync(this.file()+'.tmp',JSON.stringify(state,null,2));fs.renameSync(this.file()+'.tmp',this.file());}
  refreshAuthorization(accountKey:string,rows:FanqieCatalogRow[]){
    const state=this.read();
    if(state?.state!=='complete'||state.accountKey!==accountKey||!state.authorization?.length)return;
    const results=state.authorization.map(record=>{
      const observed=rows.find(row=>row.id===record.id&&row.title===record.title);
      return observed&&observed.stage!=='contract_pending'&&observed.stage!=='unknown'
        ? {...record,status:observed.officialStatus,phase:'already_processed' as const}
        : record;
    });
    if(JSON.stringify(results)!==JSON.stringify(state.authorization)){
      state.authorization=results;
      this.save(state);
    }
  }
  async run(items:BatchItem[],accountKey:string,execute:(item:BatchItem)=>Promise<unknown>,guard:()=>void,resume=false,
    authorize?:(items:BatchState['items'])=>Promise<FanqieAuthorizationResult[]>,configurationHash?:string){
    if(this.busy)throw Error('FANQIE_BROWSER_BUSY');
    const prior=this.read();
    if(resume&&(!prior||prior.accountKey!==accountKey||(prior.configurationHash&&prior.configurationHash!==configurationHash)||
      JSON.stringify(prior.items.map(({workId,variant})=>({workId,variant})))!==JSON.stringify(items)))throw Error('FANQIE_BATCH_SCOPE_CHANGED');
    if(!resume&&prior?.state==='paused')throw Error('FANQIE_RECONCILIATION_REQUIRED');
    const state:BatchState=resume?prior!:{id:randomUUID(),accountKey,state:'running',items:items.map(item=>({...item,state:'queued'})),updatedAt:''};
    if(configurationHash)state.configurationHash=configurationHash;
    this.busy=true;state.state='running';this.save(state);
    try{
      for(const item of state.items){
        if(item.state==='complete')continue;
        try{guard();item.state='running';delete item.error;this.save(state);item.result=await execute({workId:item.workId,variant:item.variant});guard();item.state='complete';this.save(state);}
        catch(error){item.state='paused';item.error=fanqieCatalogError(error).code;state.state='paused';this.save(state);return state;}
      }
      if(authorize){
        try{
          guard();
          state.authorization=await authorize(state.items);
          guard();
          delete state.authorizationError;
        }catch(error){
          state.authorizationError=fanqieCatalogError(error).code;
          state.state='paused';
          this.save(state);
          return state;
        }
      }
      state.state='complete';this.save(state);return state;
    }finally{this.busy=false;}
  }
}
