function Get-RainfallAbsolutePath([string]$Path) {
  [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($Path))
}

function Assert-RainfallPhysicalPath([string]$Path) {
  for ($part = Get-RainfallAbsolutePath $Path; $part; $part = Split-Path -Path $part -Parent) {
    $item = Get-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
    if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw "构建路径含链接或重解析点：$part"
    }
  }
}

function Get-RainfallArtifactChild([string]$Root, [string]$Path) {
  $rootPath = Get-RainfallAbsolutePath $Root
  $target = Get-RainfallAbsolutePath $Path
  if ((Split-Path -Path $target -Parent) -ne $rootPath) {
    throw "产物不在指定管理目录内：$target"
  }
  Assert-RainfallPhysicalPath $target
  Get-Item -LiteralPath $target -Force
}

function Test-RainfallPathOverlap([string]$First, [string]$Second) {
  $a = Get-RainfallAbsolutePath $First
  $b = Get-RainfallAbsolutePath $Second
  $a -eq $b -or
    $a.StartsWith($b.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $b.StartsWith($a.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Get-RainfallArtifactProtection([string]$LauncherRoot = (Join-Path $env:LOCALAPPDATA 'RainfallStudioLauncher')) {
  $paths = [Collections.Generic.List[string]]::new()
  $commits = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $processes = Get-CimInstance -ClassName Win32_Process -ErrorAction Stop |
    Select-Object ProcessId, ExecutablePath, CommandLine
  $pointer = Join-Path $LauncherRoot 'verified-desktop.json'
  $references = @()
  if (Test-Path -LiteralPath $pointer) {
    $current = Get-Content -LiteralPath $pointer -Raw | ConvertFrom-Json
    if ($current.validation -ne 'accepted' -or !$current.packageRoot -or !$current.dataRoot) {
      throw '无法识别当前桌面交付记录，跳过历史清理。'
    }
    $references += $current
    if ($current.backupRoot) {
      foreach ($name in @('previous-pointer.json', 'verified-desktop.json')) {
        $file = Join-Path $current.backupRoot $name
        if (Test-Path -LiteralPath $file -PathType Leaf) {
          $references += Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
        }
      }
    }
  }
  $legacy = Join-Path $LauncherRoot 'current.json'
  if (Test-Path -LiteralPath $legacy -PathType Leaf) {
    $delivery = Get-Content -LiteralPath $legacy -Raw | ConvertFrom-Json
    $references += @($delivery.current, $delivery.previous) | Where-Object { $_ }
  }
  $previous = Join-Path $LauncherRoot 'previous-desktop.json'
  if (Test-Path -LiteralPath $previous -PathType Leaf) {
    $references += Get-Content -LiteralPath $previous -Raw | ConvertFrom-Json
  }
  foreach ($name in @('last-verified-launch.json', 'last-launch.json')) {
    $file = Join-Path $LauncherRoot $name
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { continue }
    $launch = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    if ($processes | Where-Object {
      $_.ProcessId -eq $launch.pid -and (!$_.ExecutablePath -or $_.ExecutablePath -eq $launch.exe)
    }) { $references += $launch }
  }
  foreach ($reference in $references) {
    foreach ($value in @($reference.packageRoot, $reference.executable, $reference.exe, $reference.dataRoot,
        $reference.backupRoot, $reference.backupPath)) {
      if (!$value) { continue }
      if (![IO.Path]::IsPathFullyQualified($value)) { throw '交付记录中存在无法确认的路径。' }
      $paths.Add((Get-RainfallAbsolutePath $value))
    }
    if ($reference.sourceCommit -match '^[0-9a-f]{40}$') { [void]$commits.Add($reference.sourceCommit) }
  }
  [pscustomobject]@{ Paths = $paths; Commits = $commits; Processes = @($processes) }
}

function Test-RainfallArtifactProtected([string]$Path, $Protection) {
  if ($Path -match '(?i)(^|[\\/])2026-10-15([\\/]|$)') { return $true }
  foreach ($protected in $Protection.Paths) {
    if (Test-RainfallPathOverlap $Path $protected) { return $true }
  }
  foreach ($process in $Protection.Processes) {
    if (($process.ExecutablePath -and [IO.Path]::IsPathFullyQualified($process.ExecutablePath) -and
        (Test-RainfallPathOverlap $Path $process.ExecutablePath)) -or
        ($process.CommandLine -and $process.CommandLine.Contains($Path, [StringComparison]::OrdinalIgnoreCase))) {
      return $true
    }
  }
  $false
}

function Get-RainfallArtifactFiles([IO.DirectoryInfo]$Directory) {
  $pending = [Collections.Generic.Stack[IO.DirectoryInfo]]::new()
  $pending.Push($Directory)
  while ($pending.Count) {
    foreach ($item in $pending.Pop().EnumerateFileSystemInfos()) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "产物内含链接，保留该目录：$($Directory.FullName)"
      }
      if ($item -is [IO.DirectoryInfo]) { $pending.Push($item) } else { $item }
    }
  }
}

function Read-RainfallRunOwner([string]$RunsRoot, [string]$Path) {
  $directory = Get-RainfallArtifactChild $RunsRoot $Path
  if (!$directory.PSIsContainer -or $directory.Name -notmatch '^rsb-[0-9a-f]{8}$') { return }
  $marker = Join-Path $directory.FullName 'rainfall-build-run.json'
  if (!(Test-Path -LiteralPath $marker -PathType Leaf)) { return }
  $null = Get-RainfallArtifactChild $directory.FullName $marker
  $owner = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
  if ($owner.kind -eq 'rainfall-studio-build-run' -and $owner.id -eq $directory.Name -and
      $owner.pid -gt 0 -and $owner.processStartTicks -gt 0) { $owner }
}

function Remove-RainfallBuildRun([string]$RunsRoot, [string]$Path, $Protection, [switch]$CurrentRun) {
  $owner = Read-RainfallRunOwner $RunsRoot $Path
  if (!$owner -or (Test-RainfallArtifactProtected $Path $Protection)) { return $false }
  $process = Get-Process -Id $owner.pid -ErrorAction SilentlyContinue
  if ($CurrentRun) {
    if ($owner.pid -ne $PID -or $process.StartTime.ToUniversalTime().Ticks -ne $owner.processStartTicks) { return $false }
  } elseif ($process -and (!$process.StartTime -or $process.StartTime.ToUniversalTime().Ticks -eq $owner.processStartTicks)) {
    return $false
  }
  $directory = Get-RainfallArtifactChild $RunsRoot $Path
  Get-RainfallArtifactFiles $directory | Out-Null
  $directory = Get-RainfallArtifactChild $RunsRoot $directory.FullName
  Remove-Item -LiteralPath $directory.FullName -Recurse -Force
  $true
}

function Get-RainfallArchiveSha([string]$Archive) {
  $sidecar = "$Archive.sha256"
  if (!(Test-Path -LiteralPath $sidecar -PathType Leaf)) { return }
  $null = Get-RainfallArtifactChild (Split-Path -Path $Archive -Parent) $sidecar
  $text = (Get-Content -LiteralPath $sidecar -Raw).TrimEnd()
  $filename = [regex]::Escape((Split-Path -Path $Archive -Leaf))
  if ($text -match "^([0-9a-fA-F]{64})  $filename$") { $Matches[1].ToLowerInvariant() }
}

function Read-RainfallArchiveEntry($Entry) {
  $reader = [IO.StreamReader]::new($Entry.Open())
  try { $reader.ReadToEnd() } finally { $reader.Dispose() }
}

function Assert-RainfallPortableArchive([string]$Archive, [string]$Commit) {
  $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    $files = [Collections.Generic.Dictionary[string,IO.Compression.ZipArchiveEntry]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $zip.Entries) {
      $name = $entry.FullName.Replace('\', '/').TrimEnd('/')
      if (!$name -or $name -match '(^|/)\.{1,2}(/|$)|^/|[:\x00-\x1f]|//') {
        throw "压缩包路径无效：$name"
      }
      if ($entry.Name) { $files.Add($name, $entry) }
    }
    $manifest = Read-RainfallArchiveEntry $files['portable-manifest.json'] | ConvertFrom-Json
    if ($manifest.format -ne 1 -or $manifest.kind -ne 'windows-x64-portable' -or
        !$manifest.sourceCommitIsExact -or $manifest.sourceCommit -ne $Commit -or
        $files.Count -ne @($manifest.files).Count + 2) { throw '压缩包清单与构建结果不符。' }
    $listed = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $manifest.files) {
      if (!$listed.Add($file.path) -or $file.sha256 -notmatch '^[0-9a-f]{64}$' -or
          !$files.ContainsKey($file.path)) { throw "压缩包缺少清单文件或存在重复项：$($file.path)" }
      $stream = $files[$file.path].Open()
      try {
        if ((Get-FileHash -InputStream $stream -Algorithm SHA256).Hash -ne $file.sha256) {
          throw "压缩包文件校验失败：$($file.path)"
        }
      } finally { $stream.Dispose() }
    }
    foreach ($required in @('RainfallStudio.exe', 'resources/app/package.json', 'resources/app/build/core.cjs',
        'resources/app/build/ui/index.html', 'resources/app/tools/media/ffmpeg.exe', 'resources/app/tools/media/ffprobe.exe')) {
      if (!$listed.Contains($required)) { throw "压缩包缺少必要文件：$required" }
    }
    if (!$files.ContainsKey('README.txt')) { throw '压缩包缺少使用说明。' }
    $manifest
  } finally { $zip.Dispose() }
}

