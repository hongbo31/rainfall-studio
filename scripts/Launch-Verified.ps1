param([switch]$ValidateOnly)
if($PSVersionTable.PSVersion.Major -ne 7){throw 'PowerShell 7 required'}
$ErrorActionPreference='Stop'
try {
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'verified-desktop.json') -Raw -Encoding utf8|ConvertFrom-Json
if($manifest.format -ne 1 -or $manifest.validation -ne 'accepted' -or $manifest.sourceCommit -notmatch '^[a-f0-9]{40}$'){throw 'VERIFIED_DELIVERY_REQUIRED'}
foreach($name in @('executable','dataRoot','packageRoot')){if(-not [IO.Path]::IsPathRooted($manifest.$name)){throw 'ABSOLUTE_PATH_REQUIRED'}}
if((Split-Path $manifest.executable -Parent) -ne $manifest.packageRoot){throw 'PACKAGE_ROOT_MISMATCH'}
foreach($file in $manifest.integrity){
 $target=[IO.Path]::GetFullPath((Join-Path $manifest.packageRoot $file.path))
 if(-not $target.StartsWith($manifest.packageRoot.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'INTEGRITY_PATH_REJECTED'}
 if(-not (Test-Path -LiteralPath $target -PathType Leaf) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256){throw 'VERIFIED_PACKAGE_CHANGED'}
}
$database=Join-Path $manifest.dataRoot 'production/library.sqlite'
if(-not (Test-Path -LiteralPath $database -PathType Leaf)){throw 'EXISTING_LIBRARY_REQUIRED'}
$stream=[IO.File]::Open($database,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
try{$header=[byte[]]::new(100);if($stream.Read($header,0,100) -ne 100 -or [Text.Encoding]::ASCII.GetString($header,0,16) -ne "SQLite format 3`0"){throw 'LIBRARY_HEADER_INVALID'};$schema=([int]$header[60] -shl 24) -bor ([int]$header[61] -shl 16) -bor ([int]$header[62] -shl 8) -bor [int]$header[63];if($schema -ne $manifest.schema){throw 'LIBRARY_SCHEMA_MISMATCH'}}finally{$stream.Dispose()}
if($ValidateOnly){@{validated=$true;sourceCommit=$manifest.sourceCommit;executable=$manifest.executable;dataRoot=$manifest.dataRoot}|ConvertTo-Json;exit 0}
function Start-VerifiedClient([switch]$ActivationOnly){
 $beforeRoot=$env:RAINFALL_DATA_ROOT;$beforeMode=$env:RAINFALL_MODE;$beforeNode=$env:ELECTRON_RUN_AS_NODE
 try{
  $env:RAINFALL_DATA_ROOT=$manifest.dataRoot;$env:RAINFALL_MODE='production';Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  $windowStyle=if($ActivationOnly){'Hidden'}else{'Normal'}
  Start-Process -FilePath $manifest.executable -WorkingDirectory $manifest.packageRoot -WindowStyle $windowStyle -PassThru
 }finally{$env:RAINFALL_DATA_ROOT=$beforeRoot;$env:RAINFALL_MODE=$beforeMode;$env:ELECTRON_RUN_AS_NODE=$beforeNode}
}
$main=@(Get-Process -Name RainfallStudioCandidate,RainfallStudio -ErrorAction SilentlyContinue|Where-Object {$_.MainWindowHandle -ne 0})
$existing=$null
$previousFile=Join-Path $PSScriptRoot 'last-verified-launch.json'
if(Test-Path -LiteralPath $previousFile){
 $previous=Get-Content -LiteralPath $previousFile -Raw|ConvertFrom-Json
 $recorded=Get-Process -Id $previous.pid -ErrorAction SilentlyContinue
 if($recorded -and $previous.dataRoot -eq $manifest.dataRoot -and
    $recorded.StartTime.ToUniversalTime().ToString('o') -eq ([DateTime]$previous.processStartedAt).ToUniversalTime().ToString('o')){
  if($recorded.Path -ne $manifest.executable){throw 'SAVE_AND_CLOSE_EXISTING_RAINFALL_FIRST'}
  $existing=$recorded
 }
}
if($main.Count -gt 1 -or ($main.Count -eq 1 -and $main[0].Id -ne $existing.Id)){throw 'SAVE_AND_CLOSE_EXISTING_RAINFALL_FIRST'}
if($existing){
 Add-Type @'
using System;using System.Runtime.InteropServices;public static class VerifiedRainfallWindow{[DllImport("user32.dll")]public static extern bool ShowWindowAsync(IntPtr window,int command);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr window);}
'@
 $window=$existing.MainWindowHandle
 if($window -eq [IntPtr]::Zero){
  # Electron's single-instance event can reveal a hidden window even when its handle is unavailable.
  $null=Start-VerifiedClient -ActivationOnly
  $until=[DateTime]::UtcNow.AddSeconds(8)
  do{
   Start-Sleep -Milliseconds 200
   $existing.Refresh()
   if($existing.HasExited){throw 'VERIFIED_WINDOW_NOT_READY'}
   $window=$existing.MainWindowHandle
  }while($window -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $until)
 }
 if($window -eq [IntPtr]::Zero){throw 'VERIFIED_WINDOW_NOT_READY'}
 $null=[VerifiedRainfallWindow]::ShowWindowAsync($window,9)
 $null=[VerifiedRainfallWindow]::SetForegroundWindow($window)
 @{at=[DateTime]::UtcNow.ToString('o');action='reused-existing-verified-window';pid=$existing.Id;dataRoot=$manifest.dataRoot;sourceCommit=$manifest.sourceCommit}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'last-verified-invocation.json') -Encoding utf8
 exit 0
}
$process=Start-VerifiedClient
$record=@{pid=$process.Id;startedAt=[DateTime]::UtcNow.ToString('o');processStartedAt=$process.StartTime.ToUniversalTime().ToString('o');sourceCommit=$manifest.sourceCommit;exe=$manifest.executable;dataRoot=$manifest.dataRoot;mode='production';desktopDelivery=$true}
$record|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'last-verified-launch.json') -Encoding utf8
} catch {
 $code=if($_.Exception.Message -match '^[A-Z0-9_]+$'){$_.Exception.Message}else{'LAUNCH_FAILED'}
 if($ValidateOnly){Write-Output $code;exit 1}
 @{at=[DateTime]::UtcNow.ToString('o');code=$code}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'last-verified-launch-error.json') -Encoding utf8
 Add-Type @'
using System;using System.Runtime.InteropServices;public static class VerifiedRainfallError{[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int MessageBoxW(IntPtr owner,string text,string title,uint type);}
'@
 $null=[VerifiedRainfallError]::MessageBoxW([IntPtr]::Zero,"客户端未启动，现有数据已保留。若另有旧窗口，请保存并退出后重试。`n错误："+$code,'Rainfall Studio',0)
 exit 1
}
