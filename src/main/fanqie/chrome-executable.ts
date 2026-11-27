import { bundledChromiumExecutable, isExecutableFile, windowsChromiumExecutable } from "../../shared/host-executable-paths";

/** Packaged Electron may not resolve Chrome's system-wide installation through the channel registry. */
export function fanqieChromeLaunchOptions(platform=process.platform,env:NodeJS.ProcessEnv=process.env,exists=isExecutableFile):{executablePath:string}|{channel:string}{
  if(platform!=='win32')return {channel:'chrome'};
  const executablePath=windowsChromiumExecutable('chrome',env,exists) ?? bundledChromiumExecutable(exists);
  if(!executablePath)throw Error('FANQIE_CHROME_NOT_FOUND');
  return {executablePath};
}
