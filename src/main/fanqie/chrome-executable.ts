import fs from 'node:fs';
import path from 'node:path';

/** Packaged Electron may not resolve Chrome's system-wide installation through the channel registry. */
export function fanqieChromeLaunchOptions(platform=process.platform,env:NodeJS.ProcessEnv=process.env,exists:(file:string)=>boolean=fs.existsSync):{executablePath:string}|{channel:string}{
  if(platform!=='win32')return {channel:'chrome'};
  const drive=env.SystemDrive??'C:';
  const roots=[env.ProgramFiles,env['ProgramFiles(x86)'],path.win32.join(drive+'\\','Program Files'),path.win32.join(drive+'\\','Program Files (x86)'),env.LOCALAPPDATA].filter((v):v is string=>!!v);
  const candidates=[...new Set(roots.map(root=>path.win32.join(root,'Google','Chrome','Application','chrome.exe')))];
  const executablePath=candidates.find(exists);
  if(!executablePath)throw Error('FANQIE_CHROME_NOT_FOUND');
  return {executablePath};
}
