import {execFileSync} from 'node:child_process';
/** Metadata only. Base64 carries a literal path into a fixed PowerShell expression. */
export function directoryFileAttributes(file:string):number{
 if(process.platform!=='win32')return 0;
 const encoded=Buffer.from(file,'utf8').toString('base64');
 const script=`$ErrorActionPreference='Stop';$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'));[int64][IO.File]::GetAttributes($p)`;
 try{const output=execFileSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:5000,maxBuffer:4096}).trim();if(!/^\d+$/.test(output))throw Error();return Number(output);}catch{throw Error('DIRECTORY_ATTRIBUTES_UNAVAILABLE');}
}
