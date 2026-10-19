param([switch]$OpenBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$nodePath = (Get-Command node.exe).Source
$ready = $false
try { $response = Invoke-WebRequest 'http://127.0.0.1:4173' -UseBasicParsing -TimeoutSec 2; $ready = $response.Content -match 'Rainfall' } catch {}
if (-not $ready) {
 Start-Process -FilePath $nodePath -ArgumentList ('"' + (Join-Path $projectRoot 'server.mjs') + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'output\server.log') -RedirectStandardError (Join-Path $projectRoot 'output\server-error.log')
}
Write-Host 'Rainfall local WEB PROTOTYPE: http://127.0.0.1:4173'
if ($OpenBrowser) { Start-Process 'http://127.0.0.1:4173' }
