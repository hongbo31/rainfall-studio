function Get-TmeProcessStamp([datetime]$value){return $value.ToUniversalTime().Ticks.ToString()}
function Convert-TmeGrid($cells) {
 $groups=@{};foreach($cell in $cells){if(-not $groups.ContainsKey($cell.RowKey)){$groups[$cell.RowKey]=@{}};$groups[$cell.RowKey][[int]$cell.Column]=[string]$cell.Name}
 foreach($r in $groups.Values){if(-not $r.ContainsKey(0) -or $r[0] -notmatch '^\d+$' -or -not $r.ContainsKey(1) -or -not $r[1].Trim()){continue};$status='unknown';$reason='';if($r[3] -match '审核中|待审核'){$status='reviewing'}elseif($r[3] -match '驳回|不通过'){$status='rejected';$reason=$r[3]}elseif($r[3] -match '已发布|已上架'){$status='published'};@{title=$r[1];songId=$null;status=$status;reason=$reason}}
}
