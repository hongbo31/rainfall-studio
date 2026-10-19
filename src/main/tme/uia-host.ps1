# User-triggered, same-user Windows UI Automation. No browser profile, network or credentials.
if($PSVersionTable.PSVersion.Major -ne 7){throw 'PS7_REQUIRED'}
$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new();[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
Add-Type -AssemblyName UIAutomationClient;Add-Type -AssemblyName UIAutomationTypes
. "$PSScriptRoot/uia-grid.ps1"
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class RainfallUiaInput {
 [StructLayout(LayoutKind.Sequential)] public struct KEY {public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Sequential)] public struct MOUSE {public int x,y;public uint data,flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Explicit)] public struct UNION {[FieldOffset(0)]public KEY key;[FieldOffset(0)]public MOUSE mouse;}
 [StructLayout(LayoutKind.Sequential)]public struct INPUT {public uint type;public UNION value;}
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern IntPtr GetWindow(IntPtr h,uint command);
 [DllImport("user32.dll")]public static extern IntPtr GetAncestor(IntPtr h,uint flags);
 [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
 [DllImport("user32.dll")]public static extern uint SendInput(uint n,INPUT[] inputs,int size);
 public static void Key(ushort vk,bool up){var i=new INPUT();i.type=1;i.value.key.vk=vk;i.value.key.flags=up?2u:0u;if(SendInput(1,new[]{i},Marshal.SizeOf<INPUT>())!=1)throw new Exception("KEY_INPUT_FAILED");}
 public static void Text(string text){foreach(char c in text){var a=new INPUT();a.type=1;a.value.key.scan=c;a.value.key.flags=4;var b=a;b.value.key.flags=6;if(SendInput(2,new[]{a,b},Marshal.SizeOf<INPUT>())!=2)throw new Exception("KEY_INPUT_FAILED");}}
 public static void Click(int x,int y){SetCursorPos(x,y);mouse_event(2,0,0,0,UIntPtr.Zero);mouse_event(4,0,0,0,UIntPtr.Zero);}
}
'@
$script:request=[Console]::In.ReadToEnd()|ConvertFrom-Json
$script:binding=$request.binding;$script:expected=if($binding){$binding.account}else{$request.expectedAccount}
function Nodes($root){return @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition))}
function Get-Page {
 $candidates=@()
 if($script:binding){$process=Get-Process -Id $script:binding.pid -ErrorAction Stop;if((Get-TmeProcessStamp $process.StartTime) -ne $script:binding.started){throw 'WINDOW_CHANGED'};$handles=@([long]$script:binding.handle)}
 else{$process=$null;$handles=@(Get-Process chrome,msedge -ErrorAction SilentlyContinue|Where-Object MainWindowHandle -ne 0|ForEach-Object {$_.MainWindowHandle.ToInt64()})}
 foreach($handle in $handles){$root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$handle);$docs=@($root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.AndCondition]::new([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Document),[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'腾讯音乐人'))));foreach($doc in $docs){$p=$null;if(-not $doc.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$p)){continue};$url=$p.Current.Value;try{$uri=[uri]$url}catch{continue};if($uri.Scheme -ne 'https' -or $uri.Host -ne 'y.tencentmusic.com'){continue};$items=Nodes $doc;$header=@($items|Where-Object {$_.Current.Name -eq '全球发行作品' -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button});if($header.Count -ne 1){continue};$account=@($items|Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and $_.Current.Name -ceq $script:expected -and $_.Current.BoundingRectangle.Top -lt ($header[0].Current.BoundingRectangle.Bottom+30) -and $_.Current.BoundingRectangle.Top -ge $doc.Current.BoundingRectangle.Top});if($account.Count -ne 1){continue};$pidValue=$root.Current.ProcessId;$proc=Get-Process -Id $pidValue;if($proc.ProcessName -notin @('chrome','msedge')){throw 'BROWSER_PROCESS_REQUIRED'};$b=@{pid=$pidValue;handle=[string]$handle;started=(Get-TmeProcessStamp $proc.StartTime);account=$script:expected};$candidates+=@{root=$root;doc=$doc;items=$items;url=$url;binding=$b}}
 }
 if($candidates.Count -ne 1){throw 'ACCOUNT_CHANGED'}
 $page=$candidates[0];if($script:binding -and ($page.binding.pid -ne $script:binding.pid -or $page.binding.started -ne $script:binding.started -or $page.binding.handle -ne $script:binding.handle)){throw 'WINDOW_CHANGED'};return $page
}
function Find-Control([string]$name,[string]$type){$page=Get-Page;$matches=@($page.items|Where-Object {$_.Current.Name.Trim() -eq $name -and $_.Current.ControlType.ProgrammaticName -eq ('ControlType.'+$type) -and $_.Current.IsEnabled});if($matches.Count -ne 1){throw 'CONTROL_NOT_UNIQUE'};return $matches[0]}
function Click-Control([string]$name,[string]$type='Button',[switch]$Parent){$node=Find-Control $name $type;if($Parent){$node=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($node)};$p=$null;if($node.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$p)){$p.Invoke()}elseif($node.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$p)){$p.Select()}else{throw 'CONTROL_PATTERN_REQUIRED'};Start-Sleep -Milliseconds 250}
function Set-Field([string]$name,[string]$value){$n=Find-Control $name 'Edit';$p=$null;if(-not $n.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$p)){throw 'FIELD_PATTERN_REQUIRED'};$p.SetValue($value);$n=Find-Control $name 'Edit';if(($n.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).Current.Value -ne $value){throw 'FIELD_READBACK_FAILED'}}
function Read-Field($page,[string]$prefix){$n=@($page.items|Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $_.Current.Name.StartsWith($prefix)});if($n.Count -eq 1){$p=$null;if($n[0].TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$p)){return $p.Current.Value}};return $null}
function Snapshot {
 $page=Get-Page;$names=@($page.items|ForEach-Object {$_.Current.Name});$url=$page.url;$album=$null;if($url -match '/(?:songlist|uploadToAlbum)/(\d+)'){$album=$Matches[1]};$mode='other';if($url -match '/songlist/\d+'){$mode='album'};if($url -match '/uploadToAlbum/\d+'){$mode='intake'}
 $cells=@(foreach($node in $page.items){if($node.Current.ControlType -ne [System.Windows.Automation.ControlType]::DataItem){continue};$p=$null;if($node.TryGetCurrentPattern([System.Windows.Automation.GridItemPattern]::Pattern,[ref]$p)){$parent=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($node);@{RowKey=($parent.GetRuntimeId() -join '.');Column=$p.Current.Column;Name=$node.Current.Name}}});$rows=@(Convert-TmeGrid $cells)
 $title=Read-Field $page '请输入歌曲名称';$form=$null;if($null -ne $title){$audio=@($names|Where-Object {$_ -match '\.(wav|mp3|flac)$'});$form=@{title=$title;audioName=if($audio.Count -eq 1){$audio[0]}else{''};lyrics=(Read-Field $page '10-20000字')}}
 $agreement=$null;$boxes=@($page.items|Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::CheckBox -and $_.Current.Name -eq '我已阅读授权书，并确认向腾讯音乐人授权'});if($boxes.Count -eq 1){$mode='authorization';$pdf=@($page.items|Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document -and $_.Current.Name -eq 'PDF.js viewer'});if($pdf.Count -eq 1){$parts=@((Nodes $pdf[0])|Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text}|ForEach-Object {$_.Current.Name});$text=$parts -join "`n";if($text -match '授权书' -and $text -match '授权日期'){$toggle=$boxes[0].GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern);$agreement=@{text=$text;checked=$toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On;modeText=(@($names|Where-Object {$_ -match '非独家授权|授权\d+年|期间歌曲'}) -join "`n")}}}}
 $submission=$null;if($names -contains '提交成功，审核结果将在24小时之内通知您'){$mode='success';$submission=@{success=$true;status=if(@($names|Where-Object {$_ -match '歌曲正在审核中'}).Count){'reviewing'}else{'unknown'}}}
 return @{binding=$page.binding;url=$url;mode=$mode;albumId=$album;rows=$rows;form=$form;agreement=$agreement;submission=$submission}
}
function Upload-Audio($draft){
 $page=Get-Page;if($page.url -notmatch ('/uploadToAlbum/'+[regex]::Escape($draft.metadata.albumId)+'(?:\?|$)')){throw 'INTAKE_REQUIRED'};if((Snapshot).form){throw 'FORM_NOT_EMPTY'}
 $actual=(Get-FileHash -LiteralPath $draft.audio.file -Algorithm SHA256).Hash.ToLowerInvariant();if($actual -ne $draft.audio.sha256){throw 'ASSET_HASH_CHANGED'}
 Click-Control '点击此处上传' 'Text' -Parent
 Start-Sleep -Milliseconds 350;$fg=[RainfallUiaInput]::GetForegroundWindow();$dialog=[System.Windows.Automation.AutomationElement]::FromHandle($fg);if($dialog.Current.Name -ne '打开' -or [RainfallUiaInput]::GetWindow($fg,4) -ne [IntPtr][long]$script:binding.handle){throw 'OWNED_FILE_PICKER_REQUIRED'}
 $edit=@((Nodes $dialog)|Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $_.Current.Name -match '文件名'});if($edit.Count -ne 1){throw 'FILE_NAME_CONTROL_REQUIRED'};$edit[0].SetFocus();if([RainfallUiaInput]::GetAncestor([System.Windows.Automation.AutomationElement]::FocusedElement.Current.NativeWindowHandle,2) -ne $fg){throw 'PICKER_FOCUS_CHANGED'}
 [RainfallUiaInput]::Key(17,$false);[RainfallUiaInput]::Key(65,$false);[RainfallUiaInput]::Key(65,$true);[RainfallUiaInput]::Key(17,$true);[RainfallUiaInput]::Text($draft.audio.file)
 if([RainfallUiaInput]::GetForegroundWindow() -ne $fg){throw 'PICKER_FOCUS_CHANGED'};[RainfallUiaInput]::Key(13,$false);[RainfallUiaInput]::Key(13,$true)
 for($i=0;$i -lt 80;$i++){Start-Sleep -Milliseconds 600;$snap=Snapshot;if($snap.form -and $snap.form.audioName -eq [IO.Path]::GetFileName($draft.audio.file)){return};if((Get-Page).items.Current.Name -contains '该歌曲已保存草稿'){throw 'EXISTING_REMOTE_RECORDING'}};throw 'UPLOAD_READBACK_REQUIRED'
}
function Set-Choice([string]$field,[string]$choice){$n=Find-Control $field 'Edit';$v=($n.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).Current.Value;if($v -eq $choice){return};Set-Field $field $choice;Start-Sleep -Milliseconds 200;Click-Control $choice 'Text' -Parent}
function Set-Date([string]$date){
 Set-Field '请选择生成时间' $date;Start-Sleep -Milliseconds 200;$p=Get-Page;$d=[datetime]::ParseExact($date,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture);$year=$d.Year.ToString()+' 年';$month=$d.Month.ToString()+' 月';if($p.items.Current.Name -notcontains $year -or $p.items.Current.Name -notcontains $month){throw 'DATE_PICKER_MONTH_REQUIRES_USER'}
 $n=Find-Control ($d.Day.ToString()) 'DataItem';$grid=$null;if(-not $n.TryGetCurrentPattern([System.Windows.Automation.GridItemPattern]::Pattern,[ref]$grid)){throw 'DATE_GRID_REQUIRED'};$p=Get-Page;[void][RainfallUiaInput]::SetForegroundWindow([IntPtr][long]$p.binding.handle);$n=Find-Control ($d.Day.ToString()) 'DataItem';$r=$n.Current.BoundingRectangle;if($r.IsEmpty -or $n.Current.IsOffscreen -or [RainfallUiaInput]::GetForegroundWindow() -ne [IntPtr][long]$p.binding.handle){throw 'DATE_FOCUS_REQUIRED'};[RainfallUiaInput]::Click([int]($r.Left+$r.Width/2),[int]($r.Top+$r.Height/2));if((Read-Field (Get-Page) '请选择生成时间') -ne $date){throw 'DATE_READBACK_FAILED'}
}
function Stage($d){
 if($d.metadata.coverPolicy -ne 'preserve_album' -or -not $d.metadata.ownLyricist -or -not $d.metadata.ownComposer){throw 'OFFICIAL_FORM_REQUIRED'}
 $snap=Snapshot;if($snap.albumId -ne $d.metadata.albumId){throw 'ALBUM_CHANGED'};if($snap.mode -eq 'album'){Click-Control '点击此处上传' 'Text' -Parent;Start-Sleep -Milliseconds 600}
 Upload-Audio $d
 Set-Field '请输入歌曲名称，最多60字' $d.title
 Click-Control $(if($d.metadata.version){$d.metadata.version}else{'完整版'}) 'RadioButton'
 Set-Choice '请选择曲风' $(if($d.metadata.genre){$d.metadata.genre}else{'流行'});Set-Choice '请选择语种' $(if($d.metadata.language){$d.metadata.language}else{'国语'})
 Click-Control '我是作词人' 'RadioButton';Click-Control '我是作曲人' 'RadioButton'
 if($d.metadata.lyricist -ne $script:binding.account -or $d.metadata.composer -ne $script:binding.account){throw 'AUTHOR_ACCOUNT_READBACK_MISMATCH'}
 if($d.metadata.aiMusic -eq 'yes'){Click-Control '是' 'RadioButton';Set-Field '请选择或填写您的生成工具名称' $d.metadata.aiTool;Set-Date $d.metadata.generatedOn}else{Click-Control '否' 'RadioButton'}
 $p=Get-Page;$lyric=@($p.items|Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $_.Current.Name.StartsWith('10-20000字')});if($lyric.Count -ne 1){throw 'LYRIC_FIELD_REQUIRED'};Set-Field $lyric[0].Current.Name $d.metadata.lyrics
 Set-Field '歌曲上架后，音乐人说将展示在歌曲评论区顶部，5-300字' $d.metadata.statement
 # Do not change shared album metadata, cover, companion audio or optional proof.
 $p=Get-Page;$toggles=@(foreach($n in $p.items){if($n.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button){continue};$t=$null;if($n.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$t)){@{node=$n;pattern=$t}}});if($toggles.Count -ne 1){throw 'COVER_PERMISSION_REQUIRES_USER'};$desired=if($d.metadata.allowCover){[System.Windows.Automation.ToggleState]::On}else{[System.Windows.Automation.ToggleState]::Off};if($toggles[0].pattern.Current.ToggleState -ne $desired){[void](Get-Page);$toggles[0].pattern.Toggle()}
 return Snapshot
}
try{
 if($request.action -notin @('observe','stage','accept','submit')){throw 'ACTION_NOT_ALLOWED'}
 # Until stable visible account/form identity and live mapping are validated, this native host is read-only.
 # A request payload cannot override this gate.
 if($request.action -ne 'observe'){throw 'REAL_WRITE_VALIDATION_REQUIRED'}
 if($request.action -eq 'observe'){$result=Snapshot}
 elseif($request.action -eq 'stage'){$result=Stage $request.draft}
 else{
  $s=Snapshot;if($s.mode -ne 'authorization' -or $s.albumId -ne $request.albumId -or -not $s.agreement){throw 'AUTHORIZATION_READBACK_REQUIRED'}
  $beforeText=$s.agreement.text;$beforeMode=$s.agreement.modeText
  if($beforeText -cne $request.agreement.text -or $beforeMode -cne $request.agreement.modeText){throw 'AGREEMENT_CHANGED'}
  $again=Snapshot;if($again.agreement.text -cne $beforeText -or $again.agreement.modeText -cne $beforeMode){throw 'AGREEMENT_CHANGED'}
  if($request.action -eq 'accept'){$n=Find-Control '我已阅读授权书，并确认向腾讯音乐人授权' 'CheckBox';$t=$n.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern);if($t.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On){$t.Toggle()};$result=Snapshot;if(-not $result.agreement.checked){throw 'ACCEPTANCE_READBACK_REQUIRED'}}
  else{if(-not $again.agreement.checked){throw 'SEPARATE_AUTHORIZATION_REQUIRED'};Click-Control '提交审核';Start-Sleep -Milliseconds 900;$result=Snapshot}
 }
 @{ok=$true;value=$result}|ConvertTo-Json -Depth 12 -Compress
}catch{$code=$_.Exception.Message;if($code -notmatch '^[A-Z0-9_]+$'){$code='UIA_OPERATION_FAILED'};@{ok=$false;error=$code}|ConvertTo-Json -Compress;exit 1}
