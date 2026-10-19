import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {EventEmitter} from 'node:events';

const modulePath=path.resolve('scripts/qa-owned-cleanup.mjs');
const pwsh=process.env.RAINFALL_QA_PWSH||'pwsh.exe';
const executable=execFileSync(pwsh,['-NoProfile','-Command','(Get-Process -Id $PID).Path'],{encoding:'utf8',windowsHide:true}).trim();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,message){const end=Date.now()+8000;while(Date.now()<end){if(fn())return;await delay(50)}throw Error(message)}
async function setup({late=false}={}){
 assert(fs.existsSync(modulePath),'owned QA cleanup implementation is missing');
 const {createOwnedQaRun}=await import(pathToFileURL(modulePath).href);
 const run=path.resolve('output/qa-cleanup-tests',randomUUID());fs.mkdirSync(run,{recursive:true});
 const entry=path.join(run,'fixture.ps1'),stop=path.join(run,'close.flag');
 fs.writeFileSync(entry,`param([string]$Role='root',[string]$Owner,[string]$RunRoot,[Parameter(ValueFromRemainingArguments=$true)][string[]]$Extra)
$ErrorActionPreference='Stop'
$pwsh=(Get-Process -Id $PID).Path
$runtime='--user-data-dir='+(Join-Path $RunRoot 'data/runtime')
if($Role -eq 'late-root'){[IO.File]::WriteAllText((Join-Path $RunRoot 'root.pid'),[string]$PID);while(-not(Test-Path (Join-Path $RunRoot 'spawn.flag')) -and -not(Test-Path (Join-Path $RunRoot 'close.flag'))){Start-Sleep -Milliseconds 40};if(Test-Path (Join-Path $RunRoot 'close.flag')){exit}}
if($Role -ne 'leaf'){$next=if($Role -eq 'root'){'child'}else{'leaf'};Start-Process -FilePath $pwsh -ArgumentList @('-NoProfile','-File',('\"'+$PSCommandPath+'\"'),'-Role',$next,'-Owner',$Owner,'-RunRoot',('\"'+$RunRoot+'\"'),('\"'+$runtime+'\"')) -WindowStyle Hidden | Out-Null}
if($Role -eq 'late-root'){exit}
[IO.File]::WriteAllText((Join-Path $RunRoot ($Role+'.pid')),[string]$PID)
while(-not(Test-Path -LiteralPath (Join-Path $RunRoot 'close.flag'))){Start-Sleep -Milliseconds 40}
`);
 const scope=createOwnedQaRun({runDirectory:run,entryPath:entry,executablePath:executable,pwshPath:pwsh,graceMs:500});
 const mainArgs=[executable,'-NoProfile','-File',entry,'-Role',late?'late-root':'root','-Owner',scope.owner,'-RunRoot',run,...scope.ownerArgs];
 const command=mainArgs.map(a=>{if(/["%!&|<>^\r\n]/.test(a))throw Error('unsafe fixture shell argument');return '"'+a+'"'}).join(' ');
 const main=spawn(command,{shell:true,windowsHide:true,stdio:'ignore'});
 try{await waitFor(()=>fs.existsSync(path.join(run,'root.pid')),'fixture root not ready')}catch(e){fs.writeFileSync(stop,'close');throw e}
 const foreignDir=path.join(run,'foreign');fs.mkdirSync(foreignDir);
 const foreignScope=createOwnedQaRun({runDirectory:foreignDir,entryPath:entry,executablePath:executable,pwshPath:pwsh,graceMs:500});
 const foreign=spawn(executable,['-NoProfile','-File',entry,'-Owner',foreignScope.owner,'-RunRoot',foreignDir,...foreignScope.ownerArgs],{windowsHide:true,stdio:'ignore'});
 try {await waitFor(()=>fs.existsSync(path.join(run,late?'root.pid':'leaf.pid'))&&fs.existsSync(path.join(foreignDir,'leaf.pid')),'fixture tree not ready');}
 catch(e){fs.writeFileSync(stop,'close');fs.writeFileSync(path.join(foreignDir,'close.flag'),'close');throw e}
 const pids=(late?['root']:['root','child','leaf']).map(n=>Number(fs.readFileSync(path.join(run,n+'.pid'),'utf8')));
 assert.notEqual(pids[0],main.pid,'fixture must reproduce a Windows cmd wrapper PID');
 try{await scope.capture()}catch(e){fs.writeFileSync(stop,'close');fs.writeFileSync(path.join(foreignDir,'close.flag'),'close');throw e}
 const foreignState=await foreignScope.capture();
 return {scope,run,stop,main,foreign,foreignState,pids,async dispose(){fs.writeFileSync(stop,'close');fs.writeFileSync(path.join(foreignDir,'close.flag'),'close');await delay(150);if(main.exitCode===null)await scope.finish({reason:'fixture-dispose',close:async()=>{}});await waitFor(()=>foreign.exitCode!==null,'foreign fixture did not close')}};
}
for(const reason of ['normal','timeout','cancel','launch-failed'])test('owned cleanup '+reason+' stops only its own process tree',{timeout:25000},async()=>{
 const x=await setup();try{
  let unbind=()=>{},signal;
  if(reason==='cancel'){signal=new EventEmitter();unbind=x.scope.bindSignals({signalSource:signal,close:()=>new Promise(()=>{})});signal.emit('SIGINT')}
  const result=await x.scope.finish({reason,close:reason==='normal'?async()=>{fs.writeFileSync(x.stop,'close');await waitFor(()=>x.main.exitCode!==null,'normal fixture did not exit')}:reason==='launch-failed'?async()=>{}:()=>new Promise(()=>{})});
  unbind();
  assert.equal(result.state,'cleaned');assert.deepEqual(result.remaining,[]);
  assert.equal(x.foreign.exitCode,null,'unrelated process was stopped');
  assert(!x.foreignState.processes.some(p=>result.stopped.includes(p.pid)),'unrelated child was stopped');
  if(reason==='normal')assert.equal(result.stopped.length,0);
  else assert(x.pids.every(pid=>result.stopped.includes(pid)),JSON.stringify(result));
  if(reason==='cancel'){assert.equal(x.scope.cancelled,true);assert.equal(signal.exitCode,130)}
  assert.deepEqual(await x.scope.finish({reason:'repeat',close:async()=>{throw Error('must not repeat')}}),result);
 }finally{await x.dispose()}
});

test('forged intermediate parent cannot grant ownership of a foreign child',{timeout:25000},async()=>{
 const x=await setup();try{
  const state=JSON.parse(fs.readFileSync(x.scope.stateFile,'utf8'));
  const saved=JSON.stringify(state);
  state.processes.push(...x.foreignState.processes.map(p=>({...p,parentPid:p.pid===x.foreignState.root.pid?state.root.pid:p.parentPid})));
  fs.writeFileSync(x.scope.stateFile,JSON.stringify(state));
  try {
   const result=await x.scope.stop();
   const foreignIds=x.foreignState.processes.map(p=>p.pid);
   assert(!foreignIds.some(pid=>result.stopped.includes(pid)),'forged graph stopped a foreign child');
   assert.equal(x.foreign.exitCode,null,'foreign Main was stopped');
  } finally {fs.writeFileSync(x.scope.stateFile,saved)}
 }finally{await x.dispose()}
});

test('late child remains owned after Main exits before the next capture',{timeout:25000},async()=>{
 const x=await setup({late:true});try{
  fs.writeFileSync(path.join(x.run,'spawn.flag'),'spawn');
  await waitFor(()=>fs.existsSync(path.join(x.run,'leaf.pid'))&&x.main.exitCode!==null,'late child was not orphaned');
  const latePid=Number(fs.readFileSync(path.join(x.run,'leaf.pid'),'utf8'));
  const result=await x.scope.stop();
  assert.equal(result.state,'cleaned');
  assert(result.stopped.includes(latePid),'cleaned result omitted the surviving late child');
  assert.equal(x.foreign.exitCode,null,'unrelated process was stopped');
 }finally{await x.dispose()}
});
test('tampered creation time and owner cannot terminate a matching executable',{timeout:25000},async()=>{
 const x=await setup();try{
  const state=JSON.parse(fs.readFileSync(x.scope.stateFile,'utf8'));
  const saved=fs.readFileSync(x.scope.stateFile,'utf8');
  for(const mutation of [s=>s.root.creationFileTime=String(BigInt(s.root.creationFileTime)+1n),s=>s.owner=randomUUID()]){
   const tampered=structuredClone(state);mutation(tampered);fs.writeFileSync(x.scope.stateFile,JSON.stringify(tampered));
   const result=await x.scope.stop();assert.equal(result.state,'refused');assert.equal(x.main.exitCode,null);assert.equal(x.foreign.exitCode,null);
  }
  fs.writeFileSync(x.scope.stateFile,saved);
 }finally{await x.dispose()}
});
