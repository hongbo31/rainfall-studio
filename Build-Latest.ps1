#Requires -Version 7.0
[CmdletBinding()]
param(
  [switch]$Local,
  [switch]$DeferCleanup,
  [switch]$CleanupInstalled,
  [string]$OutputDirectory,
  [string]$BuildRoot = $env:RAINFALL_BUILD_ROOT
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if ($PSVersionTable.PSVersion.Major -ne 7 -or !$IsWindows -or ![Environment]::Is64BitOperatingSystem) {
  throw '请使用 64 位 Windows 和 PowerShell 7。'
}
$git = (Get-Command git.exe -ErrorAction SilentlyContinue).Source
if (!$git) { throw '请先安装 Git for Windows，并重新打开 PowerShell 7。' }
. (Join-Path $PSScriptRoot 'scripts/Build-ArtifactRetention.ps1')

function Invoke-BuildCommand($File, [string[]]$Arguments, $Failure) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Failure（退出码 $LASTEXITCODE）" }
}

function Get-BuildArchive($Url, $Sha256, $MirrorUrl) {
  if ($Sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw "下载文件缺少 SHA-256 校验值：$Url" }
  $name = [IO.Path]::GetFileName(([uri]$Url).AbsolutePath)
  $file = Join-Path $downloadCache $name
  if ((Test-Path -LiteralPath $file -PathType Leaf) -and
      (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -eq $Sha256) { return $file }
  $download = "$file.partial-$buildId"
  try {
    Write-Host "下载 $name"
    $request = @{ Uri = $Url; OutFile = $download; ProgressAction = 'SilentlyContinue'; TimeoutSec = 120 }
    try {
      Invoke-WebRequest @request
    } catch [Net.Http.HttpRequestException], [IO.IOException] {
      if ($MirrorUrl) {
        Write-Host '官方下载连接中断，重试可校验的镜像。'
        $request.Uri = $MirrorUrl
      } else {
        Write-Host '下载连接中断，重试直连。'
      }
      Invoke-WebRequest @request -NoProxy
    }
    if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $Sha256) {
      throw "SHA-256 校验失败：$name"
    }
    [IO.File]::Move($download, $file, $true)
    return $file
  } finally {
    if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download -Force }
  }
}

