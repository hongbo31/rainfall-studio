import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const helper=fileURLToPath(new URL('./qa-owned-processes.ps1',import.meta.url));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function createOwnedQaRun({runDirectory,entryPath,executablePath,pwshPath=process.env.RAINFALL_QA_PWSH||'pwsh.exe',graceMs=5000}) {
  if(process.platform!=='win32')throw Error('WINDOWS_QA_OWNER_REQUIRED');
  const owner=randomUUID(),stateFile=path.join(path.resolve(runDirectory),'qa-owner.json');
  const runtimePath=path.join(path.resolve(runDirectory),'data','runtime');
  if(fs.existsSync(stateFile))throw Error('FRESH_QA_OWNER_FILE_REQUIRED');
  entryPath=path.resolve(entryPath);executablePath=path.resolve(executablePath);
  const args=action=>['-NoProfile','-NonInteractive','-File',helper,'-Action',action,'-ExecutablePath',executablePath,'-EntryPath',entryPath,'-Owner',owner,'-StateFile',stateFile,'-RuntimePath',runtimePath];
  const native=action=>JSON.parse(execFileSync(pwshPath,args(action),{encoding:'utf8',windowsHide:true,timeout:12000,maxBuffer:1024*1024}).replace(/^\uFEFF/,''));
  let finishing,launching=false,cancelled=false;
  const scope={
    owner,stateFile,runtimePath,ownerArgs:['--rainfall-qa-owner='+owner,'--user-data-dir='+runtimePath],
    bootstrapBanner(){return `(()=>{const c=require('node:child_process');const r=JSON.parse(c.execFileSync(${JSON.stringify(pwshPath)},${JSON.stringify(args('Capture'))},{encoding:'utf8',windowsHide:true,timeout:12000}));if(r.state!=='captured')throw Error('QA_OWNER_CAPTURE_FAILED');})();`},
    capture:()=>native('Capture'),
    stop:()=>native('Stop'),
    markLaunching(){if(cancelled)throw Error('QA_CANCELLED');launching=true},
    markLaunched(){launching=false},
    get cancelled(){return cancelled},
    finish({reason,close=async()=>{}}){
      if(finishing)return finishing;
      finishing=(async()=>{
        const end=Date.now()+5000;
        while(launching&&!fs.existsSync(stateFile)&&Date.now()<end)await delay(50);
        try{native('Capture')}catch{return {state:'refused',reason:'QA_OWNERSHIP_CAPTURE_FAILED',stopped:[],remaining:[]}}
        if(launching&&!fs.existsSync(stateFile))return {state:'refused',reason:'QA_LAUNCH_STILL_PENDING',stopped:[],remaining:[]};
        let timer,graceful=false;
        try{graceful=await Promise.race([Promise.resolve().then(close).then(()=>true,()=>false),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),graceMs)})])}finally{clearTimeout(timer)}
        const result=native('Stop');
        return {...result,reason,graceful};
      })();
      finishing.then(result=>{if(result.reason==='QA_LAUNCH_STILL_PENDING')finishing=undefined},()=>{});
      return finishing;
    },
    bindSignals({close,onCancel=()=>{},signalSource=process}){
      const handler=signal=>{cancelled=true;onCancel(signal);void scope.finish({reason:'cancel',close}).then(()=>{signalSource.exitCode=130},()=>{signalSource.exitCode=1})};
      const interrupt=()=>handler('SIGINT'),terminate=()=>handler('SIGTERM');
      signalSource.on('SIGINT',interrupt);signalSource.on('SIGTERM',terminate);
      return ()=>{signalSource.off('SIGINT',interrupt);signalSource.off('SIGTERM',terminate)};
    },
  };
  return scope;
}
