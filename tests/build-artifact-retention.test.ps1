#Requires -Version 7.0
param([Parameter(Mandatory)][string]$WorkspaceRoot)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/Build-ArtifactRetention.ps1')

function Assert-That($Condition, [string]$Message) {
  if (!$Condition) { throw $Message }
}

$parent = Get-RainfallAbsolutePath $WorkspaceRoot
Assert-RainfallPhysicalPath $parent
[void][IO.Directory]::CreateDirectory($parent)
$root = Join-Path $parent ('retention-test-' + [guid]::NewGuid().ToString('N'))
$out = Join-Path $root 'out'
$runs = Join-Path $root 'runs'
$records = Join-Path $root 'records'
$cache = Join-Path $root 'cache'
$downloads = Join-Path $cache 'downloads'
$npmCache = Join-Path $cache 'npm/_cacache'
$electronCache = Join-Path $cache 'electron'
$outside = Join-Path $root 'unmanaged-library'
$junction = $null
foreach ($dir in @($out, $runs, $records, $outside, $downloads, $npmCache, $electronCache)) { [void][IO.Directory]::CreateDirectory($dir) }

function Add-TestArchive([string]$Id, [string]$Commit, [string]$Lane = 'main') {
  $name = "RainfallStudio-0.12.0-preview.12-$($Commit.Substring(0, 12))-win-x64-$($Id.Substring(4)).zip"
  $file = Join-Path $out $name
  Set-Content -LiteralPath $file -Value "Fixture $Id"
  $sha = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  Set-Content -LiteralPath "$file.sha256" -Value "$sha  $name"
  $record = [pscustomobject]@{
    kind = 'rainfall-studio-verified-build'; id = $Id; lane = $Lane; outputDirectory = $out
    archiveName = $name; sourceCommit = $Commit; sha256 = $sha
  }
  $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $records "$Id.json")
  $record
}

function Add-TestRun([string]$Id, [int]$OwnerPid, [long]$StartTicks) {
  $dir = Join-Path $runs $Id
  [void][IO.Directory]::CreateDirectory((Join-Path $dir 'verification-data'))
  [void][IO.Directory]::CreateDirectory((Join-Path $dir 'extracted'))
  @{ kind = 'rainfall-studio-build-run'; id = $Id; pid = $OwnerPid; processStartTicks = $StartTicks } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dir 'rainfall-build-run.json')
  Set-Content -LiteralPath (Join-Path $dir 'verification-data/library.sqlite') -Value 'test data'
  Set-Content -LiteralPath (Join-Path $dir 'verification.log') -Value 'test log'
  $dir
}

