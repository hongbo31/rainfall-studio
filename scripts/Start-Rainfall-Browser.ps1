#Requires -Version 7.0
[CmdletBinding()]
param(
    [switch] $BuildOnly
)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$workspace = if ($env:RAINFALL_WEB_WORKSPACE) {
    [IO.Path]::GetFullPath($env:RAINFALL_WEB_WORKSPACE, $source)
} else {
    Join-Path (Split-Path $source -Parent) ((Split-Path $source -Leaf) + '-browser-dev')
}
$workspace = [IO.Path]::TrimEndingDirectorySeparator($workspace)
if ($workspace.Equals($source, [StringComparison]::OrdinalIgnoreCase) -or
    $workspace.StartsWith($source + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Choose a browser workspace separate from the source folder.'
}

$nodeDirectory = if ($env:RAINFALL_NODE_DIR) {
    [IO.Path]::GetFullPath($env:RAINFALL_NODE_DIR, $source)
} else {
    $localNode = Join-Path $workspace 'tools/node'
    if (Test-Path -LiteralPath (Join-Path $localNode 'npm.cmd')) {
        $localNode
    } else {
        $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (!$npmCommand) { throw 'Install Node.js 24 x64 with npm, or set RAINFALL_NODE_DIR.' }
        Split-Path $npmCommand.Source -Parent
    }
}
$node = Join-Path $nodeDirectory 'node.exe'
$npm = Join-Path $nodeDirectory 'npm.cmd'
if (!(Test-Path -LiteralPath $node) -or !(Test-Path -LiteralPath $npm)) {
    throw 'Use Node.js 24 x64 with npm, or set RAINFALL_NODE_DIR to the folder containing node.exe and npm.cmd.'
}
$version = & $node -p 'process.platform + "-" + process.arch + "-" + process.versions.node'
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^win32-x64-24\.') {
    throw 'Rainfall Studio requires Node.js 24 x64 on Windows.'
}

$lockfile = Join-Path $source 'package-lock.json'
$lockHash = (Get-FileHash -LiteralPath $lockfile -Algorithm SHA256).Hash.ToLowerInvariant()
$dependencies = Join-Path $workspace ('runtime/' + $version + '-' + $lockHash.Substring(0, 16))
$env:Path = "$nodeDirectory;$env:Path"
$env:npm_config_cache = Join-Path $workspace 'cache/npm'
$env:npm_config_prefer_offline = 'true'
$env:npm_package_config_node_gyp_devdir = Join-Path $workspace 'cache/node-gyp'
$env:electron_config_cache = Join-Path $workspace 'cache/electron'
$env:TEMP = $env:TMP = Join-Path $workspace 'temp'
New-Item -ItemType Directory -Path $dependencies,$env:TEMP -Force | Out-Null

# Hold the dependency lock only while preparing the pinned runtime.
try {
    $prepareLock = [IO.File]::Open((Join-Path $dependencies '.prepare.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
} catch {
    throw 'Another Rainfall startup is preparing dependencies. Wait for it to finish, then retry.'
}
try {
    $ready = Join-Path $dependencies '.dependencies-ready'
    $electron = Join-Path $dependencies 'node_modules/electron/dist/electron.exe'
    if (!(Test-Path -LiteralPath $ready) -or !(Test-Path -LiteralPath $electron)) {
        Copy-Item -LiteralPath (Join-Path $source 'package.json'),$lockfile -Destination $dependencies -Force
        Push-Location -LiteralPath $dependencies
        try {
            # The lockfile supplies Windows prebuilt bindings. npm's implicit node-gyp install
            # would try to rebuild better-sqlite3 even though the shipped binding is available.
            & $npm ci --ignore-scripts --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
            & $node 'node_modules/electron/install.js'
            if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $electron)) { throw 'Electron runtime installation failed.' }
            Set-Content -LiteralPath $ready -Value $lockHash -Encoding utf8NoBOM
        } finally {
            Pop-Location
        }
    }
} finally {
    $prepareLock.Dispose()
}

