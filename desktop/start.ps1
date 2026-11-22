param([switch]$OpenBrowser, [switch]$BuildOnly)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot '../scripts/Start-Rainfall-Browser.ps1') -BuildOnly:$BuildOnly
