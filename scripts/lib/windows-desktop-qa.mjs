// QA infrastructure only. No product flags, elevation, or desktop process discovery.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
const execFileAsync=promisify(execFile);

export function validateDesktopToken(token,expectedProcessId) {
 // Read-only measurement found HasRestrictions=true on both the healthy delivered
 // client and host Default-desktop runner. Audit this flag; it is not the desktop
 // isolation boundary and does not, by itself, establish the cause of a GPU failure.
 const valid=token?.processId===expectedProcessId && typeof token.hasRestrictions==='boolean' &&
  token.isAppContainer===false && Number.isInteger(token.integrityRid) && token.integrityRid>=8192 &&
  Number.isInteger(token.sessionId) && token.sessionId>0 && token.userInteractive===true &&
  token.windowStation==='WinSta0' && token.desktop==='Default' && token.inputDesktopAvailable===true &&
  token.powerShellMajor>=7;
 if(!valid)throw Error('QA_DESKTOP_TOKEN_REJECTED: run from PowerShell 7 on the host WinSta0\\Default interactive desktop with medium-or-higher integrity and no AppContainer. Administrator membership is not required. '+JSON.stringify(token));
 return token;
}

async function powershellJson(script) {
 const encoded=Buffer.from("$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; "+script,'utf16le').toString('base64');
 const {stdout}=await execFileAsync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded],{windowsHide:true,timeout:15000,maxBuffer:8*1024*1024});
 return JSON.parse(stdout.replace(/^\uFEFF/,'').trim());
}

// Query the invoking Node process, not merely the PowerShell helper's token.
export async function requireWindowsDesktop({platform=process.platform,read=powershellJson,processId=process.pid}={}) {
 if(platform!=='win32')throw Error('QA_WINDOWS_DESKTOP_REQUIRED');
 const token=await read(`
if($PSVersionTable.PSVersion.Major -lt 7){throw 'PowerShell 7 required'}
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class QaDesktopToken {
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int id);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,IntPtr data,int length,out int required);
 [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
 [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid,uint index);
 [DllImport("user32.dll",SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
 [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
 [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
 [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint id);
 [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetUserObjectInformation(IntPtr handle,int index,System.Text.StringBuilder data,int length,out int required);
 static Exception Error(){return new Win32Exception(Marshal.GetLastWin32Error());}
 static IntPtr Info(IntPtr token,int kind){int size;GetTokenInformation(token,kind,IntPtr.Zero,0,out size);if(size<=0)throw Error();IntPtr ptr=Marshal.AllocHGlobal(size);if(!GetTokenInformation(token,kind,ptr,size,out size)){Marshal.FreeHGlobal(ptr);throw Error();}return ptr;}
 static int Number(IntPtr token,int kind){IntPtr ptr=Info(token,kind);try{return Marshal.ReadInt32(ptr);}finally{Marshal.FreeHGlobal(ptr);}}
 static string Name(IntPtr handle){int size;var text=new System.Text.StringBuilder(512);if(!GetUserObjectInformation(handle,2,text,1024,out size))throw Error();return text.ToString();}
 public static object Read(int id){IntPtr process=OpenProcess(0x1000,false,id);if(process==IntPtr.Zero)throw Error();IntPtr token=IntPtr.Zero;try{if(!OpenProcessToken(process,8,out token))throw Error();IntPtr info=Info(token,25);int rid;try{IntPtr sid=Marshal.ReadIntPtr(info);byte count=Marshal.ReadByte(GetSidSubAuthorityCount(sid));rid=Marshal.ReadInt32(GetSidSubAuthority(sid,(uint)(count-1)));}finally{Marshal.FreeHGlobal(info);}IntPtr desktop=OpenInputDesktop(0,false,1);bool input=desktop!=IntPtr.Zero;if(input)CloseDesktop(desktop);return new {processId=id,hasRestrictions=Number(token,21)!=0,isAppContainer=Number(token,29)!=0,integrityRid=rid,sessionId=System.Diagnostics.Process.GetProcessById(id).SessionId,userInteractive=Environment.UserInteractive,windowStation=Name(GetProcessWindowStation()),desktop=Name(GetThreadDesktop(GetCurrentThreadId())),inputDesktopAvailable=input};}finally{if(token!=IntPtr.Zero)CloseHandle(token);CloseHandle(process);}}
}
'@
$t=[QaDesktopToken]::Read(${Number(processId)})
$t | Select-Object *,@{n='powerShellMajor';e={$PSVersionTable.PSVersion.Major}} | ConvertTo-Json -Compress
`);
 return validateDesktopToken(token,processId);
}

