import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const load = () => import('../scripts/lib/windows-desktop-qa.mjs');
const token = {processId:123,hasRestrictions:false,isAppContainer:false,integrityRid:8192,sessionId:1,userInteractive:true,windowStation:'WinSta0',desktop:'Default',inputDesktopAvailable:true,powerShellMajor:7};

test('normal interactive medium integrity user can run QA without administrator membership', async () => {
 const {validateDesktopToken}=await load();
 assert.deepEqual(validateDesktopToken(token,123),token);
});
test('Default desktop permits audited HasRestrictions flag measured on the healthy delivered client',async()=>{
 const {validateDesktopToken}=await load();
 assert.deepEqual(validateDesktopToken({...token,hasRestrictions:true},123),{...token,hasRestrictions:true});
});
test('sandbox desktop, AppContainer, low integrity, noninteractive and unknown tokens fail closed', async () => {
 const {validateDesktopToken}=await load();
 for(const change of [{hasRestrictions:true,desktop:'CodexSandboxDesktop-123'},{isAppContainer:true},{integrityRid:4096},{sessionId:0},{userInteractive:false},{windowStation:'Service-0x0-3e7$'},{desktop:'Other'},{inputDesktopAvailable:false},{powerShellMajor:5},{processId:124},{hasRestrictions:undefined},{isAppContainer:undefined},{integrityRid:undefined}]) {
  assert.throws(()=>validateDesktopToken({...token,...change},123),/QA_DESKTOP_TOKEN_REJECTED/);
 }
});
const run={executable:'C:\\candidate\\Rainfall Studio.exe',pid:456,startTime:'2026-10-16T20:21:01.000Z',endTime:'2026-10-16T20:22:01.000Z',baseline:{Application:100,System:200}};
const event={logName:'Application',recordId:101,provider:'Application Error',eventId:1000,timeCreated:'2026-10-16T20:21:02.000Z',data:{AppName:'Rainfall Studio.exe',AppPath:run.executable,ProcessId:'0x1c8'},message:'Fault 0xc0000135'};
test('native errors count for this path or PID, and popup executable fallback in fresh window',async()=>{
 const {filterNativeExceptions}=await load();
 const popup={...event,logName:'System',recordId:201,provider:'Application Popup',eventId:26,data:{},message:'Rainfall Studio.exe - Application Error: 0x80000003'};
 assert.deepEqual(filterNativeExceptions([event,popup],run),[event,popup]);
 assert.equal(filterNativeExceptions([{...event,data:{ProcessId:456}}],run).length,1);
});
test('candidate path identifies crashed GPU/renderer children while delivered same-name executable stays isolated',async()=>{
 const {filterNativeExceptions}=await load();
 const child={...event,data:{AppPath:run.executable,ProcessId:999,AppName:'Rainfall Studio.exe'}};
 const delivered={...child,data:{...child.data,AppPath:'C:\\delivered\\Rainfall Studio.exe',ProcessId:34176}};
 assert.deepEqual(filterNativeExceptions([child,delivered],run),[child]);
});
test('old records, late events, other paths/PIDs/executables and reporter PID cannot impersonate this run',async()=>{
 const {filterNativeExceptions}=await load();
 const rejected=[{...event,recordId:100},{...event,timeCreated:'2026-10-16T20:20:59Z'},{...event,timeCreated:'2026-10-16T20:22:02Z'},{...event,data:{AppPath:'C:\\delivered\\Rainfall Studio.exe',AppName:'Rainfall Studio.exe'}},{...event,data:{ProcessId:34176,AppName:'Rainfall Studio.exe'}},{...event,data:{AppName:'Other.exe'},message:'Other.exe crashed'},{...event,data:{},message:'NotRainfall Studio.exe crashed'},{...event,provider:'Unrelated',data:{ProcessId:456}},{...event,data:{},message:'',systemProcessId:456},{...event,recordId:NaN},{...event,timeCreated:null}];
 assert.deepEqual(filterNativeExceptions(rejected,run),[]);
 assert.throws(()=>filterNativeExceptions([event],{...run,baseline:{}}),/QA_EVENT_BASELINE_REQUIRED/);
});
test('bounded close times out a stuck close, kills only its own child and reports failure',async()=>{
 const {boundedClose}=await load();let killed=0;
 const child={pid:456,exitCode:null,signalCode:null,kill(signal){assert.equal(signal,'SIGKILL');killed++;return true;}};
 const app={process:()=>child,close:()=>new Promise(()=>{})};
 await assert.rejects(boundedClose(app,{timeoutMs:20,terminate:async owned=>owned.kill('SIGKILL')}),/QA_CLOSE_TIMEOUT/);
 assert.equal(killed,1);
});
test('bounded close handles crashed app and avoids killing an already exited process',async()=>{
 const {boundedClose}=await load();let killed=0;
 const child={pid:456,exitCode:1,signalCode:null,kill(){killed++;}};
 await assert.rejects(boundedClose({process:()=>child,close:async()=>{throw Error('already crashed');}},{timeoutMs:20}),/already crashed/);
 assert.equal(killed,0);
 await boundedClose({process:()=>child,close:async()=>{}},{timeoutMs:20});
});
test('close preserves its child reference before Playwright disposes the dispatcher and still finishes evidence',async()=>{
 const {closeDesktopRun}=await load();let disposed=false,processCalls=0,finished=0;
 const child={pid:456,exitCode:null,signalCode:null},state={};
 const app={process(){processCalls++;if(disposed)throw Error('dispatcher disposed');return child;},async close(){disposed=true;child.exitCode=0;}};
 await closeDesktopRun(app,state,{finish:async()=>{finished++;}});
 assert.equal(processCalls,1);assert.equal(finished,1);assert.equal(state.exitCode,0);
});
test('bounded close captures the child before a rejected close disposes the dispatcher',async()=>{
 const {boundedClose}=await load();let disposed=false,processCalls=0,terminated=0;
 const child={pid:456,exitCode:null,signalCode:null};
 const app={process(){processCalls++;if(disposed)throw Error('dispatcher disposed');return child;},async close(){disposed=true;throw Error('close failed');}};
 await assert.rejects(boundedClose(app,{terminate:async owned=>{assert.equal(owned,child);terminated++;}}),/^Error: close failed$/);
 assert.equal(processCalls,1);assert.equal(terminated,1);
});
test('an unavailable child reference cannot prevent close or final evidence collection',async()=>{
 const {closeDesktopRun}=await load();let closed=0,finished=0;
 const app={process(){throw Error('dispatcher already disposed');},async close(){closed++;}};
 await assert.rejects(closeDesktopRun(app,{}, {finish:async()=>{finished++;}}),/dispatcher already disposed/);
 assert.equal(closed,1);assert.equal(finished,1);
});
test('bounded close still attempts close when the dispatcher was disposed before cleanup began',async()=>{
 const {boundedClose}=await load();let closed=0;
 const app={process(){throw Error('dispatcher already disposed');},async close(){closed++;}};
 await assert.rejects(boundedClose(app),/dispatcher already disposed/);
 assert.equal(closed,1);
});
test('token probe checks the invoking Node process and rejects helper/probe failures before GUI launch',async()=>{
 const {requireWindowsDesktop}=await load();let script;
 assert.deepEqual(await requireWindowsDesktop({platform:'win32',processId:123,read:async value=>{script=value;return token;}}),token);
 assert.match(script,/QaDesktopToken\]::Read\(123\)/);
 assert.match(script,/GetTokenInformation/);
 await assert.rejects(requireWindowsDesktop({platform:'win32',processId:123,read:async()=>{throw Error('probe unavailable')}}),/probe unavailable/);
 await assert.rejects(requireWindowsDesktop({platform:'linux'}),/QA_WINDOWS_DESKTOP_REQUIRED/);
});
test('close inspects with a bound and always closes and captures native events after inspection failure',async()=>{
 const {closeDesktopRun}=await load();let closed=0,finished=0;
 const app={process:()=>({exitCode:0}),close:async()=>{closed++;}};
 await assert.rejects(closeDesktopRun(app,{}, {inspect:()=>new Promise(()=>{}),timeoutMs:20,finish:async()=>{finished++;}}),/QA_INSPECTION_TIMEOUT/);
 assert.equal(closed,1);assert.equal(finished,1);
 await assert.rejects(closeDesktopRun(null,{}, {finish:async()=>{throw Error('QA_NATIVE_EXCEPTION')}}),/QA_NATIVE_EXCEPTION/);
});
test('nonzero native process exit fails acceptance even when close resolves and renderer is silent',async()=>{
 const {closeDesktopRun}=await load();const run={};
 const app={process:()=>({pid:456,exitCode:-1073741515,signalCode:null}),close:async()=>{}};
 await assert.rejects(closeDesktopRun(app,run,{finish:async()=>{}}),/QA_PROCESS_EXIT/);
 assert.equal(run.exitCode,-1073741515);
});
test('local lifecycle rejects recovered child/render crashes and uncaught monitors for the exact run PID/window',async()=>{
 const {filterLocalLifecycle}=await load();
 const row={at:event.timeCreated,pid:456,sessionId:'qa',event:'child-process-gone',reason:'crashed'};
 const bad=[row,...['abnormal-exit','oom','launch-failed','integrity-failure'].map(reason=>({...row,reason,event:'render-process-gone'})),{...row,event:'uncaught-exception-monitor'},{...row,event:'crash-reporter-unavailable'}];
 const other=[{...row,pid:34176},{...row,at:'2026-10-16T20:20:59Z'},{...row,at:'2026-10-16T20:22:02Z'}];
 const result=filterLocalLifecycle([...bad,...other],run);
 assert.deepEqual(result.records,bad);assert.deepEqual(result.failures,bad);
});
test('killed child is suspicious before before-quit, but ordinary shutdown is allowed in its own session',async()=>{
 const {filterLocalLifecycle}=await load();
 const base={at:event.timeCreated,pid:456,sessionId:'qa'};
 const killed={...base,event:'child-process-gone',reason:'killed'};
 const beforeQuit={...base,event:'before-quit'};
 const afterQuit={...killed,at:'2026-10-16T20:21:03Z'};
 assert.deepEqual(filterLocalLifecycle([killed,beforeQuit,afterQuit],run).failures,[killed]);
 assert.deepEqual(filterLocalLifecycle([{...beforeQuit,sessionId:'other'},afterQuit],run).failures,[afterQuit]);
});
test('local lifecycle reads rotations and fails closed for missing or malformed diagnostics',async()=>{
 const {readLocalLifecycle}=await load();const root=fs.mkdtempSync(path.join(os.tmpdir(),'rainfall-qa-'));
 try{
  assert.throws(()=>readLocalLifecycle({...run,dataRoot:root}),/QA_LOCAL_LIFECYCLE_MISSING/);
  const dir=path.join(root,'diagnostics');fs.mkdirSync(dir);
  const entry={at:event.timeCreated,pid:456,sessionId:'qa',event:'entry'},crash={...entry,event:'child-process-gone',reason:'crashed'};
  fs.writeFileSync(path.join(dir,'native-lifecycle.jsonl.1'),JSON.stringify(entry)+'\n');
  fs.writeFileSync(path.join(dir,'native-lifecycle.jsonl'),JSON.stringify(crash)+'\n');
  const result=readLocalLifecycle({...run,dataRoot:root});assert.equal(result.records.length,2);assert.deepEqual(result.failures,[crash]);
  fs.appendFileSync(path.join(dir,'native-lifecycle.jsonl'),'broken\n');
  assert.throws(()=>readLocalLifecycle({...run,dataRoot:root}),/QA_LOCAL_LIFECYCLE_INVALID/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Windows timeout cleanup targets only the still-running launcher tree, never image names',async()=>{
 const {terminateOwnedLauncher}=await load();const calls=[];
 const child={pid:456,exitCode:null,signalCode:null};
 await terminateOwnedLauncher(child,{platform:'win32',exec:async(...args)=>{calls.push(args);}});
 assert.equal(calls[0][0],'taskkill.exe');assert.deepEqual(calls[0][1],['/PID','456','/T','/F']);
 await terminateOwnedLauncher({...child,exitCode:0},{platform:'win32',exec:async()=>{throw Error('must not kill exited launcher')}});
});
test('name-only popup evidence is retained as ambiguous rather than attributed to the candidate',async()=>{
 const {classifyNativeExceptions}=await load();
 const popup={...event,data:{},provider:'Application Popup',message:'Rainfall Studio.exe - Application Error'};
 const result=classifyNativeExceptions([event,popup],run);
 assert.equal(result[0].identity,'confirmed-executable-path');assert.equal(result[1].identity,'executable-name-only-ambiguous');
});
for(const script of ['production-flow-desktop-qa.mjs','beijing-tme-ai-desktop-qa.mjs'])test(script+' guards launch and records native acceptance for success and failure',()=>{
 const source=fs.readFileSync(new URL('../scripts/'+script,import.meta.url),'utf8');
 assert.ok(source.indexOf('await beginDesktopRun(')>0&&source.indexOf('await beginDesktopRun(')<source.indexOf('await electron.launch('));
 assert.match(source,/closeDesktopRun\(/);assert.match(source,/nativeWindowsRuns/);assert.match(source,/passed:false/);
 assert.match(source,/app\.evaluate\(\(\)=>process\.pid\)/);assert.match(source,/launcherPid/);
 assert.match(source,/RAINFALL_QA_BACKUP/);assert.match(source,/RAINFALL_QA_REPORT/);
 assert.match(source,/QA_SETUP_TIMEOUT/);
 assert.doesNotMatch(source,/--no-sandbox|--disable-gpu|taskkill|Stop-Process/);
});
