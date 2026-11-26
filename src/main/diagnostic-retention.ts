import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {PlatformAccountIdSchema} from '../shared/platform-accounts';
import {diagnosticRetentionMs} from '../shared/diagnostic-retention';
import {pruneFanqieTraceFile} from './fanqie/directory-trace';

type RetentionReport={deleted:number;trimmed:number;failures:number};
type Entry={name:string;path:string;directory:boolean};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function entries(directory:string,report:RetentionReport):Entry[]{
  try{return fs.readdirSync(directory,{withFileTypes:true}).map(entry=>({name:entry.name,path:path.join(directory,entry.name),directory:entry.isDirectory()}));}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')report.failures++;return [];}
}
function ownedDirectory(directory:string,report:RetentionReport):boolean{
  try{
    const stat=fs.lstatSync(directory);
    if(stat.isSymbolicLink())return false;
    if(!stat.isDirectory()){report.failures++;return false;}
    return true;
  }
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')report.failures++;return false;}
}
function regularFile(file:string,report:RetentionReport):fs.Stats|undefined{
  try{const stat=fs.lstatSync(file);return stat.isFile()&&!stat.isSymbolicLink()?stat:undefined;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')report.failures++;return undefined;}
}
function within(root:string,target:string){
  const relative=path.relative(root,target);
  return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);
}

/** Best-effort cleanup of explicitly app-owned diagnostic files; never walks arbitrary data. */
export async function cleanupExpiredDiagnostics(dataRoot:string,now=Date.now()):Promise<RetentionReport>{
  const report:RetentionReport={deleted:0,trimmed:0,failures:0};
  let root:string;
  try{root=fs.realpathSync.native(path.resolve(dataRoot));if(!ownedDirectory(root,report))return report;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')report.failures++;return report;}
  const cutoff=now-diagnosticRetentionMs;
  const removeOld=(file:string)=>{
    if(!within(root,file))return;
    const stat=regularFile(file,report);if(!stat||stat.mtimeMs>=cutoff)return;
    try{fs.unlinkSync(file);report.deleted++;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')report.failures++;}
  };
  const trimLog=async(file:string)=>{
    if(!within(root,file)||!regularFile(file,report))return;
    try{if(await pruneFanqieTraceFile(file,cutoff))report.trimmed++;}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')report.failures++;}
  };
  const trimJsonlLog=(file:string)=>{
    if(!within(root,file))return;
    const stat=regularFile(file,report);if(!stat)return;
    let temporary:string|undefined;
    try{
      const source=fs.readFileSync(file,'utf8'),lines=source.split(/\r?\n/u).filter(Boolean),retained:string[]=[];
      for(const line of lines){
        try{const row=JSON.parse(line) as {at?:unknown};const at=typeof row.at==='string'?Date.parse(row.at):NaN;
          if(Number.isFinite(at)&&at>=cutoff)retained.push(line);
        }catch{/* Drop malformed rows because their age cannot be established. */}
      }
      const next=retained.length?retained.join('\n')+'\n':'';
      if(next===source)return;
      if(!retained.length){fs.unlinkSync(file);report.trimmed++;return;}
      temporary=file+'.retention-'+randomUUID()+'.tmp';
      fs.writeFileSync(temporary,next,{encoding:'utf8',flag:'wx',flush:true});
      fs.renameSync(temporary,file);temporary=undefined;report.trimmed++;
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')report.failures++;}
    finally{if(temporary)try{fs.unlinkSync(temporary);}catch{}}
  };
  const processDiagnostics=async(directory:string)=>{
    if(!ownedDirectory(directory,report))return;
    for(const name of ['native-lifecycle.jsonl','native-lifecycle.jsonl.1','native-lifecycle.jsonl.2'])trimJsonlLog(path.join(directory,name));
    for(const name of ['fanqie-operation.json','fanqie-entry.json'])removeOld(path.join(directory,name));
    for(const entry of entries(directory,report))if(!entry.directory&&/^native-lifecycle\.jsonl(?:\.[12])?\.retention-[0-9a-f-]{36}\.tmp$/iu.test(entry.name))removeOld(entry.path);
  };
  await processDiagnostics(path.join(root,'diagnostics'));

  const production=path.join(root,'production'),fanqie=path.join(production,'fanqie');
  const runOwners:string[]=[];
  if(ownedDirectory(production,report)&&ownedDirectory(fanqie,report)){
    runOwners.push(fanqie);
    const accountRoot=path.join(fanqie,'accounts');
    if(ownedDirectory(accountRoot,report))for(const entry of entries(accountRoot,report)){
      if(!entry.directory||!uuid.test(entry.name)||!PlatformAccountIdSchema.safeParse({accountId:entry.name}).success||!ownedDirectory(entry.path,report))continue;
      runOwners.push(entry.path);
      await processDiagnostics(path.join(entry.path,'diagnostics'));
    }
    await processDiagnostics(path.join(fanqie,'diagnostics'));
  }

  for(const owner of runOwners){
    const runs=path.join(owner,'download-runs');
    if(!ownedDirectory(runs,report))continue;
    for(const run of entries(runs,report)){
      if(!run.directory||!uuid.test(run.name)||!ownedDirectory(run.path,report))continue;
      await trimLog(path.join(run.path,'trace.jsonl'));
      for(const entry of entries(run.path,report))if(!entry.directory&&/^trace\.jsonl\.retention-[0-9a-f-]{36}\.tmp$/iu.test(entry.name))removeOld(entry.path);
      const screenshots=path.join(run.path,'screenshots');
      if(!ownedDirectory(screenshots,report))continue;
      for(const image of entries(screenshots,report)){
        if(image.directory||!/^event-\d+-[0-9a-f-]{36}\.png$/iu.test(image.name))continue;
        removeOld(image.path);
      }
    }
  }

  const evidence=path.join(root,'evidence'),tmeEvidence=path.join(evidence,'tme-ai');
  if(ownedDirectory(evidence,report)&&ownedDirectory(tmeEvidence,report))for(const entry of entries(tmeEvidence,report)){
    if(!entry.directory&&/^[a-z0-9_-]{1,160}-native-error\.json$/iu.test(entry.name))removeOld(entry.path);
  }
  return report;
}