function Remove-RainfallBuildCaches([string]$CacheRoot, [string]$OutputDirectory, $Protection) {
  Assert-RainfallPhysicalPath $CacheRoot
  $downloads = Join-Path $CacheRoot 'downloads'
  Assert-RainfallPhysicalPath $downloads
  $entries = @(
    if (Test-Path -LiteralPath $downloads -PathType Container) {
      Get-ChildItem -LiteralPath $downloads -File -Force |
        Where-Object Name -Match '^(node-v\d+\.\d+\.\d+-win-x64|electron-v\d+\.\d+\.\d+-win32-x64|ffmpeg-\d+(\.\d+)+-essentials_build)\.zip(\.partial-[0-9a-f]{8})?$' |
        ForEach-Object FullName
    }
    Join-Path $CacheRoot 'npm/_cacache'
    Join-Path $CacheRoot 'electron'
  )
  $bytes = 0L
  foreach ($entry in $entries) {
    try {
      if (!(Test-Path -LiteralPath $entry) -or
          (Test-RainfallPathOverlap $entry $OutputDirectory) -or
          (Test-RainfallArtifactProtected $entry $Protection)) { continue }
      $item = Get-RainfallArtifactChild (Split-Path -Parent $entry) $entry
      if ($item.PSIsContainer) {
        $size = (Get-RainfallArtifactFiles $item | Measure-Object -Property Length -Sum).Sum
        $item = Get-RainfallArtifactChild (Split-Path -Parent $entry) $entry
        Remove-Item -LiteralPath $item.FullName -Recurse -Force
      } else {
        $size = $item.Length
        Remove-Item -LiteralPath $item.FullName -Force
      }
      $bytes += [long]$size
    } catch { Write-Warning "保留无法安全清理的构建缓存 $entry。$($_.Exception.Message)" }
  }
  $bytes
}