# Each launch reads a private snapshot so a rebuild cannot change files an active session uses.
$snapshot = Join-Path $dependencies ('source-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $snapshot | Out-Null
foreach ($name in @('src','assets','scripts','templates','package.json','package-lock.json','tsconfig.json')) {
    Copy-Item -LiteralPath (Join-Path $source $name) -Destination $snapshot -Recurse
}
# The source runtime uses the same bundled media tool layout as the portable release.
$mediaTools = if ($env:RAINFALL_MEDIA_TOOLS) {
    [IO.Path]::GetFullPath($env:RAINFALL_MEDIA_TOOLS, $source)
} else {
    Join-Path $workspace 'tools/media'
}
if ((Test-Path -LiteralPath (Join-Path $mediaTools 'ffmpeg.exe')) -and
    (Test-Path -LiteralPath (Join-Path $mediaTools 'ffprobe.exe'))) {
    $tools = Join-Path $snapshot 'tools'
    New-Item -ItemType Directory -Path $tools | Out-Null
    New-Item -ItemType Junction -Path (Join-Path $tools 'media') -Target $mediaTools | Out-Null
} else {
    Write-Warning 'For audio import and video export, set RAINFALL_MEDIA_TOOLS to a folder containing ffmpeg.exe and ffprobe.exe.'
}
$originalSmsApkDirectory = $env:RAINFALL_SMS_APK_DIR
$env:RAINFALL_SMS_APK_DIR = if ($originalSmsApkDirectory) {
    [IO.Path]::GetFullPath($originalSmsApkDirectory, $source)
} else {
    Join-Path (Split-Path $source -Parent) ((Split-Path $source -Leaf) + '-build/android-sms')
}
Push-Location -LiteralPath $snapshot
try {
    & $node 'scripts/build-desktop.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Rainfall Studio build failed.' }
} finally {
    Pop-Location
    $env:RAINFALL_SMS_APK_DIR = $originalSmsApkDirectory
}
Write-Output "RAINFALL_STAGED_SOURCE=$snapshot"
if ($BuildOnly) { return }

# Prefer the currently verified desktop workspace when it can be identified.
if ($env:RAINFALL_WEB_DATA_ROOT) {
    $dataRoot = [IO.Path]::GetFullPath($env:RAINFALL_WEB_DATA_ROOT, $source)
} else {
    $pointerPath = Join-Path $env:LOCALAPPDATA 'RainfallStudioLauncher/verified-desktop.json'
    if (Test-Path -LiteralPath $pointerPath) {
        $pointer = Get-Content -LiteralPath $pointerPath -Raw | ConvertFrom-Json
        $dataRoot = $pointer.dataRoot
        if ($pointer.format -ne 1 -or $pointer.validation -ne 'accepted' -or
            !$dataRoot -or ![IO.Path]::IsPathFullyQualified($dataRoot)) {
            throw 'The verified desktop pointer is invalid.'
        }
        $database = Join-Path $dataRoot 'production/library.sqlite'
        if (!(Test-Path -LiteralPath $database -PathType Leaf)) {
            throw 'The verified desktop library is unavailable.'
        }
        $stream = [IO.File]::Open($database, 'Open', 'Read', 'ReadWrite')
        try {
            $header = [byte[]]::new(100)
            if ($stream.Read($header, 0, 100) -ne 100 -or
                [Text.Encoding]::ASCII.GetString($header, 0, 16) -ne "SQLite format 3`0") {
                throw 'The verified desktop library has an invalid SQLite header.'
            }
            $schema = ([int]$header[60] -shl 24) -bor ([int]$header[61] -shl 16) -bor ([int]$header[62] -shl 8) -bor $header[63]
            if ($schema -ne 3 -or $schema -ne $pointer.schema) {
                throw 'The verified desktop library would require a schema change. Open the browser from the accepted desktop app instead.'
            }
        } finally {
            $stream.Dispose()
        }
    } else {
        $dataRoot = Join-Path $workspace 'data'
    }
}
$env:RAINFALL_DATA_ROOT = [IO.Path]::GetFullPath($dataRoot)
$env:RAINFALL_MODE = 'production'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Write-Host "Rainfall data: $env:RAINFALL_DATA_ROOT"
Write-Host 'Keep this window open while using Rainfall Studio.'
$process = Start-Process -FilePath $electron -ArgumentList @(('"{0}"' -f $snapshot), '--rainfall-browser', '--rainfall-browser-fresh') `
    -WorkingDirectory $snapshot -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -eq 73) {
    throw '作品库正在被另一个 Rainfall Studio 实例使用。请从客户端或右下角托盘选择「退出应用」，然后再双击此 BAT。'
}
if ($process.ExitCode -ne 0) {
    throw 'Rainfall Studio failed to start. If the desktop app is using the same library, close it normally before trying again.'
}
