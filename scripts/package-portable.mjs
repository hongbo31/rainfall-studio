// New-device package: runtime included; no developer paths, library or credentials.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const repo=process.cwd();
execFileSync(process.execPath,['scripts/build-desktop.mjs'],{stdio:'inherit'});
const output=execFileSync(process.execPath,['scripts/package-tme-candidate.mjs','--simple-publishing'],{encoding:'utf8'});
const candidate=JSON.parse(output.trim().split(/\r?\n/).at(-1));
const root=path.dirname(candidate.executable),app=path.join(root,'resources','app');
const sourceFiles=execFileSync('git',['ls-files','-m','-o','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
// Candidate builds inject an absolute testing data root. Never ship that bootstrap.
fs.copyFileSync(path.join(repo,'build','main.cjs'),path.join(app,'build','main.cjs'));
const packageFile=path.join(app,'package.json');
const pkg=JSON.parse(fs.readFileSync(packageFile,'utf8'));
Object.assign(pkg,{name:'rainfall-studio',productName:'Rainfall Studio'});
fs.writeFileSync(packageFile,JSON.stringify(pkg,null,2));
const executable=path.join(root,'RainfallStudio.exe');
fs.renameSync(candidate.executable,executable);
fs.unlinkSync(path.join(root,'candidate-manifest.json'));
const mediaArg=process.argv.indexOf('--media-tools-dir');
const mediaSource=mediaArg>=0?path.resolve(process.argv[mediaArg+1]):'C:/ffmpeg/ffmpeg-8.1-essentials_build';
const mediaDest=path.join(app,'tools','media');
fs.mkdirSync(mediaDest,{recursive:true});
for(const name of ['ffmpeg.exe','ffprobe.exe'])fs.copyFileSync(path.join(mediaSource,'bin',name),path.join(mediaDest,name));
for(const name of ['LICENSE','README.txt'])fs.copyFileSync(path.join(mediaSource,name),path.join(mediaDest,name));
const forbidden=['candidate-data','credentials','browser-sessions','production'];
for(const name of forbidden)if(fs.existsSync(path.join(root,name)))throw Error('PRIVATE_DATA_IN_PACKAGE');
const manifest={format:1,kind:'windows-x64-portable',version:pkg.version,sourceCommit:candidate.sourceCommit,
 builtAt:new Date().toISOString(),sourceCommitIsExact:sourceFiles.length===0,modifiedSourceFiles:sourceFiles,dataRoot:'%APPDATA%/RainfallStudio',runtimeIncluded:true,mediaToolsIncluded:true,
 requiresNodeInstallation:false,requiresCodex:false,credentialsIncluded:false,loginIncluded:false,
 accepted:false,acceptancePending:'clean-root launch and configured end-to-end acceptance',files:[]};
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
 const file=path.join(dir,e.name);
 if(e.isSymbolicLink())throw Error('PACKAGE_LINK_NOT_ALLOWED');
 if(e.isDirectory())walk(file);
 else if(!['portable-manifest.json'].includes(e.name)&&file!==path.join(root,'README.txt'))manifest.files.push({path:path.relative(root,file).replaceAll('\\','/'),sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
}}
walk(root);
fs.writeFileSync(path.join(root,'portable-manifest.json'),JSON.stringify(manifest,null,2));
fs.writeFileSync(path.join(root,'README.txt'),[
 'Rainfall Studio '+pkg.version+' · Windows x64 免安装版',
 '保留整个文件夹，双击 RainfallStudio.exe。无需安装 Node.js、npm 或 Codex。',
 '作品和配置保存到当前 Windows 用户的 %APPDATA%\\RainfallStudio，与程序目录分开。',
 '首次使用：配置中心设置艺人、歌词服务、音乐服务及番茄署名；在番茄工作窗口登录一次。',
 '音乐和歌词 API 密钥在本机加密保存，其他设备需重新配置；不要复制旧设备凭据目录。',
 '番茄自动上传需要 Google Chrome。当前封面支持导入本地图片；不要求 Codex。',
 '计划中心可开启关闭窗口后后台运行与登录 Windows 后启动。电脑须开机联网，休眠或关机时不执行。',
 '本包不包含作品、登录、密钥或已启用计划，不会首次启动就产生生成费用。',
 '已有日用版用户不要把空白库覆盖到旧库；升级须沿用原数据目录。',
 '各项验收范围见交付报告；歌词密钥、图片服务和创作主题由使用者配置。',
].join('\r\n'));
console.log(JSON.stringify({root,executable,manifest:path.join(root,'portable-manifest.json')}));
