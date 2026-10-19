import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
type Emitter={on:(name:any,callback:(...args:any[])=>void)=>any};
type Options={root:string;app:Emitter;processEvents:Emitter;crashReporter:{start:(options:any)=>void};metadata:{pid:number;appVersion:string;electronVersion:string};maxBytes?:number};
/** Best-effort local diagnostics. It never changes sandbox/GPU flags or uploads reports. */
export function installNativeDiagnostics(o:Options){
 const dir=path.join(o.root,'diagnostics'),file=path.join(dir,'native-lifecycle.jsonl'),sessionId=randomUUID(),maxBytes=o.maxBytes??1024*1024;
 const record=(event:string,fields:Record<string,unknown>={})=>{
  try{
   fs.mkdirSync(dir,{recursive:true});
   if(fs.existsSync(file)&&fs.statSync(file).size>=maxBytes){
    if(fs.existsSync(file+'.2'))fs.unlinkSync(file+'.2');
    if(fs.existsSync(file+'.1'))fs.renameSync(file+'.1',file+'.2');
    fs.renameSync(file,file+'.1');
   }
   fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),pid:o.metadata.pid,sessionId,event,...fields})+'\n');
  }catch{/* Diagnostics must not become a new source of application failure. */}
 };
 const reasons=new Set(['clean-exit','abnormal-exit','killed','crashed','oom','launch-failed','integrity-failure']);
 const types=new Set(['GPU','Utility','Renderer','Browser','Zygote','Sandbox helper']);
 const exit=(d:any)=>({reason:reasons.has(d?.reason)?d.reason:'unknown',exitCode:Number.isInteger(d?.exitCode)?d.exitCode:null});
 record('entry',{appVersion:o.metadata.appVersion,electronVersion:o.metadata.electronVersion});
 try{o.crashReporter.start({productName:'Rainfall Studio',uploadToServer:false,ignoreSystemCrashHandler:false});record('crash-reporter-local-only')}catch{record('crash-reporter-unavailable')}
 o.app.on('child-process-gone',(_event,d)=>record('child-process-gone',{processType:types.has(d?.type)?d.type:'unknown',...exit(d)}));
 o.app.on('web-contents-created',(_event,wc:Emitter)=>wc.on('render-process-gone',(_e,d)=>record('render-process-gone',exit(d))));
 for(const event of ['ready','before-quit','will-quit','second-instance'])o.app.on(event,()=>record(event));
 o.app.on('quit',(_event,code)=>record('quit',{exitCode:Number.isInteger(code)?code:null}));
 o.processEvents.on('uncaughtExceptionMonitor',(error:any)=>record('uncaught-exception-monitor',{exceptionName:typeof error?.name==='string'&&/^[A-Za-z]+$/.test(error.name)?error.name:'Error',exceptionCode:typeof error?.code==='string'&&/^[A-Z0-9_]{1,50}$/.test(error.code)?error.code:null}));
 return{file,sessionId};
}