try {
  $old = Add-TestArchive 'rsb-11111111' ('1' * 40)
  $rollback = Add-TestArchive 'rsb-22222222' ('2' * 40)
  $local = Add-TestArchive 'rsb-33333333' ('3' * 40) 'local'
  $edited = Add-TestArchive 'rsb-44444444' ('4' * 40)
  $fresh = Add-TestArchive 'rsb-55555555' ('5' * 40)
  Set-Content -LiteralPath (Join-Path $out $edited.archiveName) -Value 'changed outside the build tool'
  $unregistered = Join-Path $out 'RainfallStudio-0.12.0-preview.12-abcdef012345-win-x64.zip'
  Set-Content -LiteralPath $unregistered -Value 'owned by someone else'
  $cacheZip = Join-Path $downloads 'node-v24.14.0-win-x64.zip'
  $partialZip = Join-Path $downloads 'node-v24.14.0-win-x64.zip.partial-11111111'
  $unownedCache = Join-Path $downloads 'personal.zip'
  $cacheEntry = Join-Path $npmCache 'content'
  $protectedCache = Join-Path $electronCache 'in-use'
  foreach ($file in @($cacheZip, $partialZip, $unownedCache, $cacheEntry, $protectedCache)) {
    Set-Content -LiteralPath $file -Value 'fixture'
  }
  $expectedCacheBytes = (Get-Item -LiteralPath $cacheZip, $partialZip, $cacheEntry | Measure-Object Length -Sum).Sum

  $oldRun = Add-TestRun 'rsb-aaaaaaaa' ([int]::MaxValue) 1
  $activeRun = Add-TestRun 'rsb-bbbbbbbb' $PID (Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks
  $protectedRun = Add-TestRun 'rsb-cccccccc' ([int]::MaxValue) 1
  $linkedRun = Add-TestRun 'rsb-dddddddd' ([int]::MaxValue) 1
  $unownedRun = Join-Path $runs 'rsb-eeeeeeee'
  $processRun = Add-TestRun 'rsb-ffffffff' ([int]::MaxValue) 1
  [void][IO.Directory]::CreateDirectory($unownedRun)
  $junction = Join-Path $linkedRun 'link'
  New-Item -ItemType Junction -Path $junction -Target $outside | Out-Null
  $data = Join-Path $outside 'library.sqlite'
  Set-Content -LiteralPath $data -Value 'library outside the run'
  $commits = [Collections.Generic.HashSet[string]]::new()
  [void]$commits.Add($rollback.sourceCommit)
  $protection = @{
    Paths = @((Join-Path $protectedRun 'verification-data'), $outside)
    Commits = $commits
    Processes = @([pscustomobject]@{ ExecutablePath = 'C:\Program Files\Browser\browser.exe'; CommandLine = "browser --user-data-dir=$processRun $protectedCache" })
  }

  $freshPath = Join-Path $out $fresh.archiveName
  $sidecar = Get-Content -LiteralPath "$freshPath.sha256" -Raw
  Set-Content -LiteralPath "$freshPath.sha256" -Value 'broken verification'
  $refused = $false
  try { Remove-RainfallSupersededBuilds $records $runs $fresh $protection -CacheRoot $cache | Out-Null }
  catch { $refused = $true }
  Assert-That $refused 'Cleanup accepted a failed verification'
  Assert-That (Test-Path -LiteralPath (Join-Path $out $old.archiveName)) 'Failure removed the last usable package'
  Assert-That (Test-Path -LiteralPath $oldRun) 'Failure removed a historical run'
  Assert-That (Test-Path -LiteralPath $cacheZip) 'Failure removed the download cache'
  Assert-That (Test-Path -LiteralPath $cacheEntry) 'Failure removed the dependency cache'
  Set-Content -LiteralPath "$freshPath.sha256" -Value $sidecar -NoNewline

  $result = Remove-RainfallSupersededBuilds $records $runs $fresh $protection -CacheRoot $cache
  Assert-That ($result.Archives -eq 1 -and $result.Runs -eq 1) 'Unexpected cleanup scope'
  Assert-That (!(Test-Path -LiteralPath (Join-Path $out $old.archiveName))) 'Old archive still exists'
  Assert-That (!(Test-Path -LiteralPath (Join-Path $out "$($old.archiveName).sha256"))) 'Old checksum still exists'
  Assert-That (!(Test-Path -LiteralPath $oldRun)) 'Historical test data, log or extraction still exists'
  Assert-That ($result.CacheBytes -eq $expectedCacheBytes) 'Unexpected cache cleanup scope'
  foreach ($path in @($cacheZip, $partialZip, $npmCache)) {
    Assert-That (!(Test-Path -LiteralPath $path)) "Managed cache still exists: $path"
  }
  foreach ($path in @($freshPath, (Join-Path $out $rollback.archiveName), (Join-Path $out $local.archiveName),
      (Join-Path $out $edited.archiveName), $unregistered, $activeRun, $protectedRun, $linkedRun, $unownedRun, $processRun, $data,
      $unownedCache, $protectedCache)) {
    Assert-That (Test-Path -LiteralPath $path) "Protected or unrelated path was removed: $path"
  }
  Write-Output 'PASS: verified replacement, failed verification, rollback, active run, cache cleanup, links and unowned paths'
} finally {
  if ($junction -and (Test-Path -LiteralPath $junction)) {
    $item = Get-Item -LiteralPath $junction -Force
    if ($item.FullName -eq $junction -and $item.LinkType -eq 'Junction') { Remove-Item -LiteralPath $junction -Force }
  }
  $item = Get-RainfallArtifactChild $parent $root
  Get-RainfallArtifactFiles $item | Out-Null
  Remove-Item -LiteralPath $item.FullName -Recurse -Force
}
