#Requires -Version 7.0
param([Parameter(Mandatory=$true)][string]$RequestFile)
$ErrorActionPreference='Stop'
$r=Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
$wsh=New-Object -ComObject WScript.Shell
$link=$wsh.CreateShortcut($r.temporary)
$link.TargetPath=$r.target
$link.Arguments=$r.arguments
$link.WorkingDirectory=$r.workingDirectory
$link.IconLocation=$r.icon
$link.Description='Rainfall Studio — 本机已验收版本入口'
$link.WindowStyle=7
$link.Save()
$check=$wsh.CreateShortcut($r.temporary)
if ($check.TargetPath -ne $r.target -or $check.Arguments -ne $r.arguments) { throw 'SHORTCUT_VALIDATION_FAILED' }
@{target=$check.TargetPath;arguments=$check.Arguments;workingDirectory=$check.WorkingDirectory} | ConvertTo-Json -Compress