export async function readEventBaseline({read=powershellJson}={}) {
 const baseline=await read(`$result=@{};foreach($log in @('Application','System')){$event=Get-WinEvent -LogName $log -MaxEvents 1 -ErrorAction Stop;$result[$log]=[long]$event.RecordId};$result|ConvertTo-Json -Compress`);
 validateBaseline(baseline);return baseline;
}
function validateBaseline(baseline) {
 if(!['Application','System'].every(log=>Number.isSafeInteger(baseline?.[log])&&baseline[log]>=0))throw Error('QA_EVENT_BASELINE_REQUIRED');
}
export async function readNativeEvents(run,{read=powershellJson}={}) {
 validateBaseline(run.baseline);
 const start=new Date(run.startTime).toISOString();
 const result=await read(`$events=@();foreach($log in @('Application','System')){$records=@(Get-WinEvent -FilterHashtable @{LogName=$log;StartTime=[datetime]'${start}'} -ErrorAction SilentlyContinue -ErrorVariable queryErrors);if($queryErrors | Where-Object {$_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*'}){throw 'Native event query failed'};foreach($e in $records){if($e.ProviderName -notin @('Application Error','Windows Error Reporting','Application Popup')){continue};[xml]$xml=$e.ToXml();$data=@{};$index=0;foreach($item in $xml.Event.EventData.Data){$name=[string]$item.Name;if(!$name){$name='Data'+$index};$data[$name]=[string]$item.'#text';$index++};$events+=@{logName=$log;recordId=[long]$e.RecordId;provider=$e.ProviderName;eventId=$e.Id;timeCreated=$e.TimeCreated.ToUniversalTime().ToString('o');data=$data;message=$e.Message}}};ConvertTo-Json -InputObject @($events) -Depth 8 -Compress`);
 return classifyNativeExceptions(result,run);
}

const normalizePath=value=>String(value??'').replaceAll('/','\\').replace(/^"|"$/g,'').toLowerCase();
const parsePid=value=>typeof value==='number'?value:/^(?:0x[\da-f]+|\d+)$/i.test(String(value))?Number(value):null;
export function filterNativeExceptions(events,run) {
 validateBaseline(run.baseline);
 const executable=normalizePath(run.executable),name=path.win32.basename(executable);
 const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const namePattern=new RegExp('(?:^|[^\\w.\\\\/:-])'+escaped+'(?=$|[^\\w.-])','i');
 const start=Date.parse(run.startTime),end=Date.parse(run.endTime);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)throw Error('QA_EVENT_WINDOW_REQUIRED');
 return events.filter(event=>{
  const time=Date.parse(event.timeCreated);
  if(!['Application Error','Windows Error Reporting','Application Popup'].includes(event.provider)||
   !Number.isSafeInteger(event.recordId)||event.recordId<=run.baseline[event.logName]||
   !Object.hasOwn(run.baseline,event.logName)||!Number.isFinite(time)||time<start||time>end)return false;
  const data=event.data??{};
  const paths=Object.entries(data).filter(([key])=>/^(AppPath|ApplicationPath|FaultingApplicationPath)$/i.test(key)).map(([,value])=>normalizePath(value)).filter(Boolean);
  const pids=Object.entries(data).filter(([key])=>/^(ProcessId|AppProcessId|FaultingProcessId)$/i.test(key)).map(([,value])=>parsePid(value)).filter(value=>value!==null);
  // A child GPU/renderer has another PID but shares the candidate executable path.
  // A different package path can never match merely because its filename is shared.
  if(paths.some(value=>value!==executable))return false;
  if(paths.includes(executable))return true;
  if(pids.some(value=>run.pid&&value!==run.pid))return false;
  if(run.pid&&pids.includes(run.pid))return true;
  const text=[...Object.values(data),event.message??''].join('\n');
  return namePattern.test(text);
 });
}

export function classifyNativeExceptions(events,run) {
 return filterNativeExceptions(events,run).map(event=>{
  const entries=Object.entries(event.data??{});
  const exactPath=entries.some(([key,value])=>/^(AppPath|ApplicationPath|FaultingApplicationPath)$/i.test(key)&&normalizePath(value)===normalizePath(run.executable));
  const exactPid=entries.some(([key,value])=>/^(ProcessId|AppProcessId|FaultingProcessId)$/i.test(key)&&run.pid&&parsePid(value)===run.pid);
  return {...event,identity:exactPath?'confirmed-executable-path':exactPid?'confirmed-process-id':'executable-name-only-ambiguous'};
 });
}

