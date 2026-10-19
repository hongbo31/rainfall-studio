param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
# Two-argument File.Move fails if Destination exists; it never replaces a sync arrival.
try{[System.IO.File]::Move($Source,$Destination)}catch [System.IO.IOException]{if(Test-Path -LiteralPath $Destination){exit 73};throw}
