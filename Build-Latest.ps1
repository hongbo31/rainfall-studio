#Requires -Version 7.0
[CmdletBinding()]
param(
  [switch]$Local,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'out')
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if ($PSVersionTable.PSVersion.Major -ne 7 -or !$IsWindows -or ![Environment]::Is64BitOperatingSystem) {
  throw '请使用 64 位 Windows 和 PowerShell 7。'
}
$git = (Get-Command git.exe -ErrorAction SilentlyContinue).Source
if (!$git) { throw '请先安装 Git for Windows，并重新打开 PowerShell 7。' }

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
$output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
$buildCache = Join-Path $env:LOCALAPPDATA 'RainfallStudioBuild'
$downloadCache = Join-Path $buildCache 'downloads'
$npmCache = Join-Path $buildCache 'npm'
$tempRoot = [IO.Path]::TrimEndingDirectorySeparator((Get-Item -LiteralPath ([IO.Path]::GetTempPath())).FullName)
$buildId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$scratch = Join-Path $tempRoot "rsb-$buildId"
$source = Join-Path $scratch 'src'
$partial = $null
$originalPath = $env:Path
New-Item -ItemType Directory -Path $scratch | Out-Null
try {
  Write-Host '[1/5] 获取源码'
  $cloneArgs = @('-c', 'http.lowSpeedLimit=1024', '-c', 'http.lowSpeedTime=30',
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
    throw '获取源码失败，请检查网络和 GitHub 仓库权限。'
  }
  $commit = Invoke-BuildCommand $git @('-C', $source, 'rev-parse', 'HEAD') '读取源码提交失败'
  Write-Host "源码提交 $commit"

  Write-Host '[2/5] 准备 Node.js 与锁定依赖'
  New-Item -ItemType Directory -Path $downloadCache -Force | Out-Null
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
      '--cache', $npmCache, '--prefer-offline', '--fetch-retries=1', '--fetch-timeout=30000')
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

    Write-Host '[3/5] 准备 Electron 与 FFmpeg'
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

    Write-Host '[4/5] 构建 Windows 免安装版'
    $buildOutput = @(Invoke-BuildCommand $node @('scripts/package-portable.mjs', '--media-tools-dir', (Join-Path $scratch $mediaName)) '打包失败')
    $built = $buildOutput[-1] | ConvertFrom-Json
    $manifest = Get-Content -LiteralPath $built.manifest -Raw | ConvertFrom-Json
    if ($manifest.sourceCommit -ne $commit -or !$manifest.sourceCommitIsExact -or
        $manifest.kind -ne 'windows-x64-portable' -or !(Test-Path -LiteralPath $built.executable -PathType Leaf)) {
      throw '打包清单与本次检出的源码不一致。'
    }
  } finally {
    Pop-Location
  }

  Write-Host '[5/5] 生成 ZIP 和校验文件'
  New-Item -ItemType Directory -Path $output -Force | Out-Null
  $name = "RainfallStudio-$($manifest.version)-$($commit.Substring(0, 12))-win-x64"
  $zip = Join-Path $output "$name.zip"
  if (Test-Path -LiteralPath $zip) { $zip = Join-Path $output "$name-$buildId.zip" }
  $partial = "$zip.partial-$buildId"
  [IO.Compression.ZipFile]::CreateFromDirectory($built.root, $partial, [IO.Compression.CompressionLevel]::Fastest, $false)
  $hash = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::Move($partial, $zip)
  Set-Content -LiteralPath "$zip.sha256" -Value "$hash  $([IO.Path]::GetFileName($zip))" -Encoding utf8
  Write-Host "打包完成。解压 ZIP 后运行 RainfallStudio.exe。"
  $zip
} finally {
  $env:Path = $originalPath
  if ($partial -and (Test-Path -LiteralPath $partial)) { Remove-Item -LiteralPath $partial -Force }
  $resolved = Get-Item -LiteralPath $scratch -ErrorAction SilentlyContinue
  if ($resolved -and $resolved.FullName -eq $scratch -and $resolved.Parent.FullName -eq $tempRoot -and
      !($resolved.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    Remove-Item -LiteralPath $resolved.FullName -Recurse -Force
  }
}
