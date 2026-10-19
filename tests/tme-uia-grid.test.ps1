if($PSVersionTable.PSVersion.Major -ne 7){throw 'PS7_REQUIRED'}
$ErrorActionPreference='Stop'
. "$PSScriptRoot/../src/main/tme/uia-grid.ps1"
$stamp=Get-TmeProcessStamp ([datetime]::UtcNow)
$roundtrip=(@{started=$stamp}|ConvertTo-Json -Compress)|ConvertFrom-Json
if($stamp -cne $roundtrip.started){throw 'PROCESS_STAMP_JSON_ROUNDTRIP_CHANGED'}
$cells=@(@{RowKey='header';Column=0;Name='#'},@{RowKey='header';Column=1;Name='歌曲名'},@{RowKey='primary:1';Column=0;Name='2'},@{RowKey='primary:1';Column=1;Name='原创测试'},@{RowKey='primary:1';Column=3;Name='审核中'},@{RowKey='fixed:1';Column=0;Name=''},@{RowKey='fixed:1';Column=1;Name=''},@{RowKey='fixed:1';Column=7;Name='详情 编辑 删除'})
$rows=@(Convert-TmeGrid $cells)
if($rows.Count -ne 1 -or $rows[0].title -ne '原创测试' -or $rows[0].status -ne 'reviewing' -or $null -ne $rows[0].songId){throw 'GRID_PARSE_FAILED'}
'Grid primary/fixed/header separation: PASS'
$result=(@{action='stage';binding=@{account='forged'}}|ConvertTo-Json -Compress)|& (Get-Command pwsh).Source -NoLogo -NoProfile -NonInteractive -File "$PSScriptRoot/../src/main/tme/uia-host.ps1"
$gate=$result|ConvertFrom-Json
if($gate.ok -or $gate.error -ne 'REAL_WRITE_VALIDATION_REQUIRED'){throw 'NATIVE_WRITE_GATE_FAILED'}
$global:LASTEXITCODE=0
'Native write guard rejects stage before any desktop lookup: PASS'
