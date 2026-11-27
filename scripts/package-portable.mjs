// New-device package: runtime included; no developer paths, library or credentials.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const repo = fileURLToPath(new URL('..', import.meta.url));
const mediaArg = process.argv.indexOf('--media-tools-dir');
if (mediaArg >= 0 && (!process.argv[mediaArg + 1] || process.argv[mediaArg + 1].startsWith('--'))) {
  throw Error('--media-tools-dir requires a directory');
}
const mediaSource = path.resolve(repo, mediaArg >= 0 ? process.argv[mediaArg + 1] : 'tools/ffmpeg');
const installerRuntime = {};
for (const [name, exe] of [['chromium', 'chrome.exe'], ['powershell', 'pwsh.exe']]) {
  const index = process.argv.indexOf(`--${name}-dir`);
  if (index < 0) continue;
  const source = process.argv[index + 1];
  if (!source || !path.isAbsolute(source) || !fs.statSync(path.join(source, exe), {throwIfNoEntry: false})?.isFile()) {
    throw Error(`Invalid --${name}-dir`);
  }
  installerRuntime[name] = source;
}
if (Object.keys(installerRuntime).length === 1) throw Error('Supply both bundled Windows runtimes');
const mediaFiles = ['bin/ffmpeg.exe', 'bin/ffprobe.exe', 'LICENSE', 'README.txt'];
for (const file of mediaFiles) {
  if (!fs.statSync(path.join(mediaSource, file), {throwIfNoEntry: false})?.isFile()) {
    throw Error('FFmpeg file missing: ' + path.join(mediaSource, file) + '. Set --media-tools-dir.');
  }
}
execFileSync(process.execPath,['scripts/build-desktop.mjs'],{cwd:repo,stdio:'inherit'});
const output=execFileSync(process.execPath,['scripts/package-tme-candidate.mjs','--simple-publishing'],{cwd:repo,encoding:'utf8'});
const candidate=JSON.parse(output.trim().split(/\r?\n/).at(-1));
const root=path.dirname(candidate.executable),app=path.join(root,'resources','app');
const sourceFiles=execFileSync('git',['ls-files','-m','-o','--exclude-standard','-z'],{cwd:repo,encoding:'utf8'}).split('\0').filter(Boolean);
// Candidate builds inject an absolute testing data root. Never ship that bootstrap.
fs.copyFileSync(path.join(repo,'build','main.cjs'),path.join(app,'build','main.cjs'));
const packageFile=path.join(app,'package.json');
const pkg=JSON.parse(fs.readFileSync(packageFile,'utf8'));
Object.assign(pkg,{name:'rainfall-studio',productName:'Rainfall Studio'});
fs.writeFileSync(packageFile,JSON.stringify(pkg,null,2));
const executable=path.join(root,'RainfallStudio.exe');
fs.renameSync(candidate.executable,executable);
if (installerRuntime.chromium) {
  const require = createRequire(import.meta.url);
  const editor = path.resolve(require.resolve('electron-winstaller'), '../../vendor/rcedit.exe');
  execFileSync(editor, [executable, '--set-icon', path.join(app, 'assets', 'rainfall.ico'),
    '--set-version-string', 'ProductName', 'Rainfall Studio',
    '--set-version-string', 'FileDescription', 'Rainfall Studio',
    '--set-version-string', 'CompanyName', 'Rainfall Studio',
    '--set-file-version', pkg.version.split('-')[0], '--set-product-version', pkg.version.split('-')[0]],
  {windowsHide: true, stdio: 'pipe'});
}
fs.unlinkSync(path.join(root,'candidate-manifest.json'));
const mediaDest=path.join(app,'tools','media');
fs.mkdirSync(mediaDest,{recursive:true});
for (const file of mediaFiles) fs.copyFileSync(path.join(mediaSource, file), path.join(mediaDest, path.basename(file)));
for (const [name, source] of Object.entries(installerRuntime)) {
  fs.cpSync(source, path.join(app, 'tools', name), {recursive: true});
}
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
 '首次使用时，在配置中心设置模型和下载目录，在账号管理添加账号和艺人。',
 'API 密钥在本机加密保存。新设备在配置中心保存自己的密钥。',
 installerRuntime.chromium
   ? '安装包已随附专用浏览器与 PowerShell 7。封面可按首生成或从本地导入。'
   : '番茄自动上传需要 Google Chrome。封面可按首生成或从本地导入。',
 '计划中心可开启关闭窗口后后台运行与登录 Windows 后启动。电脑须开机联网，休眠或关机时不执行。',
 '本包不包含作品、登录、密钥或已启用计划，不会首次启动就产生生成费用。',
 '已有日用版用户不要把空白库覆盖到旧库；升级须沿用原数据目录。',
 '各项验收范围见交付报告；歌词密钥、图片服务和创作主题由使用者配置。',
].join('\r\n'));
console.log(JSON.stringify({root,executable,manifest:path.join(root,'portable-manifest.json')}));
