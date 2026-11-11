# Same-user visible UI Automation only. This host deliberately has no agreement/submit action.
if($PSVersionTable.PSVersion.Major -ne 7){throw 'PS7_REQUIRED'}
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new();[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class RainfallAiInput {
 [StructLayout(LayoutKind.Sequential)] public struct KEY {public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Sequential)] public struct MOUSE {public int x,y;public uint data,flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Explicit)] public struct UNION {[FieldOffset(0)]public KEY key;[FieldOffset(0)]public MOUSE mouse;}
 [StructLayout(LayoutKind.Sequential)]public struct INPUT {public uint type;public UNION value;}
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern IntPtr GetWindow(IntPtr h,uint command);
 [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
 [DllImport("user32.dll")]public static extern uint SendInput(uint n,INPUT[] inputs,int size);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,System.Text.StringBuilder text,int length);
 public static string VisibleText(IntPtr h){var s=new System.Text.StringBuilder(32768);GetWindowText(h,s,s.Capacity);return s.ToString();}
 public delegate bool EnumProc(IntPtr h,IntPtr p);
 [DllImport("user32.dll")]public static extern bool EnumChildWindows(IntPtr h,EnumProc p,IntPtr l);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetClassName(IntPtr h,System.Text.StringBuilder b,int n);
 [DllImport("user32.dll")]public static extern int GetDlgCtrlID(IntPtr h);
 public static string ReadVisibleFilename(IntPtr dialog){string value=null;int count=0;EnumChildWindows(dialog,(h,p)=>{var b=new System.Text.StringBuilder(256);GetClassName(h,b,256);if(GetDlgCtrlID(h)==1148&&b.ToString()=="Edit"){count++;value=VisibleText(h);}return true;},IntPtr.Zero);if(count!=1)throw new Exception("FILENAME_INPUT_ID_REQUIRED");return value;}
 public static void Key(ushort vk,bool up){var i=new INPUT();i.type=1;i.value.key.vk=vk;i.value.key.flags=up?2u:0u;if(SendInput(1,new[]{i},Marshal.SizeOf<INPUT>())!=1)throw new Exception("KEY_INPUT_FAILED");}
 public static void Text(string text){foreach(char c in text){var a=new INPUT();a.type=1;a.value.key.scan=c;a.value.key.flags=4;var b=a;b.value.key.flags=6;if(SendInput(2,new[]{a,b},Marshal.SizeOf<INPUT>())!=2)throw new Exception("KEY_INPUT_FAILED");}}
 public static void Click(int x,int y){SetCursorPos(x,y);mouse_event(2,0,0,0,UIntPtr.Zero);mouse_event(4,0,0,0,UIntPtr.Zero);}
}
'@
$request=[Console]::In.ReadToEnd()|ConvertFrom-Json -DateKind String
$script:root=$null;$script:bind=$null;$script:identity=$null;$script:strictDocument=$false
function Nodes($root){return @($root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition))}
function Wait-NativeReadback([scriptblock]$Read,[scriptblock]$Ready,[int]$TimeoutMs,[string]$FailureCode,[string[]]$TransientErrors=@(),[int]$ConsecutiveReady=1){
 if($TimeoutMs -lt 1 -or $ConsecutiveReady -lt 1){throw 'INVALID_READBACK_TIMEOUT'}
 $timer=[Diagnostics.Stopwatch]::StartNew();$readyCount=0
 do{
  $hasValue=$false;$readValue=$null
  try{$readValue=& $Read;$hasValue=$true}catch{
   $unavailable=$_.Exception -is [Windows.Automation.ElementNotAvailableException] -or $_.Exception.InnerException -is [Windows.Automation.ElementNotAvailableException]
   if(-not $unavailable -and $_.Exception.Message -cnotin $TransientErrors){throw}
  }
  if($hasValue -and (& $Ready $readValue)){$readyCount++;if($readyCount -ge $ConsecutiveReady){return $readValue}}else{$readyCount=0}
  $remaining=$TimeoutMs-$timer.ElapsedMilliseconds;if($remaining -le 0){break}
  Start-Sleep -Milliseconds ([int][Math]::Min(100,$remaining))
 }while($timer.ElapsedMilliseconds -lt $TimeoutMs)
 throw $FailureCode
}
function Control-Parent($node){return [Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($node)}
function Select-OuterControl($Candidates,[scriptblock]$Parent){
 $items=@($Candidates);if($items.Count -eq 1){return $items[0]};if($items.Count -lt 1){throw 'CONTROL_NOT_UNIQUE'}
 $keys=@{};foreach($node in $items){$key=$node.GetRuntimeId()-join '.';if(-not $key -or $keys.ContainsKey($key)){throw 'CONTROL_NOT_UNIQUE'};$keys[$key]=$true}
 $roots=@(foreach($node in $items){
  $ancestor=& $Parent $node;$seen=@{};$nested=$false;$depth=0
  while($null -ne $ancestor){
   $key=$ancestor.GetRuntimeId()-join '.'
   if(-not $key -or $seen.ContainsKey($key) -or $depth -ge 64){throw 'CONTROL_NOT_UNIQUE'}
   $seen[$key]=$true;$depth++
   if($keys.ContainsKey($key)){$nested=$true;break}
   $ancestor=& $Parent $ancestor
  }
  if(-not $nested){$node}
 })
 if($roots.Count -ne 1){throw 'CONTROL_NOT_UNIQUE'}
 $root=$roots[0];$rootId=$root.GetRuntimeId()-join '.'
 # Every discarded mirror must reach this root, not merely another candidate in a cycle.
 foreach($node in $items){
  if(($node.GetRuntimeId()-join '.') -ceq $rootId){continue}
  $ancestor=& $Parent $node;$seen=@{};$depth=0;$reached=$false
  while($null -ne $ancestor){
   $id=$ancestor.GetRuntimeId()-join '.'
   if(-not $id -or $seen.ContainsKey($id) -or $depth -ge 64){throw 'CONTROL_NOT_UNIQUE'}
   if($id -ceq $rootId){$reached=$true;break}
   $seen[$id]=$true;$depth++;$ancestor=& $Parent $ancestor
  }
  if(-not $reached){throw 'CONTROL_NOT_UNIQUE'}
 }
 return $root
}
function Page {
 $docs=@($script:root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Document)))
 $valid=@(foreach($d in $docs){$v=$null;if($d.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$v)){try{$u=[uri]$v.Current.Value}catch{continue};if($u.Scheme -eq 'https' -and $u.Host -eq 'y.tencentmusic.com' -and $u.Port -eq 443){@{doc=$d;url=$u.AbsoluteUri;nodes=(Nodes $d);text=$d.GetCurrentPattern([Windows.Automation.TextPattern]::Pattern).DocumentRange.GetText(150000)}}}})
 # An official PDF viewer is a child Document of the same page, not another browser tab.
 if($valid.Count -gt 1){
  try{$outer=Select-OuterControl -Candidates @($valid|ForEach-Object {$_.doc}) -Parent {param($n)Control-Parent $n}}catch{if($_.Exception.Message -ceq 'CONTROL_NOT_UNIQUE'){throw 'OFFICIAL_ACTIVE_DOCUMENT_REQUIRED'};throw}
  $outerId=$outer.GetRuntimeId()-join '.';$valid=@($valid|Where-Object {($_.doc.GetRuntimeId()-join '.') -ceq $outerId})
 }
 if($valid.Count -ne 1){throw 'OFFICIAL_ACTIVE_DOCUMENT_REQUIRED'}
 if($script:strictDocument -and ($valid[0].doc.GetRuntimeId()-join '.') -cne $script:bind.documentId){throw 'AI_DOCUMENT_CHANGED'}
 return $valid[0]
}
function Unique($nodes,[string]$name,[string]$type,[switch]$Prefix){
 $a=@($nodes|Where-Object {$_.Current.ControlType.ProgrammaticName -eq ('ControlType.'+$type) -and $(if($Prefix){([string]$_.Current.Name).StartsWith($name)}else{([string]$_.Current.Name).Trim() -ceq $name})})
 if($type -ceq 'RadioButton' -and $a.Count -gt 1){return Select-OuterControl -Candidates $a -Parent {param($n)Control-Parent $n}}
 if($a.Count -ne 1){throw 'CONTROL_NOT_UNIQUE'};return $a[0]
}
function Resolve-AudioUploadControl($nodes){
 $native=@($nodes|Where-Object {$_.Current.ControlType.ProgrammaticName -eq 'ControlType.Button' -and ([string]$_.Current.Name).Trim() -ceq '选择文件: 未选择任何文件' -and $_.Current.IsEnabled -and -not $_.Current.IsOffscreen})
 if($native.Count -gt 1){throw 'AUDIO_UPLOAD_CONTROL_NOT_UNIQUE'}
 if($native.Count -eq 1){return $native[0]}
 $legacy=@($nodes|Where-Object {$_.Current.ControlType.ProgrammaticName -eq 'ControlType.Text' -and ([string]$_.Current.Name).Trim() -ceq '点击此处上传' -and $_.Current.IsEnabled -and -not $_.Current.IsOffscreen})
 if($legacy.Count -ne 1){throw 'AUDIO_UPLOAD_CONTROL_NOT_UNIQUE'}
 return $legacy[0]
}
function Invoke-Node($node){$p=$null;if($node.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$p)){$p.Invoke()}elseif($node.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern,[ref]$p)){$p.Select()}else{throw 'STANDARD_ACTION_REQUIRED'};Start-Sleep -Milliseconds 250}
function Invoke-Name([string]$name,[string]$type='Button'){Invoke-Node (Unique (Page).nodes $name $type)}
function Foreground {
 if([RainfallAiInput]::GetForegroundWindow() -ne [IntPtr][long]$script:bind.handle){
  $shell=New-Object -ComObject WScript.Shell;[void]$shell.AppActivate([int]$script:bind.pid);Start-Sleep -Milliseconds 150
 }
 if([RainfallAiInput]::GetForegroundWindow() -ne [IntPtr][long]$script:bind.handle){throw 'BROWSER_FOREGROUND_REQUIRED'}
}
function Click-Node($node){
 Foreground;$p=$null;if($node.TryGetCurrentPattern([Windows.Automation.ScrollItemPattern]::Pattern,[ref]$p)){$p.ScrollIntoView();Start-Sleep -Milliseconds 100}
 $pt=$node.GetClickablePoint();Foreground;[RainfallAiInput]::Click([int]$pt.X,[int]$pt.Y);Start-Sleep -Milliseconds 250
}
function Read-Value($node){return $node.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).Current.Value}
function Value([string]$name,[switch]$Prefix){return Read-Value (Unique (Page).nodes $name 'Edit' -Prefix:$Prefix)}
function Set-Value([string]$name,[string]$value,[switch]$Prefix){
 $n=Unique (Page).nodes $name 'Edit' -Prefix:$Prefix
 if((Read-Value $n) -cne $value){$n.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue($value)}
 $null=Wait-NativeReadback -Read {Value $name -Prefix:$Prefix} -Ready {param($v)$v -ceq $value} -TimeoutMs 2500 -FailureCode 'FIELD_READBACK_FAILED'
}
function Bind {
 $candidates=@()
 $handles=if($request.binding){@([long]$request.binding.handle)}else{@(Get-Process chrome,msedge -ErrorAction SilentlyContinue|Where-Object MainWindowHandle -ne 0|ForEach-Object {$_.MainWindowHandle.ToInt64()})}
 foreach($h in $handles){
  $script:root=[Windows.Automation.AutomationElement]::FromHandle([IntPtr]$h)
  try{$p=Page}catch{continue}
  if($p.url -notmatch '^https://y\.tencentmusic\.com/#/user/manage/aiChoose/add(?:\?|$)'){continue}
  $proc=Get-Process -Id $script:root.Current.ProcessId
  if($proc.ProcessName -notin @('chrome','msedge')){continue}
  $b=@{pid=$proc.Id;handle=[string]$h;started=$proc.StartTime.ToUniversalTime().ToString('o');documentId=($p.doc.GetRuntimeId()-join '.')}
  if($request.binding -and ($request.binding.pid -ne $b.pid -or $request.binding.started -ne $b.started -or $request.binding.documentId -ne $b.documentId)){throw 'WINDOW_BINDING_CHANGED'}
  $candidates+=@{root=$script:root;binding=$b}
 }
 if($candidates.Count -ne 1){throw 'AI_INTAKE_TAB_REQUIRED'}
 $script:root=$candidates[0].root;$script:bind=$candidates[0].binding
}
function Identity {
 $script:strictDocument=$false
 $p=Page;$tabs=@((Nodes $script:root)|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::TabItem -and $_.Current.Name -ceq '腾讯音乐人'})
 if($tabs.Count -gt 8){throw 'EXCESSIVE_OFFICIAL_TABS'}
 $selected=@($tabs|Where-Object {$_.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected})
 if($selected.Count -ne 1){throw 'ACTIVE_TAB_REQUIRED'}
 $proof=@()
 try{
  foreach($tab in $tabs){
   Invoke-Node $tab;$p=Page
   if($p.url -notmatch '^https://y\.tencentmusic\.com/#/user/musician/edit(?:\?|$)'){continue}
   $bindingTabs=@($p.nodes|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::TabItem -and ([string]$_.Current.Name).Trim() -ceq '绑定其他平台账号'})
   if($bindingTabs.Count -ne 1){continue};Invoke-Node $bindingTabs[0];$p=Page
   $k=[regex]::Match($p.text,'已绑定酷狗ID[：:]\s*(\d{5,30})');$linked=[regex]::Match($p.text,'已绑定酷狗音乐推ID[：:]\s*(\d{5,30})');$q=[regex]::Match($p.text,'已绑定个人账号[：:]\s*([^\r\n]+)')
   if(-not $k.Success -or -not $linked.Success -or $k.Groups[1].Value -cne $linked.Groups[1].Value -or -not $q.Success){continue}
   # Artist must be a distinct visible header text alongside the global distribution button.
   $headers=@($p.nodes|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and $_.Current.Name -ceq '全球发行作品'})
   if($headers.Count -ne 1){continue}
   $artist=$request.artistName
   $names=@($p.nodes|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Text -and $_.Current.Name -ceq $artist -and $_.Current.BoundingRectangle.Top -lt ($headers[0].Current.BoundingRectangle.Bottom+30) -and $_.Current.BoundingRectangle.Top -ge $p.doc.Current.BoundingRectangle.Top})
   if($names.Count -ne 1){continue}
   $proof+=@{kugouId=$k.Groups[1].Value;qqDisplayName=$q.Groups[1].Value.Trim();artistName=$artist;profileUrl=$p.url;profileDocumentId=($p.doc.GetRuntimeId()-join '.');selectedTab='绑定其他平台账号'}
  }
 }finally{Invoke-Node $selected[0]}
 if($proof.Count -ne 1){throw 'OFFICIAL_BINDING_FINGERPRINT_REQUIRED'}
 $p=Page;if(($p.doc.GetRuntimeId()-join '.') -cne $script:bind.documentId){throw 'AI_DOCUMENT_CHANGED'}
 if(-not $p.text.Contains($request.artistName)){throw 'AI_HEADER_CHANGED'}
 $script:identity=$proof[0]
 $script:strictDocument=$true
}
function Optional-Field($nodes,[string]$name,[switch]$Prefix){
 $matches=@($nodes|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Edit -and $(if($Prefix){([string]$_.Current.Name).StartsWith($name)}else{([string]$_.Current.Name).Trim() -ceq $name})})
 if($matches.Count -eq 0){return $null};if($matches.Count -ne 1){throw 'CONTROL_NOT_UNIQUE'};return Read-Value $matches[0]
}
function Optional-Checkbox($nodes,[string]$name){
 $matches=@($nodes|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::CheckBox -and ([string]$_.Current.Name).Trim() -ceq $name})
 if($matches.Count -eq 0){return $null};if($matches.Count -ne 1){throw 'CONTROL_NOT_UNIQUE'}
 return $matches[0].GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern).Current.ToggleState -eq [Windows.Automation.ToggleState]::On
}
function Test-EditableContent($node){
 $seen=@{};$depth=0
 while($null -ne $node){
  if($node.Current.ControlType -eq [Windows.Automation.ControlType]::Edit){return $true}
  $id=$node.GetRuntimeId()-join '.'
  if(-not $id -or $seen.ContainsKey($id) -or $depth -ge 64){throw 'CONTROL_ANCESTRY_UNVERIFIABLE'}
  $seen[$id]=$true;$depth++;$node=Control-Parent $node
 }
 return $false
}
function Test-GeneratedCoverBanner([string]$name){
 # Only a bounded decorative prefix is accepted, never arbitrary prose or a suffix.
 # U+2139 INFORMATION SOURCE is Unicode Ll, despite rendering as an information icon.
 # Admit that exact observed icon, not the broad Letter category or arbitrary user prose.
 return $name.Trim() -cmatch '^[\p{So}\p{Sk}\p{Co}\p{P}\s\u2139\uFE0E\uFE0F]{0,8}已为您生成智能专辑封面$'
}
function Get-CoverUiEvidence($nodes){
 $labels=@($nodes|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Text -and -not $_.Current.IsOffscreen -and (([string]$_.Current.Name).Trim() -cin @('调整图片','裁剪图片') -or (Test-GeneratedCoverBanner ([string]$_.Current.Name)))})
 $ui=@(foreach($n in $labels){if(-not (Test-EditableContent $n)){$n}})
 $heads=@($ui|Where-Object {([string]$_.Current.Name).Trim() -cin @('调整图片','裁剪图片')})
 return @{cropHeadings=$heads;cropVisible=($heads.Count -gt 0);generatorBanner=(@($ui|Where-Object {Test-GeneratedCoverBanner ([string]$_.Current.Name)}).Count -gt 0)}
}
function Get-ManualCoverState($nodes,[string]$text){
 $manual=@($nodes|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and ([string]$_.Current.Name).Trim() -ceq '更换图片' -and $_.Current.IsEnabled -and -not $_.Current.IsOffscreen})
 $smart=@($nodes|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and ([string]$_.Current.Name).Trim() -ceq '智能封面' -and $_.Current.IsEnabled -and -not $_.Current.IsOffscreen})
 $evidence=Get-CoverUiEvidence $nodes
 return @{manualSelected=($manual.Count -eq 1 -and $smart.Count -eq 1 -and -not $evidence.generatorBanner -and -not $evidence.cropVisible);generatorBanner=$evidence.generatorBanner}
}
function Resolve-CoverUploadControl($nodes){
 $matches=@($nodes|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and ([string]$_.Current.Name).Trim() -cin @('上传图片','更换图片') -and $_.Current.IsEnabled -and -not $_.Current.IsOffscreen})
 if($matches.Count -ne 1){throw 'COVER_UPLOAD_CONTROL_NOT_UNIQUE'};return $matches[0]
}
function Form {
 $p=Page;$mode='unknown';$terms=$null;$form=$null
 if($p.url -notmatch '^https://y\.tencentmusic\.com/#/user/manage/aiChoose/add(?:\?|$)'){throw 'AI_ROUTE_CHANGED'}
 $titles=@($p.nodes|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Edit -and ([string]$_.Current.Name).StartsWith('请输入歌曲名称')})
 if($titles.Count -gt 1){throw 'CONTROL_NOT_UNIQUE'}
 # A collapsed/unreadable existing card must never be treated as an empty upload intake.
 $existingCard=@($p.nodes|Where-Object {-not $_.Current.IsOffscreen -and (([string]$_.Current.Name).Trim() -ceq '更换音频' -or ([string]$_.Current.Name).Trim() -match '^曲目\s*\d+$')}).Count -gt 0 -or $p.text -match '上传AI歌曲\s*[（(]\s*[1-9]\d*\s*首'
 if($titles.Count -eq 0 -and $existingCard){throw 'EXISTING_AUDIO_SCOPE_UNVERIFIABLE'}
 if($p.text.Contains('非独家授权') -and $p.text.Contains('授权3年')){$mode='ai_authorization';$terms=$p.text}
 elseif($titles.Count -eq 1){
  $mode='editor';$lang=@($p.nodes|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Edit -and $_.Current.Name -ceq '请选择语种'})
  if($lang.Count -gt 2){throw 'CONTROL_NOT_UNIQUE'}
  $toggleNodes=@(foreach($n in $p.nodes){$t=$null;if($n.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and $n.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern,[ref]$t)){$n}})
  $allowCover=$null
  if($toggleNodes.Count -gt 0){try{$toggle=Select-OuterControl -Candidates $toggleNodes -Parent {param($n)Control-Parent $n};$allowCover=$toggle.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern).Current.ToggleState -eq [Windows.Automation.ToggleState]::On}catch{if($_.Exception.Message -cne 'CONTROL_NOT_UNIQUE'){throw}}}
  $version=$null;$releaseMode=$null
  if(@($p.nodes|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::RadioButton -and ([string]$_.Current.Name).Trim() -ceq '完整版'}).Count -gt 0){$version=(Unique $p.nodes '完整版' 'RadioButton').GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected}
  if(@($p.nodes|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::RadioButton -and ([string]$_.Current.Name).Trim() -ceq '审核通过即发布'}).Count -gt 0){$releaseMode=(Unique $p.nodes '审核通过即发布' 'RadioButton').GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected}
  $form=@{
   title=(Optional-Field $p.nodes '请输入歌曲名称' -Prefix);genre=(Optional-Field $p.nodes '请选择曲风');text=$p.text
   lyrics=(Optional-Field $p.nodes '10-20000字' -Prefix);aiTool=(Optional-Field $p.nodes '请选择或填写您的生成工具名称');generatedOn=(Optional-Field $p.nodes '请选择生成时间')
   language=if($lang.Count -eq 2){Read-Value $lang[0]}else{$null};albumLanguage=if($lang.Count -eq 2){Read-Value $lang[1]}else{$null}
   albumTitle=(Optional-Field $p.nodes '请输入专辑名称' -Prefix);albumDescription=(Optional-Field $p.nodes '请输入10-2000字');albumGenre=(Optional-Field $p.nodes '请选择流派');albumType=(Optional-Field $p.nodes '请选择专辑类型')
   ownLyrics=(Optional-Checkbox $p.nodes '我是作词人');ownComposition=(Optional-Checkbox $p.nodes '我是作曲人');allowCover=$allowCover;version=$version;releaseMode=$releaseMode
  }
  $required=@('title','genre','lyrics','aiTool','generatedOn','language','albumLanguage','albumTitle','albumDescription','albumGenre','albumType','ownLyrics','ownComposition','allowCover','version','releaseMode')
  $form.metadataExpanded=@($required|Where-Object {$null -eq $form[$_]}).Count -eq 0
 }elseif($p.text.Contains('上传AI歌曲')){$mode='intake'}
 return @{binding=$script:bind;identity=$script:identity;observedAt=[DateTime]::UtcNow.ToString('o');route=$p.url;mode=$mode;modeText=if($mode -eq 'ai_authorization'){'非独家授权；授权3年，期间歌曲不可独家授权其他平台'}else{$mode};termsText=$terms;visibleSubmitButton=@($p.nodes|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and ([string]$_.Current.Name).Trim() -cin @('提交','提交审核') -and -not $_.Current.IsOffscreen}).Count -eq 1;form=$form;coverState=(Get-ManualCoverState $p.nodes $p.text);saveEvidence=$script:saveEvidence}
}

