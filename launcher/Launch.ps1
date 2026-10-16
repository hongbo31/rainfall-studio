param([string]$Manager=$PSScriptRoot,[switch]$Previous,[switch]$ValidateOnly)
$ErrorActionPreference='Stop'
function Read-JsonFile([string]$File) { Get-Content -LiteralPath $File -Raw -Encoding UTF8 | ConvertFrom-Json }
function Hash-File([string]$File) { $stream=[IO.File]::OpenRead($File);$sha=[Security.Cryptography.SHA256]::Create();try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant() } finally { $stream.Dispose();$sha.Dispose() } }
function Assert-True($Condition,[string]$Code) { if (-not $Condition) { throw $Code } }
function Plain-Path([string]$Path) {
  $current=[IO.Path]::GetFullPath($Path)
  while ($current) {
    if (Test-Path -LiteralPath $current) { Assert-True (-not ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'LINK_REJECTED' }
    $parent=[IO.Directory]::GetParent($current)
    if ($null -eq $parent) { break };$current=$parent.FullName
  }
}
function Verified-Database($Record) {
  Plain-Path $Record.dataRoot
  $file=Join-Path $Record.dataRoot 'production/library.sqlite';Plain-Path $file
  Assert-True (Test-Path -LiteralPath $file -PathType Leaf) 'DATA_DATABASE_MISSING'
  $stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
  try {
    $bytes=New-Object byte[] 100;$count=$stream.Read($bytes,0,100)
    Assert-True ($count -eq 100 -and [Text.Encoding]::ASCII.GetString($bytes,0,16) -eq "SQLite format 3`0") 'DATA_DATABASE_HEADER'
    $schema=([uint32]$bytes[60] -shl 24) -bor ([uint32]$bytes[61] -shl 16) -bor ([uint32]$bytes[62] -shl 8) -bor [uint32]$bytes[63]
    Assert-True ($schema -eq $Record.schema) 'DATA_SCHEMA_INCOMPATIBLE'
  } finally { $stream.Dispose() }
}
function Get-RegularFiles([string]$Root) {
  Assert-True (-not ((Get-Item -LiteralPath $Root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'LINK_REJECTED'
  foreach ($entry in Get-ChildItem -LiteralPath $Root -Force) {
    Assert-True (-not ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'LINK_REJECTED'
    if ($entry.PSIsContainer) { Get-RegularFiles $entry.FullName } else { $entry }
  }
}
function Verified-Record($Record) {
  Assert-True ($Record.releaseId -match '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$') 'RELEASE_ID'
  $catalogFile=Join-Path (Join-Path $Manager 'catalogs') ($Record.releaseId+'.json')
  Assert-True ($catalogFile -eq $Record.catalogFile) 'CATALOG_LOCATION'
  Assert-True ((Hash-File $catalogFile) -eq $Record.catalogHash) 'CATALOG_HASH'
  $catalog=Read-JsonFile $catalogFile
  Assert-True ($catalog.format -eq 1 -and $catalog.id -eq $Record.releaseId -and $catalog.exe -eq 'RainfallStudio.exe') 'CATALOG_INVALID'
  Assert-True (@($catalog.schemas) -contains $Record.schema) 'DATA_SCHEMA_INCOMPATIBLE'
  Assert-True ([IO.Path]::IsPathRooted($Record.dataRoot) -and (Test-Path -LiteralPath $Record.dataRoot -PathType Container)) 'DATA_ROOT_MISSING'
  Verified-Database $Record
  $root=[IO.Path]::GetFullPath($catalog.root).TrimEnd('\','/')
  Plain-Path $root
  $files=@(Get-RegularFiles $root)
  Assert-True ($files.Count -eq @($catalog.files).Count) 'INTEGRITY_FILE_COUNT'
  $seen=@{}
  foreach ($f in $catalog.files) {
    Assert-True ($f.path -and $f.path -notmatch '\\|:|(^/)|(^|/)\.\.?(/|$)|//' -and $f.sha256 -match '^[a-f0-9]{64}$' -and -not $seen.ContainsKey($f.path)) 'CATALOG_PATH'
    $seen[$f.path]=$true
    $file=Join-Path $root ($f.path -replace '/','\')
    Assert-True ((Test-Path -LiteralPath $file -PathType Leaf) -and (Get-Item -LiteralPath $file).Length -eq $f.size) 'INTEGRITY_FILE'
    Assert-True ((Hash-File $file) -eq $f.sha256) 'INTEGRITY_HASH'
  }
  Assert-True ($seen.ContainsKey('RainfallStudio.exe') -and $seen.ContainsKey('resources/app.asar')) 'INTEGRITY_REQUIRED_FILES'
  return @{releaseId=$Record.releaseId;exe=(Join-Path $root $catalog.exe);dataRoot=$Record.dataRoot;schema=$Record.schema;mode='production';packageRoot=$root}
}
$lock=$null;$lockFile=Join-Path $Manager 'upgrade.lock'
try {
  Plain-Path $Manager
  if (-not $ValidateOnly -and -not $Previous -and (Test-Path -LiteralPath (Join-Path $Manager 'pending.json'))) {
    $config=Read-JsonFile (Join-Path $Manager 'delivery-config.json')
    Assert-True ((Hash-File $config.nodeExecutable) -eq $config.nodeHash) 'DELIVERY_RUNTIME_CHANGED'
    & $config.nodeExecutable (Join-Path $Manager 'scripts/deliver-local-release.mjs') --manager $Manager --apply-pending
    if ($LASTEXITCODE -ne 0) {
      Add-Type -AssemblyName PresentationFramework
      [Windows.MessageBox]::Show('更新尚未应用，将保留当前版本和数据。详细原因见本机交付记录。','Rainfall Studio') | Out-Null
    }
  }
  try { $lock=[IO.File]::Open($lockFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) } catch { throw 'UPGRADE_BUSY' }
  $state=Read-JsonFile (Join-Path $Manager 'current.json')
  $record=$state.current
  if ($Previous) { Assert-True ($null -ne $state.previous) 'NO_PREVIOUS_RELEASE';$record=$state.previous }
  $launch=Verified-Record $record
  if ($ValidateOnly) { $launch | ConvertTo-Json -Compress;exit 0 }
  if (@(Get-Process -Name RainfallStudio -ErrorAction SilentlyContinue).Count -gt 0) {
    Add-Type -AssemblyName PresentationFramework
    [Windows.MessageBox]::Show('客户端正在运行，请使用现有窗口。待完全退出后再次打开入口即可应用排队新版。','Rainfall Studio') | Out-Null
    exit 0
  }
  if ($Previous) {
    Add-Type -AssemblyName PresentationFramework
    $answer=[Windows.MessageBox]::Show('将打开保留的旧版与其旧数据。升级后的新作品仍保留在新版数据目录，不会自动合并。是否继续？','Rainfall Studio 回退','YesNo')
    if ($answer -ne 'Yes') { exit 0 }
  }
  $beforeRoot=$env:RAINFALL_DATA_ROOT;$beforeMode=$env:RAINFALL_MODE;$beforeNode=$env:ELECTRON_RUN_AS_NODE
  try {
    $env:RAINFALL_DATA_ROOT=$launch.dataRoot;$env:RAINFALL_MODE='production';Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    $process=Start-Process -FilePath $launch.exe -WorkingDirectory $launch.packageRoot -WindowStyle Normal -PassThru
    $launch.pid=$process.Id;$launch.startedAt=[DateTime]::UtcNow.ToString('o')
    $launch | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Manager 'last-launch.json') -Encoding UTF8
  } finally { $env:RAINFALL_DATA_ROOT=$beforeRoot;$env:RAINFALL_MODE=$beforeMode;$env:ELECTRON_RUN_AS_NODE=$beforeNode }
} catch {
  $message=$_.Exception.Message
  if ($ValidateOnly) { Write-Output $message } else { Add-Type -AssemblyName PresentationFramework;[Windows.MessageBox]::Show(('未启动或切换客户端，原数据已保留。'+[Environment]::NewLine+$message),'Rainfall Studio') | Out-Null }
  exit 1
} finally { if ($null -ne $lock) { $lock.Dispose();Remove-Item -LiteralPath $lockFile -Force } }
