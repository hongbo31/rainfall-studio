import {BrowserInspectSchema,BrowserRunSchema,type TmeBrowserManager} from './manager';
type Context={mode:()=>string;generation:()=>number;unavailable:()=>boolean};
export function registerTmeBrowserHandlers(register:(name:string,handler:(event:any,input:unknown)=>Promise<any>)=>void,trusted:(event:any)=>void,manager:Pick<TmeBrowserManager,'inspect'|'run'>,context:Context){
 let generation:number|null=null,busy=false;
 const available=()=>{if(context.mode()!=='production'||context.unavailable())throw Error('WORKSPACE_UNAVAILABLE')};
 const assertScope=()=>{available();if(generation!==context.generation())throw Error('WORKSPACE_CHANGED')};
 const wrap=(fn:(event:any,input:unknown)=>Promise<any>)=>async(event:any,input:unknown)=>{try{trusted(event);return{ok:true,value:await fn(event,input)}}catch(e){const code=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'TME_REQUEST_REJECTED';return{ok:false,error:{code,message:'腾讯草稿操作未完成：'+code}}}};
 register('rainfall:tme:inspect',wrap(async(_e,input)=>{available();if(busy)throw Error('TME_BUSY');const before=context.generation();generation=null;const value=await manager.inspect(BrowserInspectSchema.parse(input));available();if(before!==context.generation())throw Error('WORKSPACE_CHANGED');generation=before;return value;}));
 register('rainfall:tme:run',wrap(async(_e,input)=>{assertScope();if(busy)throw Error('TME_BUSY');const value=BrowserRunSchema.parse(input);busy=true;try{return await manager.run(value)}finally{busy=false}}));
 return{isBusy:()=>busy,assertScope,invalidate:()=>{generation=null;}};
}