function Pick-File([string]$file){
 $proof=Wait-NativeReadback -Read {Picker-Proof} -Ready {param($v)$null -ne $v} -TimeoutMs 5000 -FailureCode 'OWNED_FILE_PICKER_REQUIRED' -TransientErrors @('OWNED_FILE_PICKER_NOT_READY','PICKER_ADDRESS_NOT_READY')
 $fg=[IntPtr][long]$proof.handle;$dlg=[Windows.Automation.AutomationElement]::FromHandle($fg)
 if($request.action -eq 'resume_cover_picker' -and $proof.handle -cne $request.dialogHandle){throw 'PICKER_HANDLE_CHANGED'}
 [void][RainfallAiInput]::SetForegroundWindow($fg);Start-Sleep -Milliseconds 120
 if([RainfallAiInput]::GetForegroundWindow() -ne $fg){throw 'PICKER_FOREGROUND_REQUIRED'}
 if($dlg.Current.Name -ne '打开' -or [RainfallAiInput]::GetWindow($fg,4) -ne [IntPtr][long]$script:bind.handle){throw 'OWNED_FILE_PICKER_REQUIRED'}
 $address=@((Nodes $dlg)|Where-Object {$_.Current.AutomationId -ceq '1001' -and ([string]$_.Current.Name).StartsWith('地址: ')})
 if($address.Count -ne 1){throw 'PICKER_ADDRESS_CONTROL_REQUIRED'}
 $expectedDir=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($file));$actualDir=$address[0].Current.Name.Substring(4)
 if($actualDir.TrimEnd('\') -cne $expectedDir.TrimEnd('\')){
  if([RainfallAiInput]::GetForegroundWindow() -ne $fg){throw 'PICKER_FOCUS_CHANGED'}
  [RainfallAiInput]::Key(18,$false);[RainfallAiInput]::Key(68,$false);[RainfallAiInput]::Key(68,$true);[RainfallAiInput]::Key(18,$true)
  [RainfallAiInput]::Text($expectedDir);[RainfallAiInput]::Key(13,$false);[RainfallAiInput]::Key(13,$true)
  $currentPicker=Wait-NativeReadback -Read {
   if([RainfallAiInput]::GetForegroundWindow() -ne $fg){throw 'PICKER_FOCUS_CHANGED'}
   $current=Picker-Proof;if($current.handle -cne $proof.handle){throw 'PICKER_HANDLE_CHANGED'};return $current
  } -Ready {param($v)$v.actualDirectory.TrimEnd('\') -ceq $expectedDir.TrimEnd('\')} -TimeoutMs 4000 -FailureCode 'PICKER_DIRECTORY_READBACK_REQUIRED' -TransientErrors @('PICKER_ADDRESS_NOT_READY')
  $actualDir=$currentPicker.actualDirectory
 }
 if($actualDir.TrimEnd('\') -cne $expectedDir.TrimEnd('\')){throw 'PICKER_DIRECTORY_READBACK_REQUIRED'}
 $dlg=[Windows.Automation.AutomationElement]::FromHandle($fg);$base=[IO.Path]::GetFileName($file)
 $items=@((Nodes $dlg)|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::ListItem -and $_.Current.Name -ceq $base})
 if($items.Count -ne 1){throw 'EXACT_FILE_LIST_ITEM_REQUIRED'}
 $items[0].GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Select();if([RainfallAiInput]::GetForegroundWindow() -ne $fg){throw 'PICKER_FOCUS_CHANGED'}
 $items[0].GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke();Start-Sleep -Milliseconds 600
 if([RainfallAiInput]::GetForegroundWindow() -eq $fg){throw 'PICKER_DID_NOT_CLOSE'}
 return @{selectedPath=[IO.Path]::Combine($actualDir,$base);selectedName=$base;actualDirectory=$actualDir;dialogOwner=$script:bind.handle;selectedAt=[DateTime]::UtcNow.ToString('o')}
}
function Picker-Proof {
 $dialogs=@((Nodes $script:root)|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Window -and $_.Current.Name -ceq '打开'})
 if($dialogs.Count -eq 0){throw 'OWNED_FILE_PICKER_NOT_READY'}
 if($dialogs.Count -ne 1){throw 'OWNED_FILE_PICKER_REQUIRED'}
 $dlg=$dialogs[0];$fg=[IntPtr]$dlg.Current.NativeWindowHandle
 if($dlg.Current.Name -ne '打开' -or [RainfallAiInput]::GetWindow($fg,4) -ne [IntPtr][long]$script:bind.handle){throw 'OWNED_FILE_PICKER_REQUIRED'}
 if((Get-Process -Id $dlg.Current.ProcessId).ProcessName -notin @('chrome','msedge')){throw 'PICKER_BROWSER_PROCESS_REQUIRED'}
 $nodes=Nodes $dlg
 $selected=@(foreach($n in $nodes){if($n.Current.ControlType -ne [Windows.Automation.ControlType]::ListItem){continue};$p=$null;if($n.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern,[ref]$p) -and $p.Current.IsSelected){$n.Current.Name}})
 if([RainfallAiInput]::ReadVisibleFilename($fg)){throw 'PICKER_FILENAME_NOT_EMPTY'}
 if($selected.Count){throw 'PICKER_SELECTION_ALREADY_PRESENT'}
 # Safety failures are permanent even while Shell is still exposing its address control.
 $address=@($nodes|Where-Object {$_.Current.AutomationId -ceq '1001' -and ([string]$_.Current.Name).StartsWith('地址: ')})
 if($address.Count -eq 0){throw 'PICKER_ADDRESS_NOT_READY'}
 if($address.Count -ne 1){throw 'PICKER_ADDRESS_CONTROL_REQUIRED'}
 return @{handle=[string]$fg.ToInt64();owner=$script:bind.handle;pid=$dlg.Current.ProcessId;name='打开';actualDirectory=$address[0].Current.Name.Substring(4);selectedFileName=$null}
}
function Crop-Proof {
 $p=Page;if($p.url -notmatch '^https://y\.tencentmusic\.com/#/user/manage/aiChoose/add(?:\?|$)'){throw 'AI_ROUTE_CHANGED'}
 $heads=@((Get-CoverUiEvidence $p.nodes).cropHeadings)
 if($heads.Count -ne 1){throw 'CROP_DIALOG_SCOPE_REQUIRED'}
 $group=Control-Parent $heads[0]
 if($group.Current.ControlType -ne [Windows.Automation.ControlType]::Group){throw 'CROP_DIALOG_SCOPE_REQUIRED'}
 $children=Nodes $group;$confirm=@($children|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and ([string]$_.Current.Name).Trim() -ceq '确认' -and -not $_.Current.IsOffscreen});$images=@($children|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Image})
 if($confirm.Count -ne 1 -or $images.Count -lt 1 -or @($children|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and ([string]$_.Current.Name).Trim() -ceq '更换图片'}).Count -ne 1){throw 'CROP_DIALOG_SCOPE_REQUIRED'}
 return @{groupId=($group.GetRuntimeId()-join '.');heading='调整图片';confirmName='确认';imageCount=$images.Count}
}
function Wait-ManualCover([int]$TimeoutMs=6000){
 # A stable visible UI readback is not proof of a remote save or of remote file bytes.
 return Wait-NativeReadback -Read {Form} -Ready {param($v)$v.mode -ceq 'editor' -and $v.coverState.manualSelected -eq $true -and $v.coverState.generatorBanner -eq $false} -TimeoutMs $TimeoutMs -FailureCode 'MANUAL_COVER_ACCEPTANCE_REQUIRED' -ConsecutiveReady 3
}
function Confirm-Crop([string]$expectedGroup='',[int]$TimeoutMs=6000){
 $proof=Crop-Proof;if($expectedGroup -and $proof.groupId -cne $expectedGroup){throw 'CROP_GROUP_CHANGED'}
 $p=Page;$group=@($p.nodes|Where-Object {($_.GetRuntimeId()-join '.') -ceq $proof.groupId})
 if($group.Count -ne 1){throw 'CROP_GROUP_CHANGED'}
 Invoke-Node (Unique (Nodes $group[0]) '确认' 'Button')
 # Never retry this mutation, even on timeout. Return the accepted observation itself.
 return Wait-ManualCover -TimeoutMs $TimeoutMs
}
try{
 if($request.action -notin @('inspect','observe','step','inspect_picker','resume_cover_picker','locate_cover_picker','inspect_crop','confirm_existing_crop')){throw 'ACTION_NOT_ALLOWED'}
 Bind;Identity
 $receipt=$null;$acceptedSnapshot=$null;$status='verified_existing';$step=$request.step;$snap=Form
 if($request.action -eq 'inspect_crop'){
  @{ok=$true;value=@{snapshot=$snap;crop=(Crop-Proof)}}|ConvertTo-Json -Depth 20 -Compress;exit
 }
 if($request.action -eq 'confirm_existing_crop'){
  $snap=Confirm-Crop $request.groupId
  @{ok=$true;value=@{snapshot=$snap;status='applied'}}|ConvertTo-Json -Depth 20 -Compress;exit
 }
 if($request.action -in @('inspect_picker','locate_cover_picker')){
  $picker=Picker-Proof
  if($request.action -eq 'locate_cover_picker'){
   if($picker.handle -cne $request.dialogHandle){throw 'PICKER_HANDLE_CHANGED'}
   $fg=[IntPtr][long]$picker.handle;[void][RainfallAiInput]::SetForegroundWindow($fg);Start-Sleep -Milliseconds 100
   if([RainfallAiInput]::GetForegroundWindow() -ne $fg){throw 'PICKER_FOREGROUND_REQUIRED'}
   # Navigate only the Shell address; do not select a file or invoke Open.
   [RainfallAiInput]::Key(18,$false);[RainfallAiInput]::Key(68,$false);[RainfallAiInput]::Key(68,$true);[RainfallAiInput]::Key(18,$true)
   [RainfallAiInput]::Text([IO.Path]::GetDirectoryName($request.coverPath));[RainfallAiInput]::Key(13,$false);[RainfallAiInput]::Key(13,$true);Start-Sleep -Milliseconds 400
   $picker=Picker-Proof
  }
  @{ok=$true;value=@{snapshot=$snap;dialog=$picker}}|ConvertTo-Json -Depth 20 -Compress
  exit
 }
 if($request.action -eq 'resume_cover_picker'){
  $proof=Picker-Proof;if($proof.handle -cne $request.dialogHandle){throw 'PICKER_HANDLE_CHANGED'}
  $step='set_cover'
 }
 if($request.action -in @('step','resume_cover_picker')){
  if($step -notin @('locate_intake','upload_audio','fill_metadata','set_cover','save_album','advance_to_terms')){throw 'ACTION_NOT_ALLOWED'}
  if($snap.mode -notin @('editor','intake')){throw 'AI_EDITOR_REQUIRED'}
  if($step -in @('fill_metadata','set_cover','save_album','advance_to_terms') -and $snap.form.metadataExpanded -ne $true){throw 'METADATA_FIELDS_NOT_EXPANDED'}
  $m=$request.metadata
  switch($step){
   'locate_intake' {if($snap.form -and $snap.form.title -cne $m.title){throw 'DIFFERENT_WORK_IN_EDITOR'}}
   'upload_audio' {
    if($request.expectedAudioDuration -notmatch '^\d{2,}:\d{2}$'){throw 'AUDIO_DURATION_REQUIRED'}
    if($snap.form){if(-not $snap.form.text.Contains([IO.Path]::GetFileName($request.audioPath)) -or -not $snap.form.text.Contains($request.expectedAudioDuration) -or $snap.form.title -cne $m.title){throw 'EXISTING_AUDIO_SCOPE_UNVERIFIABLE'}}
    else{Foreground;Click-Node (Resolve-AudioUploadControl (Page).nodes);$receipt=Pick-File $request.audioPath;$status='applied';for($i=0;$i -lt 60;$i++){Start-Sleep -Milliseconds 500;$snap=Form;if($snap.form -and $snap.form.text.Contains([IO.Path]::GetFileName($request.audioPath))){break}};if(-not $snap.form){throw 'AUDIO_UPLOAD_READBACK_REQUIRED'}}
   }
   'fill_metadata' {
    Set-Value '请输入歌曲名称' $m.title -Prefix;Set-Value '请选择或填写您的生成工具名称' $m.aiTool;Set-Value '10-20000字' $request.lyricsText -Prefix
    Set-Value '请输入专辑名称' $m.albumTitle -Prefix;Set-Value '请输入10-2000字' $m.albumDescription
    foreach($pair in @(@('我是作词人',$m.ownLyrics),@('我是作曲人',$m.ownComposition))){
     $n=Unique (Page).nodes $pair[0] 'CheckBox';$p=$n.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern)
     if(($p.Current.ToggleState -eq [Windows.Automation.ToggleState]::On) -ne $pair[1]){$p.Toggle()}
     $null=Wait-NativeReadback -Read {(Unique (Page).nodes $pair[0] 'CheckBox').GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern).Current.ToggleState -eq [Windows.Automation.ToggleState]::On} -Ready {param($v)$v -eq $pair[1]} -TimeoutMs 2500 -FailureCode 'TOGGLE_READBACK_REQUIRED'
    }
    # Existing committed calendar/choice values are verified below; a differing custom widget is not blindly overwritten.
    $snap=Form
    if($snap.form.generatedOn -cne $m.generatedOn -or $snap.form.genre -cne $m.genre -or $snap.form.language -cne $m.language -or $snap.form.albumLanguage -cne $m.language -or $snap.form.albumGenre -cne $m.genre -or $snap.form.albumType -cne '录音室专辑' -or -not $snap.form.version -or -not $snap.form.releaseMode -or $snap.form.allowCover -ne $m.allowCover){throw 'CUSTOM_CHOICE_EDIT_CONTRACT_REQUIRED'}
   }
   'set_cover' {
    if($request.action -ne 'resume_cover_picker'){
     $currentPage=Page;if((Get-CoverUiEvidence $currentPage.nodes).cropVisible){throw 'CROP_COMPLETION_REQUIRED'}
     Foreground;Click-Node (Resolve-CoverUploadControl $currentPage.nodes)
    }
    $receipt=Pick-File $request.coverPath;$status='applied'
    # The old editor may already display a manual cover. It cannot prove this selection.
    # Require the new crop phase; without it stop rather than certify the old image.
    $null=Wait-NativeReadback -Read {(Get-CoverUiEvidence (Page).nodes).cropVisible} -Ready {param($v)$v -eq $true} -TimeoutMs 6000 -FailureCode 'CROP_COMPLETION_REQUIRED'
    $snap=Confirm-Crop
    $acceptedSnapshot=$snap
   }
   'save_album' {
    $snap=Wait-ManualCover
    # Retained step name for journal compatibility: only a local material snapshot.
    # The optional official Save button is deliberately not invoked or retried.
    $script:saveEvidence=@{source='local_material_snapshot';text='已核对专辑材料，留存本地快照；未断言官网保存成功';remoteSavedVerified=$false;observedAt=[DateTime]::UtcNow.ToString('o')}
    $snap.saveEvidence=$script:saveEvidence;$acceptedSnapshot=$snap
    $status='verified_existing'
   }
   'advance_to_terms' {
    Invoke-Name '下一步';$status='applied'
    for($i=0;$i -lt 40;$i++){Start-Sleep -Milliseconds 200;$snap=Form;if($snap.mode -eq 'ai_authorization' -and $snap.visibleSubmitButton){break}}
    if($snap.mode -ne 'ai_authorization' -or -not $snap.visibleSubmitButton){throw 'TERMS_PREVIEW_REQUIRED'}
   }
  }
 }
 $snap=if($null -ne $acceptedSnapshot){$acceptedSnapshot}else{Form}
 @{ok=$true;value=@{snapshot=$snap;status=$status;receipt=$receipt}}|ConvertTo-Json -Depth 20 -Compress
}catch{
 $code=$_.Exception.Message;if($code -notmatch '^[A-Z0-9_]+$'){$code='NATIVE_CONTROL_CONTRACT_FAILED'}
 @{ok=$false;error=$code;diagnostic=@{exceptionType=$_.Exception.GetType().FullName;message=$_.Exception.Message;line=$_.InvocationInfo.ScriptLineNumber;category=[string]$_.CategoryInfo.Category}}|ConvertTo-Json -Compress
}