$repository = 'https://github.com/hongbo31/rainfall-studio.git'
$pointerFile = Join-Path $env:LOCALAPPDATA 'RainfallStudioLauncher/verified-desktop.json'
$desktop = if (Test-Path -LiteralPath $pointerFile -PathType Leaf) {
  Get-Content -LiteralPath $pointerFile -Raw | ConvertFrom-Json
}
if (!$BuildRoot) {
  $BuildRoot = Join-Path (Split-Path $PSScriptRoot -Parent) ((Split-Path $PSScriptRoot -Leaf) + '-build')
}
$buildRoot = Get-RainfallAbsolutePath ([IO.Path]::GetFullPath($BuildRoot, $PSScriptRoot))
$output = if ($OutputDirectory) {
  Get-RainfallAbsolutePath ([IO.Path]::GetFullPath($OutputDirectory, $PSScriptRoot))
} else {
  Join-Path $buildRoot 'out'
}
foreach ($directory in @($buildRoot, $output)) {
  if ($directory -match '(?i)(^|[\\/])2026-10-15([\\/]|$)') { throw "构建路径不符合本机存储规则：$directory" }
  foreach ($protected in @($desktop.packageRoot, $desktop.dataRoot, $desktop.backupRoot)) {
    if ($protected -and (Test-RainfallPathOverlap $directory $protected)) { throw "构建路径与正式数据或交付目录重叠：$directory" }
  }
}
$buildCache = Join-Path $buildRoot 'cache'
$downloadCache = Join-Path $buildCache 'downloads'
$npmCache = Join-Path $buildCache 'npm'
$runsRoot = Join-Path $buildRoot 'runs'
$recordsRoot = Join-Path $buildRoot 'records'
foreach ($directory in @($output, $runsRoot, $recordsRoot, $downloadCache, $npmCache)) {
  Assert-RainfallPhysicalPath $directory
  [void][IO.Directory]::CreateDirectory($directory)
}
$lockPath = Join-Path $buildRoot 'build.lock'
Assert-RainfallPhysicalPath $lockPath
$buildLock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
if ($CleanupInstalled) {
  try {
    if ($Local -or $DeferCleanup) { throw '清理已安装版本时只需要 -CleanupInstalled。' }
    $launcher = Join-Path (Split-Path -Parent $pointerFile) 'Launch-Verified.ps1'
    if (!$desktop -or !(Test-Path -LiteralPath $launcher -PathType Leaf)) { throw '缺少已验收的桌面版本。' }
    Invoke-BuildCommand (Join-Path $PSHOME 'pwsh.exe') @('-NoProfile', '-File', $launcher, '-ValidateOnly') '桌面版本验证失败' | Out-Null
    $record = Get-ChildItem -LiteralPath $recordsRoot -File -Filter 'rsb-*.json' |
      Sort-Object LastWriteTimeUtc -Descending |
      ForEach-Object {
        Assert-RainfallPhysicalPath $_.FullName
        Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
      } |
      Where-Object {
        $_.kind -eq 'rainfall-studio-verified-build' -and $_.sourceCommit -eq $desktop.sourceCommit -and
          $_.outputDirectory -eq $output -and (Test-Path -LiteralPath (Join-Path $output $_.archiveName) -PathType Leaf)
      } |
      Select-Object -First 1
    if (!$record) { throw '未找到已安装版本对应的构建记录和压缩包。' }
    Remove-RainfallSupersededBuilds $recordsRoot $runsRoot $record (Get-RainfallArtifactProtection) -CacheRoot $buildCache
    return
  } finally {
    $buildLock.Dispose()
  }
}
$buildId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$runId = "rsb-$buildId"
$scratch = Join-Path $runsRoot $runId
$source = Join-Path $scratch 'src'
$partial = $null
$recordTemp = $null
$createdArchive = $false
$createdSidecar = $false
$verified = $false
$ownsRun = $false
$originalPath = $env:Path
$originalEnvironment = @{}
foreach ($name in @('TEMP', 'TMP', 'ELECTRON_CACHE', 'ELECTRON_SKIP_BINARY_DOWNLOAD', 'RAINFALL_SMS_APK_DIR')) {
  $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
  New-Item -ItemType Directory -Path $scratch | Out-Null
  [ordered]@{
    kind = 'rainfall-studio-build-run'
    id = $runId
    pid = $PID
    processStartTicks = (Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $scratch 'rainfall-build-run.json') -Encoding utf8
  $ownsRun = $true
  $temporary = Join-Path $scratch 'tmp'
  [void][IO.Directory]::CreateDirectory($temporary)
  $env:TEMP = $temporary
  $env:TMP = $temporary
  $env:ELECTRON_CACHE = Join-Path $buildCache 'electron'
  $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
  Write-Host "构建与验证：$scratch"
  Write-Host "缓存：$buildCache"
  Write-Host "成品：$output"

  Write-Host '[1/6] 获取源码'
  $cloneArgs = @('-c', 'core.longpaths=true', '-c', 'http.lowSpeedLimit=1024', '-c', 'http.lowSpeedTime=30',
    'clone', '--quiet', '--depth', '1', '--single-branch', '--no-tags')
  if ($Local) {
    $cloneArgs += @('--no-local', '--', $PSScriptRoot, $source)
  } else {
    $cloneArgs += @('--branch', 'main', '--', $repository, $source)
  }
  $cloneOutput = & $git @cloneArgs 2>&1
  $cloneExit = $LASTEXITCODE
  if ($cloneExit -ne 0 -and !$Local -and
      ($cloneOutput -join ' ') -match 'SSL/TLS connection failed|SSL_ERROR_SYSCALL|Proxy CONNECT aborted|Could not resolve proxy|Connection was reset|Failed to connect|Operation too slow') {
    Write-Host 'Git 代理连接失败，重试直连 GitHub。'
    $source = Join-Path $scratch 'src-direct'
    $cloneArgs[-1] = $source
    $cloneOutput = & $git -c http.proxy= -c http.sslBackend=openssl @cloneArgs 2>&1
    $cloneExit = $LASTEXITCODE
  }
  if ($cloneExit -ne 0) {
    $cloneOutput | Out-Host
    if ($Local) { throw '获取本地提交失败，请检查当前工作区的 Git 元数据。' }
    throw '获取源码失败，请检查网络和 GitHub 仓库权限。'
  }
  $commit = Invoke-BuildCommand $git @('-C', $source, 'rev-parse', 'HEAD') '读取源码提交失败'
  Write-Host "源码提交 $commit"

  Write-Host '[2/6] 准备 Node.js 与锁定依赖'
  $nodeFolder = 'node-v24.14.0-win-x64'
  $nodeArchive = Get-BuildArchive "https://nodejs.org/dist/v24.14.0/$nodeFolder.zip" '313fa40c0d7b18575821de8cb17483031fe07d95de5994f6f435f3b345f85c66'
  [IO.Compression.ZipFile]::ExtractToDirectory($nodeArchive, $scratch)
  $nodeDirectory = Join-Path $scratch $nodeFolder
  $node = Join-Path $nodeDirectory 'node.exe'
  $npm = Join-Path $nodeDirectory 'node_modules\npm\bin\npm-cli.js'
  $env:Path = "$nodeDirectory;$originalPath"
  Push-Location -LiteralPath $source
  try {
    $npmArgs = @($npm, 'ci', '--include=dev', '--no-audit', '--no-fund',
      '--cache', $npmCache, '--logs-dir', (Join-Path $scratch 'npm-logs'),
      '--prefer-offline', '--fetch-retries=1', '--fetch-timeout=30000')
    try {
      Invoke-BuildCommand $node $npmArgs '安装项目依赖失败' | Out-Host
    } catch {
      if (!$env:HTTP_PROXY -and !$env:HTTPS_PROXY) { throw }
      $previousNoProxy = $env:NO_PROXY
      try {
        Write-Host '重试直连 npm 官方源。'
        $env:NO_PROXY = ($previousNoProxy, 'registry.npmjs.org' -ne '' -join ',').Trim(',')
        Invoke-BuildCommand $node $npmArgs '安装项目依赖失败' | Out-Host
      } finally {
        $env:NO_PROXY = $previousNoProxy
      }
    }

    Write-Host '[3/6] 准备 Electron 与 FFmpeg'
    $electronFolder = Join-Path $source 'node_modules\electron'
    $electronVersion = (Get-Content -LiteralPath (Join-Path $electronFolder 'package.json') -Raw | ConvertFrom-Json).version
    $electronName = "electron-v$electronVersion-win32-x64.zip"
    $electronChecksums = Get-Content -LiteralPath (Join-Path $electronFolder 'checksums.json') -Raw | ConvertFrom-Json -AsHashtable
    $electronArchive = Get-BuildArchive "https://github.com/electron/electron/releases/download/v$electronVersion/$electronName" $electronChecksums[$electronName] "https://npmmirror.com/mirrors/electron/v$electronVersion/$electronName"
    [IO.Compression.ZipFile]::ExtractToDirectory($electronArchive, (Join-Path $electronFolder 'dist'), $true)
    $mediaName = 'ffmpeg-8.1-essentials_build'
    $mediaUrl = "https://github.com/GyanD/codexffmpeg/releases/download/8.1/$mediaName.zip"
    $mediaArchive = Get-BuildArchive $mediaUrl '8748283d821613d930b0e7be685aaa9df4ca6f0ad4d0c42fd02622b3623463c6' "https://ghfast.top/$mediaUrl"
    [IO.Compression.ZipFile]::ExtractToDirectory($mediaArchive, $scratch)

    Write-Host '[4/6] 构建 Windows 免安装版'
    $env:RAINFALL_SMS_APK_DIR = if ($originalEnvironment['RAINFALL_SMS_APK_DIR']) {
      [IO.Path]::GetFullPath($originalEnvironment['RAINFALL_SMS_APK_DIR'], $PSScriptRoot)
    } else {
      Join-Path $buildRoot 'android-sms'
    }
    $buildOutput = @(Invoke-BuildCommand $node @('scripts/package-portable.mjs', '--media-tools-dir', (Join-Path $scratch $mediaName)) '打包失败')
    $built = $buildOutput[-1] | ConvertFrom-Json
    $package = Get-RainfallArtifactChild (Join-Path $source 'out') $built.root
    if (!$package.PSIsContainer -or $built.manifest -ne (Join-Path $package.FullName 'portable-manifest.json') -or
        $built.executable -ne (Join-Path $package.FullName 'RainfallStudio.exe')) {
      throw '打包程序返回的路径不属于本次构建。'
    }
    $manifest = Get-Content -LiteralPath $built.manifest -Raw | ConvertFrom-Json
    if ($manifest.sourceCommit -ne $commit -or !$manifest.sourceCommitIsExact -or
        $manifest.kind -ne 'windows-x64-portable' -or !(Test-Path -LiteralPath $built.executable -PathType Leaf)) {
      throw '打包清单与本次检出的源码不一致。'
    }
  } finally {
    Pop-Location
  }

  Write-Host '[5/6] 生成并校验 ZIP，验证随包运行组件'
  $zipTemp = Join-Path $scratch 'package.zip'
  [IO.Compression.ZipFile]::CreateFromDirectory($built.root, $zipTemp, [IO.Compression.CompressionLevel]::Fastest, $false)
  $zipManifest = Assert-RainfallPortableArchive $zipTemp $commit
  if ($zipManifest.version -ne $manifest.version) { throw '压缩包版本与构建结果不符。' }
  Invoke-BuildCommand $node @((Join-Path $PSScriptRoot 'scripts/verify-portable-build.cjs'), $built.root,
    (Join-Path $scratch 'verification-data')) '随包运行组件验证失败' | Out-Host
  $hash = (Get-FileHash -LiteralPath $zipTemp -Algorithm SHA256).Hash.ToLowerInvariant()

  Write-Host '[6/6] 交付新包并清理已替代产物'
  $name = "RainfallStudio-$($manifest.version)-$($commit.Substring(0, 12))-win-x64"
  $zip = Join-Path $output "$name.zip"
  if ((Test-Path -LiteralPath $zip) -or (Test-Path -LiteralPath "$zip.sha256")) {
    $zip = Join-Path $output "$name-$buildId.zip"
  }
  Assert-RainfallPhysicalPath $output
  if ([IO.Path]::GetPathRoot($zip) -ne [IO.Path]::GetPathRoot($zipTemp)) {
    $copyPath = "$zip.partial-$buildId"
    $destination = [IO.File]::Open($copyPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $partial = $copyPath
    try {
      $inputZip = [IO.File]::OpenRead($zipTemp)
      try { $inputZip.CopyTo($destination) } finally { $inputZip.Dispose() }
    } finally { $destination.Dispose() }
    if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $hash) { throw '目标盘压缩包校验失败。' }
    $zipTemp = $partial
  }
  [IO.File]::Move($zipTemp, $zip)
  $createdArchive = $true
  $checksumFile = [IO.File]::Open("$zip.sha256", [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  $createdSidecar = $true
  try {
    $line = [Text.Encoding]::UTF8.GetBytes("$hash  $([IO.Path]::GetFileName($zip))" + [Environment]::NewLine)
    $checksumFile.Write($line, 0, $line.Length)
  } finally { $checksumFile.Dispose() }
  $record = [pscustomobject]@{
    kind = 'rainfall-studio-verified-build'
    id = $runId
    lane = $(if ($Local) { 'local' } else { 'main' })
    outputDirectory = $output
    archiveName = [IO.Path]::GetFileName($zip)
    sourceCommit = $commit
    sha256 = $hash
  }
  $recordTemp = Join-Path $recordsRoot "$runId.json.tmp"
  $record | ConvertTo-Json | Set-Content -LiteralPath $recordTemp -Encoding utf8
  [IO.File]::Move($recordTemp, (Join-Path $recordsRoot "$runId.json"))
  $verified = $true
  if (!$DeferCleanup) {
    try {
      $result = Remove-RainfallSupersededBuilds $recordsRoot $runsRoot $record (Get-RainfallArtifactProtection) -CacheRoot $buildCache
      Write-Host "已清理 $($result.Archives) 个旧包、$($result.Runs) 个历史验证目录和 $([Math]::Round($result.CacheBytes / 1MB, 1)) MiB 构建缓存。"
    } catch { Write-Warning "新包已验证，暂缓清理历史产物。$($_.Exception.Message)" }
  }
  Write-Host "打包完成。解压 ZIP 后运行 RainfallStudio.exe。"
  $zip
} finally {
  try {
    $env:Path = $originalPath
    foreach ($name in $originalEnvironment.Keys) {
      [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process')
    }
    if ($partial -and (Test-Path -LiteralPath $partial -PathType Leaf)) {
      $item = Get-RainfallArtifactChild $output $partial
      Remove-Item -LiteralPath $item.FullName -Force
    }
    if ($recordTemp -and (Test-Path -LiteralPath $recordTemp -PathType Leaf)) {
      $item = Get-RainfallArtifactChild $recordsRoot $recordTemp
      Remove-Item -LiteralPath $item.FullName -Force
    }
    if (!$verified -and $createdArchive) {
      $item = Get-RainfallArtifactChild $output $zip
      if ((Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash -eq $hash) {
        Remove-Item -LiteralPath $item.FullName -Force
        if ($createdSidecar -and (Get-RainfallArchiveSha $zip) -eq $hash) {
          Remove-Item -LiteralPath "$zip.sha256" -Force
        }
      }
    }
    if ($ownsRun) {
      $null = Remove-RainfallBuildRun $runsRoot $scratch (Get-RainfallArtifactProtection) -CurrentRun
    }
  } catch { Write-Warning "保留本次未能安全清理的临时文件。$($_.Exception.Message)" }
  finally {
    $buildLock.Dispose()
  }
}
