import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createWindowsInstaller } from 'electron-winstaller';

const [appDirectory, workspace, setupExe, compressionTool] = process.argv.slice(2);
assert([appDirectory, workspace, compressionTool].every(file => path.isAbsolute(file)));
assert(/^RainfallStudio-[\w.-]+-Setup\.exe$/.test(setupExe));
const manifest = JSON.parse(fs.readFileSync(path.join(appDirectory, 'portable-manifest.json'), 'utf8'));
const installerFolder = path.join(workspace, 'installer');
const setup = path.join(installerFolder, setupExe);
const require = createRequire(import.meta.url);
const vendor = path.resolve(require.resolve('electron-winstaller'), '../../vendor');
const sevenZip = path.join(vendor, '7z.exe');
const squirrelTemp = path.join(workspace, 'squirrel');
fs.mkdirSync(squirrelTemp);
process.env.SQUIRREL_TEMP = squirrelTemp;
// Bootstrap extraction with the locked tool, then use a current 7-Zip for the
// full payload. Squirrel's bundled 16.04 tool produced invalid entry CRCs.
for (const extension of ['exe', 'dll']) {
  fs.copyFileSync(path.join(vendor, `7z-x64.${extension}`), path.join(vendor, `7z.${extension}`));
}
const compressionFolder = path.join(workspace, 'compression');
execFileSync(sevenZip, ['x', '-t7z', compressionTool, `-o${compressionFolder}`, '-y', '7z.exe', '7z.dll'], {
  windowsHide: true, stdio: 'pipe', timeout: 30_000,
});
for (const extension of ['exe', 'dll']) {
  fs.copyFileSync(path.join(compressionFolder, `7z.${extension}`), path.join(vendor, `7z.${extension}`));
}

await createWindowsInstaller({
  appDirectory,
  outputDirectory: installerFolder,
  name: 'RainfallStudioClient',
  exe: 'RainfallStudio.exe',
  setupExe,
  setupIcon: path.join(appDirectory, 'resources', 'app', 'assets', 'rainfall.ico'),
  description: 'Rainfall Studio',
  noMsi: true,
  noDelta: true,
  nuspecTemplate: path.join(import.meta.dirname, 'windows-installer.nuspec.template'),
});

// Extract the ZIP resource from the final Setup.exe itself without installing it.
const extraction = path.join(workspace, 'setup-check');
function unpack(format, file, folder, ...files) {
  execFileSync(sevenZip, ['x', `-t${format}`, file, `-o${folder}`, '-y', ...files], {
    windowsHide: true, stdio: 'pipe', timeout: 180_000,
  });
}
unpack('PE', setup, extraction, '.rsrc\\DATA\\131');
const payload = path.join(extraction, 'payload');
unpack('zip', path.join(extraction, '.rsrc', 'DATA', '131'), payload);
assert(fs.statSync(path.join(payload, 'Update.exe')).isFile(), 'Embedded installer is missing Update.exe');
const packages = fs.readdirSync(payload).filter(name => name.endsWith('-full.nupkg'));
assert.equal(packages.length, 1, 'Expected one full embedded application package');
const updatePackage = path.join(installerFolder, packages[0]);
const releases = path.join(installerFolder, 'RELEASES');
assert(fs.statSync(releases, {throwIfNoEntry: false})?.isFile(), 'Squirrel RELEASES file is missing');
const updatePackageStat = fs.statSync(updatePackage);
const releaseEntry = fs.readFileSync(releases, 'utf8').split(/\r?\n/u)
  .map(line => line.trim().split(/\s+/u)).find(parts => parts[1] === packages[0]);
assert(releaseEntry, 'RELEASES does not point to the full application package');
assert.equal(Number(releaseEntry[2]), updatePackageStat.size, 'RELEASES package size differs from the full package');
assert.equal(releaseEntry[0].toLowerCase(), await fileHash(updatePackage, 'sha1'), 'RELEASES package hash differs from the full package');
async function fileHash(file, algorithm = 'sha256') {
  const hash = createHash(algorithm);
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
assert.equal(await fileHash(path.join(payload, packages[0])),
  await fileHash(path.join(installerFolder, packages[0])), 'Setup and build payloads differ');
const installed = path.join(extraction, 'installed');
unpack('zip', path.join(payload, packages[0]), installed);
const runtime = path.join(installed, 'lib', 'net45');
for (const entry of manifest.files) assert.equal(await fileHash(path.join(runtime, entry.path)), entry.sha256, entry.path);
for (const name of ['README.txt', 'portable-manifest.json']) {
  assert.deepEqual(fs.readFileSync(path.join(runtime, name)), fs.readFileSync(path.join(appDirectory, name)), name);
}
console.log(`Setup payload matches ${manifest.files.length} files in the verified manifest`);
execFileSync(process.execPath, [path.join(import.meta.dirname, 'verify-portable-build.cjs'), runtime,
  path.join(extraction, 'verification-data'), '--installer'], {
  windowsHide: true, stdio: 'inherit', timeout: 180_000,
});
console.log(JSON.stringify({
  setup,
  verifiedFiles: manifest.files.length + 2,
  updatePackage,
  updatePackageName: path.basename(updatePackage),
  updatePackageSha256: await fileHash(updatePackage),
  releases,
  releasesSha256: await fileHash(releases),
}));