function Remove-RainfallSupersededBuilds([string]$RecordsRoot, [string]$RunsRoot, $Verified, $Protection, [string]$CacheRoot) {
  if ($Verified.id -notmatch '^rsb-[0-9a-f]{8}$' -or
      $Verified.archiveName -notmatch '^RainfallStudio-[0-9A-Za-z.-]+-win-x64(?:-[0-9a-f]{8})?\.zip$') {
    throw '新包没有有效的交付记录。'
  }
  $receiptPath = Join-Path $RecordsRoot "$($Verified.id).json"
  $null = Get-RainfallArtifactChild $RecordsRoot $receiptPath
  $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  $currentArchive = Join-Path $Verified.outputDirectory $Verified.archiveName
  $null = Get-RainfallArtifactChild $Verified.outputDirectory $currentArchive
  if ($receipt.kind -ne 'rainfall-studio-verified-build' -or $receipt.id -ne $Verified.id -or
      $receipt.archiveName -ne $Verified.archiveName -or $receipt.sourceCommit -ne $Verified.sourceCommit -or
      $receipt.outputDirectory -ne $Verified.outputDirectory -or $receipt.lane -ne $Verified.lane -or
      $receipt.sha256 -ne $Verified.sha256 -or (Get-RainfallArchiveSha $currentArchive) -ne $Verified.sha256 -or
      (Get-FileHash -LiteralPath $currentArchive -Algorithm SHA256).Hash -ne $Verified.sha256) {
    throw '新包校验记录不完整，保留现有历史产物。'
  }
  $archives = 0
  $runs = 0
  $keptCommits = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  [void]$keptCommits.Add($Verified.sourceCommit)
  $records = Get-ChildItem -LiteralPath $RecordsRoot -File -Filter 'rsb-*.json' |
    Sort-Object LastWriteTimeUtc -Descending
  foreach ($record in $records) {
    try {
      $record = Get-RainfallArtifactChild $RecordsRoot $record.FullName
      $old = Get-Content -LiteralPath $record.FullName -Raw | ConvertFrom-Json
      if ($old.kind -ne 'rainfall-studio-verified-build' -or $record.BaseName -ne $old.id -or
          $old.id -notmatch '^rsb-[0-9a-f]{8}$' -or $old.id -eq $Verified.id -or
          $old.lane -ne $Verified.lane -or $old.outputDirectory -ne $Verified.outputDirectory -or
          $old.sourceCommit -notmatch '^[0-9a-f]{40}$' -or $old.sha256 -notmatch '^[0-9a-f]{64}$' -or
          $old.archiveName -notmatch '^RainfallStudio-[0-9A-Za-z.-]+-win-x64(?:-[0-9a-f]{8})?\.zip$' -or
          $old.archiveName -eq $Verified.archiveName) { continue }
      $archive = Join-Path $Verified.outputDirectory $old.archiveName
      if (!(Test-Path -LiteralPath $archive -PathType Leaf)) { continue }
      $item = Get-RainfallArtifactChild $Verified.outputDirectory $archive
      if ((Test-RainfallArtifactProtected $item.FullName $Protection) -or
          (Test-RainfallArtifactProtected "$($item.FullName).sha256" $Protection)) { continue }
      if ((Get-RainfallArchiveSha $item.FullName) -ne $old.sha256 -or
          (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash -ne $old.sha256) { continue }
      if ($Protection.Commits.Contains($old.sourceCommit) -and $keptCommits.Add($old.sourceCommit)) { continue }
      Remove-Item -LiteralPath $item.FullName -Force
      Remove-Item -LiteralPath "$($item.FullName).sha256" -Force
      Remove-Item -LiteralPath $record.FullName -Force
      $archives++
    } catch { Write-Warning "保留无法安全清理的构建记录 $($record.Name)。$($_.Exception.Message)" }
  }
  foreach ($run in Get-ChildItem -LiteralPath $RunsRoot -Directory -Filter 'rsb-*') {
    if ($run.Name -eq $Verified.id) { continue }
    try { if (Remove-RainfallBuildRun $RunsRoot $run.FullName $Protection) { $runs++ } }
    catch { Write-Warning "保留无法安全清理的验证目录 $($run.Name)。$($_.Exception.Message)" }
  }
  $cacheBytes = if ($CacheRoot) { Remove-RainfallBuildCaches $CacheRoot $Verified.outputDirectory $Protection } else { 0L }
  [pscustomobject]@{ Archives = $archives; Runs = $runs; CacheBytes = $cacheBytes }
}
