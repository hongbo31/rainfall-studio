param([string]$SourceRoot)
$ErrorActionPreference = 'Stop'
if (-not $SourceRoot) { throw 'Pass -SourceRoot with a read-only material collection directory.' }
$SourceRoot = (Resolve-Path -LiteralPath $SourceRoot).Path
if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) { throw 'Material collection directory required.' }
$acceptanceRoot = Join-Path ([IO.Path]::GetTempPath()) ('rainfall-offline-acceptance-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $acceptanceRoot | Out-Null
Set-Content -LiteralPath (Join-Path $acceptanceRoot 'offline-acceptance.marker') -Value 'isolated fixture only'
$env:RAINFALL_DATA_ROOT = $acceptanceRoot
$env:RAINFALL_MODE = 'production'
$env:RAINFALL_OFFLINE_ACCEPTANCE = '1'
$env:RAINFALL_ACCEPTANCE_SOURCE_ROOT = $SourceRoot
$candidateExe = Join-Path $PSScriptRoot 'RainfallStudioCandidate.exe'
$env:ELECTRON_RUN_AS_NODE = '1'
try {
  & $candidateExe (Join-Path $PSScriptRoot 'resources/app/scripts/seed-material-electron-acceptance.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'Offline fixture setup failed; client was not launched.' }
} finally { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
Write-Host "Offline fixture root: $acceptanceRoot"
& $candidateExe