export async function withTimeout(operation,timeoutMs,label) {
 let timer;
 try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),timeoutMs);})]);}
 finally{clearTimeout(timer);}
}
export async function terminateOwnedLauncher(child,{platform=process.platform,exec=execFileAsync}={}) {
 // Playwright's Windows ChildProcess is the live cmd.exe wrapper. Its descendant
 // tree belongs to this launch; image-name termination could hit the delivered app.
 if(!child||!Number.isSafeInteger(child.pid)||child.exitCode!==null||child.signalCode!==null)return;
 if(platform==='win32')await exec('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:5000});
 else child.kill('SIGKILL');
}
export async function boundedClose(app,{timeoutMs=5000,terminate=terminateOwnedLauncher,child:capturedChild}={}) {
 if(!app)return;
 // Playwright disposes its dispatcher during close, so process() is unusable later.
 let child=capturedChild;const failures=[];
 if(child===undefined){try{child=app.process();}catch(error){failures.push(error);}}
 try{await withTimeout(()=>app.close(),timeoutMs,'QA_CLOSE_TIMEOUT');}
 catch(error){failures.push(error);try{await terminate(child);}catch(cleanupError){failures.push(cleanupError);}}
 if(failures.length===1)throw failures[0];
 if(failures.length)throw new AggregateError(failures,failures.map(error=>error.message).join('; '));
}

// A run has its own baseline/window. Even launch failure is checked for native errors.
export async function beginDesktopRun(executable,dataRoot) {
 const desktopToken=await requireWindowsDesktop();
 return {executable:path.resolve(executable),dataRoot:path.resolve(dataRoot),pid:null,desktopToken,baseline:await readEventBaseline(),startTime:new Date().toISOString()};
}
export async function finishDesktopRun(run) {
 // Allow Windows Error Reporting a short bounded interval to publish the crash record.
 await new Promise(resolve=>setTimeout(resolve,1000));
 run.endTime=new Date().toISOString();const failures=[];
 try{run.nativeExceptions=await readNativeEvents(run);if(run.nativeExceptions.length)failures.push(Error((run.nativeExceptions.every(event=>event.identity==='executable-name-only-ambiguous')?'QA_NATIVE_EXCEPTION_REVIEW_REQUIRED: ':'QA_NATIVE_EXCEPTION: ')+JSON.stringify(run.nativeExceptions)));}catch(error){failures.push(error);}
 try{run.localLifecycle=readLocalLifecycle(run);if(run.localLifecycle.failures.length)failures.push(Error('QA_LOCAL_LIFECYCLE_FAILURE: '+JSON.stringify(run.localLifecycle.failures)));}catch(error){run.localLifecycle={error:String(error)};failures.push(error);}
 if(failures.length)throw new AggregateError(failures,failures.map(error=>error.message).join('; '));
 return run;
}

export function filterLocalLifecycle(rows,run) {
 const start=Date.parse(run.startTime),end=Date.parse(run.endTime);
 const records=rows.filter(row=>row.pid===run.pid&&Number.isFinite(Date.parse(row.at))&&Date.parse(row.at)>=start&&Date.parse(row.at)<=end).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 const quitting=new Set(),failures=[];
 for(const row of records){
  if(row.event==='before-quit')quitting.add(row.sessionId);
  if(['uncaught-exception-monitor','crash-reporter-unavailable'].includes(row.event))failures.push(row);
  if(['child-process-gone','render-process-gone'].includes(row.event)&&(['crashed','abnormal-exit','oom','launch-failed','integrity-failure'].includes(row.reason)||(row.reason==='killed'&&!quitting.has(row.sessionId))))failures.push(row);
 }
 return {records,failures};
}
export function readLocalLifecycle(run) {
 const file=path.join(run.dataRoot,'diagnostics','native-lifecycle.jsonl'),files=[],rows=[];
 for(const candidate of [file+'.2',file+'.1',file]){
  if(!fs.existsSync(candidate))continue;files.push(candidate);
  for(const line of fs.readFileSync(candidate,'utf8').split(/\r?\n/).filter(line=>line.trim())){
   try{const row=JSON.parse(line);if(!row||typeof row!=='object')throw Error();rows.push(row);}catch{throw Error('QA_LOCAL_LIFECYCLE_INVALID: '+candidate);}
  }
 }
 const result={files,...filterLocalLifecycle(rows,run)};
 if(!result.records.length)throw Error('QA_LOCAL_LIFECYCLE_MISSING: '+file);
 return result;
}

export async function closeDesktopRun(app,run,{inspect,timeoutMs=5000,finish=finishDesktopRun}={}) {
 const failures=[];let child=null;
 if(app){try{child=app.process();}catch(error){failures.push(error);}}
 if(app&&inspect){try{await withTimeout(()=>inspect(app),timeoutMs,'QA_INSPECTION_TIMEOUT');}catch(error){failures.push(error);}}
 try{await boundedClose(app,{timeoutMs,child});}catch(error){failures.push(error);}
 if(child){if(run){run.exitCode=child.exitCode;run.signalCode=child.signalCode;}if(child.exitCode!==null&&child.exitCode!==0)failures.push(Error('QA_PROCESS_EXIT: '+child.exitCode));}
 if(run){try{await finish(run);}catch(error){failures.push(error);}}
 if(failures.length===1)throw failures[0];
 if(failures.length)throw new AggregateError(failures,failures.map(error=>error.message).join('; '));
}
