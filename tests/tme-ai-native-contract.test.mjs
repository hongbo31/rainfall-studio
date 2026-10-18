import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const dir=path.resolve('output/tme-ai-native-contract');fs.mkdirSync(dir,{recursive:true});
const runner=path.join(dir,'probe.ps1');
fs.writeFileSync(runner,String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new();[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$data=[Console]::In.ReadToEnd()|ConvertFrom-Json -DateKind String
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PWD 'src/main/tme/ai-uia-host.ps1'),[ref]$null,[ref]$null)
# Load definitions only; entrypoint replays below stub all live bindings and mutation calls.
foreach($f in $ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)){Invoke-Expression $f.Extent.Text}
$productionPage=(Get-Item Function:Page).ScriptBlock
$script:fixtureNodes=@();$lookup=@{}
foreach($row in @($data.nodes)){
 if($null -eq $row){continue}
 $ctype=[Windows.Automation.ControlType].GetField([string]$row.type).GetValue($null)
 $n=[pscustomobject]@{Id=[int]$row.id;ParentId=$row.parentId;Parent=$null;Value=$row.value;Text=$row.text;Selected=[bool]$row.selected;On=[bool]$row.on;HasToggle=($null -ne $row.PSObject.Properties['on']);Current=[pscustomobject]@{Name=[string]$row.name;ControlType=$ctype;IsEnabled=($row.enabled -ne $false);IsOffscreen=($row.offscreen -eq $true)}}
 $n|Add-Member ScriptMethod GetRuntimeId {return [int[]]@($this.Id)}
 $n|Add-Member ScriptMethod GetCurrentPattern {param($pattern)
  if($pattern.Id -eq [Windows.Automation.ValuePattern]::Pattern.Id){return [pscustomobject]@{Current=[pscustomobject]@{Value=$this.Value;IsReadOnly=$false}}}
  if($pattern.Id -eq [Windows.Automation.TextPattern]::Pattern.Id){$range=[pscustomobject]@{Text=$this.Text};$range|Add-Member ScriptMethod GetText {param($limit)return [string]$this.Text};return [pscustomobject]@{DocumentRange=$range}}
  if($pattern.Id -eq [Windows.Automation.SelectionItemPattern]::Pattern.Id){return [pscustomobject]@{Current=[pscustomobject]@{IsSelected=$this.Selected}}}
  if($pattern.Id -eq [Windows.Automation.TogglePattern]::Pattern.Id){return [pscustomobject]@{Current=[pscustomobject]@{ToggleState=if($this.On){[Windows.Automation.ToggleState]::On}else{[Windows.Automation.ToggleState]::Off}}}}
  throw 'UNSUPPORTED_TEST_PATTERN'
 }
 $n|Add-Member ScriptMethod TryGetCurrentPattern {param($pattern,[ref]$result)
  if($this.Current.ControlType -eq [Windows.Automation.ControlType]::Document -and $pattern.Id -eq [Windows.Automation.ValuePattern]::Pattern.Id){$result.Value=$this.GetCurrentPattern($pattern);return $true}
  if($this.Current.ControlType -eq [Windows.Automation.ControlType]::ListItem -and $pattern.Id -eq [Windows.Automation.SelectionItemPattern]::Pattern.Id){$result.Value=$this.GetCurrentPattern($pattern);return $true}
  if($this.HasToggle -and $this.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and $pattern.Id -eq [Windows.Automation.TogglePattern]::Pattern.Id){$result.Value=$this.GetCurrentPattern($pattern);return $true};return $false
 }
 $lookup[[string]$row.id]=$n;$script:fixtureNodes+=,$n
}
foreach($n in $script:fixtureNodes){if($null -ne $n.ParentId){$n.Parent=$lookup[[string]$n.ParentId]}}
function Control-Parent($node){return $node.Parent}
function Nodes($root){return @($script:fixtureNodes|Where-Object {$candidate=$_;$ancestor=$candidate.Parent;$seen=@{};while($null -ne $ancestor){if($ancestor.Id -eq $root.Id){return $true};if($seen.ContainsKey([string]$ancestor.Id)){return $false};$seen[[string]$ancestor.Id]=$true;$ancestor=$ancestor.Parent};return $false})}
function Page {return @{url=$(if($data.route){[string]$data.route}else{'https://y.tencentmusic.com/#/user/manage/aiChoose/add'});nodes=$script:fixtureNodes;text=[string]$data.text}}
$script:bind=@{pid=1;handle='1';documentId='fixture'};$script:identity=@{artistName='fixture'}
$script:reads=0
try{
 switch($data.action){
  'wait' {
   if(-not (Get-Command Wait-NativeReadback -ErrorAction SilentlyContinue)){throw 'MISSING_WAIT_NATIVE_READBACK'}
   $value=Wait-NativeReadback -Read { $script:reads++;if($data.permanentError){throw [string]$data.permanentError};if($data.transientError -and $script:reads -lt $data.readyAfter){throw [string]$data.transientError};if(-not $data.neverReady -and $script:reads -ge $data.readyAfter){return 'ready'};return 'loading'} -Ready {param($v)$v -ceq 'ready'} -TimeoutMs $(if($data.timeoutMs){[int]$data.timeoutMs}else{1200}) -FailureCode 'READBACK_TIMEOUT' -TransientErrors @('OWNED_FILE_PICKER_NOT_READY')
   @{ok=$true;value=$value;reads=$script:reads}|ConvertTo-Json -Compress
  }
  'unique-radio' {$node=Unique $script:fixtureNodes '完整版' 'RadioButton';@{ok=$true;id=$node.Id}|ConvertTo-Json -Compress}
  'outer' {if(-not (Get-Command Select-OuterControl -ErrorAction SilentlyContinue)){throw 'MISSING_SELECT_OUTER_CONTROL'};$node=Select-OuterControl -Candidates $script:fixtureNodes -Parent {param($n)Control-Parent $n};@{ok=$true;id=$node.Id}|ConvertTo-Json -Compress}
  'cover-state' {if(-not (Get-Command Get-ManualCoverState -ErrorAction SilentlyContinue)){throw 'MISSING_MANUAL_COVER_STATE'};@{ok=$true;state=(Get-ManualCoverState $script:fixtureNodes ([string]$data.text))}|ConvertTo-Json -Depth 8 -Compress}
  'cover-control' {if(-not (Get-Command Resolve-CoverUploadControl -ErrorAction SilentlyContinue)){throw 'MISSING_COVER_CONTROL_RESOLVER'};$node=Resolve-CoverUploadControl $script:fixtureNodes;@{ok=$true;id=$node.Id}|ConvertTo-Json -Compress}
  'form' {@{ok=$true;snapshot=(Form)}|ConvertTo-Json -Depth 12 -Compress}
  'crop-proof' {@{ok=$true;proof=(Crop-Proof)}|ConvertTo-Json -Depth 8 -Compress}
  'confirm-crop' {
   $script:invocations=0
   function Invoke-Node($node){$script:invocations++}
   function Form {
    $script:reads++
    if($data.permanentError){throw [string]$data.permanentError}
    $ready=if($data.sequence){[bool]$data.sequence[[Math]::Min($script:reads-1,$data.sequence.Count-1)]}else{$false}
    return @{mode='editor';coverState=@{manualSelected=$ready;generatorBanner=(-not $ready)};observedAt=[string]$script:reads}
   }
   try{$snapshot=Confirm-Crop -expectedGroup $(if($data.groupId){[string]$data.groupId}else{'100'}) -TimeoutMs $(if($data.timeoutMs){[int]$data.timeoutMs}else{1200});@{ok=$true;snapshot=$snapshot;invocations=$script:invocations;reads=$script:reads}|ConvertTo-Json -Depth 8 -Compress}
   catch{@{ok=$false;error=$_.Exception.Message;invocations=$script:invocations;reads=$script:reads}|ConvertTo-Json -Compress}
  }
  'page-documents' {
   $script:root=[pscustomobject]@{}
   $script:root|Add-Member ScriptMethod FindAll {param($scope,$condition)return @($script:fixtureNodes|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Document})}
   $script:strictDocument=($data.strict -eq $true);$script:bind.documentId=[string]$data.boundId
   $p=& $productionPage
   @{ok=$true;id=$p.doc.Id;url=$p.url;text=$p.text}|ConvertTo-Json -Compress
  }
  'cover-entrypoint' {
   $request=[pscustomobject]@{action='step';step='set_cover';coverPath='C:\fixture\cover.jpg'}
   function Bind {};function Identity {};function Foreground {}
   function Click-Node {throw 'TEST_COVER_CLICK'}
   $entry=@($ast.EndBlock.Statements|Where-Object {$_ -is [System.Management.Automation.Language.TryStatementAst]})[-1]
   Invoke-Expression $entry.Extent.Text
  }
  'cover-flow' {
   $request=[pscustomobject]@{action='step';step='set_cover';coverPath='C:\fixture\cover.jpg'}
   $script:selections=0;$script:invocations=0;$script:pageReads=0;$script:waitingCrop=$false
   function Bind {};function Identity {};function Foreground {};function Click-Node {}
   function Pick-File($file){$script:selections++;$script:waitingCrop=$true;return @{selectedPath=$file}}
   function Page {
    $script:pageReads++
    $show=$script:waitingCrop -and -not $data.noCrop -and $script:pageReads -ge 4
    return @{url='https://y.tencentmusic.com/#/user/manage/aiChoose/add';nodes=$(if($show){$script:fixtureNodes}elseif($script:selections -eq 0){@([pscustomobject]@{Current=[pscustomobject]@{ControlType=[Windows.Automation.ControlType]::Button;Name='更换图片';IsEnabled=$true;IsOffscreen=$false}})}else{@()});text=''}
   }
   function Invoke-Node($node){$script:invocations++;$script:waitingCrop=$false}
   function Form {
    return @{mode='editor';form=@{metadataExpanded=$true};coverState=@{manualSelected=$true;generatorBanner=$false};test=@{selections=$script:selections;confirmations=$script:invocations;pageReads=$script:pageReads}}
   }
   $productionWait=(Get-Item Function:Wait-NativeReadback).ScriptBlock
   function Wait-NativeReadback {param($Read,$Ready,$TimeoutMs,$FailureCode,$TransientErrors=@(),$ConsecutiveReady=1);return & $productionWait -Read $Read -Ready $Ready -TimeoutMs 500 -FailureCode $FailureCode -TransientErrors $TransientErrors -ConsecutiveReady $ConsecutiveReady}
   $entry=@($ast.EndBlock.Statements|Where-Object {$_ -is [System.Management.Automation.Language.TryStatementAst]})[-1]
   $result=(Invoke-Expression $entry.Extent.Text)|ConvertFrom-Json
   $result|Add-Member -NotePropertyName test -NotePropertyValue @{selections=$script:selections;confirmations=$script:invocations}
   $result|ConvertTo-Json -Depth 20 -Compress
  }
  'partial-metadata-step' {
   $request=[pscustomobject]@{action='step';step='fill_metadata';metadata=@{title='示例歌名'}}
   function Bind {};function Identity {};function Form {return @{mode='editor';form=@{title='示例歌名';metadataExpanded=$false}}}
   function Set-Value {throw 'UNEXPECTED_METADATA_WRITE'}
   $entry=@($ast.EndBlock.Statements|Where-Object {$_ -is [System.Management.Automation.Language.TryStatementAst]})[-1]
   Invoke-Expression $entry.Extent.Text
  }
  'upload-entrypoint' {
   $request=[pscustomobject]@{action='step';step='upload_audio';metadata=@{title='示例歌曲'};expectedAudioDuration='02:55';audioPath='C:\fixture\示例歌曲.wav'}
   function Bind {};function Identity {};function Foreground {}
   function Resolve-AudioUploadControl {return 'fixture-upload'}
   function Click-Node {throw 'TEST_UPLOAD_CLICK'}
   $entry=@($ast.EndBlock.Statements|Where-Object {$_ -is [System.Management.Automation.Language.TryStatementAst]})[-1]
   Invoke-Expression $entry.Extent.Text
  }
  'picker-proof-wait' {
   # Safe stand-in for only the two read-only native calls used by Picker-Proof.
   Add-Type 'public static class RainfallAiInput { public static string Filename=""; public static System.IntPtr GetWindow(System.IntPtr h,uint command){return new System.IntPtr(1);} public static string ReadVisibleFilename(System.IntPtr h){return Filename;} }'
   $script:root='fixture-root'
   $script:dialog=[pscustomobject]@{Current=[pscustomobject]@{ControlType=[Windows.Automation.ControlType]::Window;Name='打开';NativeWindowHandle=2;ProcessId=123}}
   function Get-Process {param($Id)return [pscustomobject]@{ProcessName='chrome'}}
   function Nodes($root){
    if($root -is [string]){return @($script:dialog)}
    $script:reads++;[RainfallAiInput]::Filename=if($script:reads -eq 1){[string]$data.initialFilename}else{''}
    $items=@($script:fixtureNodes)
    if($script:reads -gt 1){foreach($item in $items){$item.Selected=$false}}
    if($script:reads -ge 2){$items+=,[pscustomobject]@{Current=[pscustomobject]@{ControlType=[Windows.Automation.ControlType]::ToolBar;AutomationId='1001';Name='地址: C:\fixture'}}}
    return $items
   }
   $value=Wait-NativeReadback -Read {Picker-Proof} -Ready {param($v)$null -ne $v} -TimeoutMs 1200 -FailureCode 'READBACK_TIMEOUT' -TransientErrors @('PICKER_ADDRESS_NOT_READY')
   @{ok=$true;value=$value;reads=$script:reads}|ConvertTo-Json -Depth 8 -Compress
  }
  default {throw 'UNEXPECTED_TEST_ACTION'}
 }
}catch{@{ok=$false;error=$_.Exception.Message;reads=$script:reads}|ConvertTo-Json -Compress}
`);
function probe(input){const r=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',runner],{input:JSON.stringify(input),encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.replace(/^\uFEFF/,''));}
const node=(id,type,name,extra={})=>({id,type,name,enabled:true,offscreen:false,...extra});

test('readback waits for a delayed observable value instead of failing immediately',()=>{
 const r=probe({action:'wait',readyAfter:3});assert.equal(r.ok,true,r.error);assert.equal(r.value,'ready');assert.equal(r.reads,3);
});
test('only explicitly transient absence may be retried while awaiting a picker',()=>{
 const r=probe({action:'wait',readyAfter:3,transientError:'OWNED_FILE_PICKER_NOT_READY'});assert.equal(r.ok,true,r.error);assert.equal(r.value,'ready');
});
test('unsafe picker errors abort immediately rather than being polled away',()=>{
 for(const permanentError of ['PICKER_BROWSER_PROCESS_REQUIRED','PICKER_FILENAME_NOT_EMPTY','PICKER_SELECTION_ALREADY_PRESENT','OWNED_FILE_PICKER_REQUIRED']){
  const r=probe({action:'wait',readyAfter:4,permanentError});assert.equal(r.ok,false);assert.equal(r.error,permanentError);assert.equal(r.reads,1);
 }
});
test('a readback that never becomes ready has a bounded explicit timeout',()=>{
 const r=probe({action:'wait',readyAfter:2,neverReady:true,timeoutMs:40});assert.equal(r.ok,false);assert.equal(r.error,'READBACK_TIMEOUT');
});
test('one selected native radio mirrored inside its wrapper resolves to the outer control',()=>{
 const r=probe({action:'unique-radio',nodes:[node(19,'RadioButton',' 完整版',{selected:true}),node(16,'RadioButton','完整版',{parentId:19,selected:true})]});assert.deepEqual(r,{ok:true,id:19});
});
test('independent same-name radio controls remain ambiguous',()=>{
 const r=probe({action:'unique-radio',nodes:[node(19,'RadioButton',' 完整版'),node(26,'RadioButton','完整版')]});assert.equal(r.ok,false);assert.equal(r.error,'CONTROL_NOT_UNIQUE');
});
test('a nested toggle mirror has one outer root but independent toggles do not',()=>{
 const nodes=[node(78,'Button','',{on:false}),node(76,'Button','',{parentId:78,on:false})];assert.deepEqual(probe({action:'outer',nodes}),{ok:true,id:78});
 const r=probe({action:'outer',nodes:nodes.map(n=>({...n,parentId:null}))});assert.equal(r.ok,false);assert.equal(r.error,'CONTROL_NOT_UNIQUE');
});

for(const label of ['更换图片'])test('manual cover accepts the exact supported button label '+label,()=>{
 const r=probe({action:'cover-state',nodes:[node(1,'Button',label),node(2,'Button','智能封面')],text:'专辑封面'});assert.equal(r.ok,true,r.error);assert.equal(r.state.manualSelected,true);
});
test('crop dialog, generator banner, or decorative replacement text cannot prove manual cover completion',()=>{
 const cases=[
  {nodes:[node(1,'Button','更换图片'),node(2,'Button','智能封面'),node(3,'Text','调整图片')],text:'调整图片'},
  {nodes:[node(1,'Button','更换图片'),node(2,'Button','智能封面'),node(3,'Text','已为您生成智能专辑封面')],text:'已为您生成智能专辑封面'},
  {nodes:[node(1,'Text','更换图片'),node(2,'Button','智能封面')],text:''},
  {nodes:[node(1,'Button','更换图片'),node(2,'Button','更换图片'),node(3,'Button','智能封面')],text:''},
  {nodes:[node(1,'Button','修改图片'),node(2,'Button','智能封面')],text:''},
 ];for(const c of cases){const r=probe({action:'cover-state',...c});assert.equal(r.ok,true,r.error);assert.equal(r.state.manualSelected,false);}
});
test('cover selection uses one exact supported button and refuses independent ambiguity',()=>{
 for(const label of ['上传图片','更换图片'])assert.deepEqual(probe({action:'cover-control',nodes:[node(8,'Button',label)]}),{ok:true,id:8});
 for(const nodes of [[node(8,'Button','更换图片'),node(9,'Button','更换图片')],[node(8,'Button','修改图片')]]){const r=probe({action:'cover-control',nodes});assert.equal(r.ok,false);assert.equal(r.error,'COVER_UPLOAD_CONTROL_NOT_UNIQUE');}
});

const partialNodes=[node(1,'Edit','请输入歌曲名称，最多60字',{value:'示例歌名'}),node(2,'Edit','请选择曲风',{value:'流行'}),node(3,'RadioButton',' 完整版',{selected:true}),node(4,'RadioButton','完整版',{parentId:3,selected:true})];
const fullNodes=[...partialNodes,
 node(10,'Edit','10-20000字',{value:'示例歌词'}),node(11,'Edit','请选择或填写您的生成工具名称',{value:'示例工具'}),node(12,'Edit','请选择生成时间',{value:'2026-10-17'}),node(13,'Edit','请选择语种',{value:'国语'}),node(14,'Edit','请选择语种',{value:'国语'}),node(15,'Edit','请输入专辑名称，最多60字符',{value:'示例专辑'}),node(16,'Edit','请输入10-2000字',{value:'示例简介'}),node(17,'Edit','请选择流派',{value:'流行'}),node(18,'Edit','请选择专辑类型',{value:'录音室专辑'}),node(19,'CheckBox','我是作词人',{on:true}),node(20,'CheckBox','我是作曲人',{on:true}),node(21,'Button','',{on:false}),node(22,'Button','',{parentId:21,on:false}),node(23,'RadioButton','审核通过即发布',{selected:true}),node(24,'Button','更换图片'),node(25,'Button','智能封面')];
test('uploaded partial card remains readable without pretending metadata is expanded',()=>{
 const r=probe({action:'form',nodes:partialNodes,text:'上传AI歌曲 ( 1首 ) 示例歌名.wav 02:55'});assert.equal(r.ok,true,r.error);assert.equal(r.snapshot.mode,'editor');assert.equal(r.snapshot.form.title,'示例歌名');assert.equal(r.snapshot.form.metadataExpanded,false);assert.equal(r.snapshot.form.lyrics,null);assert.equal(r.snapshot.form.version,true);
});
test('expanded metadata reads nested radio and toggle mirrors without discarding explicit false values',()=>{
 const r=probe({action:'form',nodes:fullNodes,text:'上传AI歌曲 ( 1首 ) 示例歌名.wav 02:55'});assert.equal(r.ok,true,r.error);assert.equal(r.snapshot.form.metadataExpanded,true);assert.equal(r.snapshot.form.lyrics,'示例歌词');assert.equal(r.snapshot.form.allowCover,false);assert.equal(r.snapshot.form.version,true);assert.equal(r.snapshot.form.releaseMode,true);assert.equal(r.snapshot.coverState.manualSelected,true);
});
test('more than two language inputs remain an ambiguous form rather than arbitrary indexing',()=>{
 const r=probe({action:'form',nodes:[...fullNodes,node(99,'Edit','请选择语种',{value:'英语'})],text:'上传AI歌曲'});assert.equal(r.ok,false);assert.equal(r.error,'CONTROL_NOT_UNIQUE');
});
test('partial metadata step stops before any field mutation in the actual native entrypoint',()=>{
 const r=probe({action:'partial-metadata-step'});assert.equal(r.ok,false);assert.equal(r.error,'METADATA_FIELDS_NOT_EXPANDED');
});

test('ambiguous and collapsed existing song cards cannot reach another upload click',()=>{
 const cases=[
  {nodes:[...partialNodes,node(99,'Edit','请输入歌曲名称，最多60字',{value:'另一首'})],text:'上传AI歌曲 ( 2首 )',error:'CONTROL_NOT_UNIQUE'},
  {nodes:[node(80,'Text','更换音频')],text:'上传AI歌曲',error:'EXISTING_AUDIO_SCOPE_UNVERIFIABLE'},
  {nodes:[],text:'上传AI歌曲 ( 1首 )',error:'EXISTING_AUDIO_SCOPE_UNVERIFIABLE'},
  {nodes:[node(80,'Text','曲目1')],text:'上传AI歌曲',error:'EXISTING_AUDIO_SCOPE_UNVERIFIABLE'},
 ];for(const c of cases){const r=probe({action:'upload-entrypoint',...c});assert.equal(r.ok,false);assert.equal(r.error,c.error);}
});
test('a genuine empty intake can reach its one controlled upload click',()=>{
 const r=probe({action:'upload-entrypoint',nodes:[],text:'上传AI歌曲 ( 0首 )'});assert.equal(r.ok,false);assert.equal(r.error,'TEST_UPLOAD_CLICK');
});
test('production picker proof rejects unsafe filename before waiting for missing address',()=>{
 const r=probe({action:'picker-proof-wait',initialFilename:'existing.wav'});assert.equal(r.ok,false);assert.equal(r.error,'PICKER_FILENAME_NOT_EMPTY');assert.equal(r.reads,1);
});
test('production picker proof rejects preselection before waiting for missing address',()=>{
 const r=probe({action:'picker-proof-wait',nodes:[node(1,'ListItem','existing.wav',{selected:true})]});assert.equal(r.ok,false);assert.equal(r.error,'PICKER_SELECTION_ALREADY_PRESENT');assert.equal(r.reads,1);
});
test('production picker proof may await a missing address only when all safety checks pass',()=>{
 const r=probe({action:'picker-proof-wait'});assert.equal(r.ok,true,r.error);assert.equal(r.reads,2);assert.equal(r.value.actualDirectory,'C:\\fixture');
});

test('lyrics and description phrases cannot invent a crop or generated-cover banner',()=>{
 for(const text of ['我的歌词提到调整图片，也提到裁剪图片','介绍：已为您生成智能专辑封面只是歌词']){
  const r=probe({action:'cover-state',nodes:[node(1,'Button','更换图片'),node(2,'Button','智能封面')],text});assert.equal(r.ok,true,r.error);assert.equal(r.state.manualSelected,true);assert.equal(r.state.generatorBanner,false);
 }
});
test('exact phrases inside editable content and hidden headings remain user content',()=>{
 const nodes=[node(1,'Button','更换图片'),node(2,'Button','智能封面'),node(3,'Edit','歌词',{value:'调整图片'}),node(4,'Text','调整图片',{parentId:3}),node(5,'Text','已为您生成智能专辑封面',{parentId:3}),node(6,'Text','裁剪图片',{offscreen:true})];
 const r=probe({action:'cover-state',nodes,text:'调整图片 已为您生成智能专辑封面 裁剪图片'});assert.equal(r.ok,true,r.error);assert.equal(r.state.manualSelected,true);assert.equal(r.state.generatorBanner,false);
});
test('actual cover entrypoint reaches one selection despite lyric crop phrases',()=>{
 const r=probe({action:'cover-entrypoint',nodes:fullNodes,text:'歌词：调整图片，裁剪图片。'});assert.equal(r.ok,false);assert.equal(r.error,'TEST_COVER_CLICK');
});
test('actual cover entrypoint blocks a visible crop heading before selection',()=>{
 const r=probe({action:'cover-entrypoint',nodes:[...fullNodes,node(88,'Text','调整图片')],text:'调整图片'});assert.equal(r.ok,false);assert.equal(r.error,'CROP_COMPLETION_REQUIRED');
});
const cropNodes=[node(100,'Group',''),node(101,'Text','调整图片',{parentId:100}),node(102,'Button','确认',{parentId:100}),node(103,'Image','封面',{parentId:100}),node(104,'Button','更换图片',{parentId:100})];
test('crop confirmation still requires its exact heading, group, image and confirmation button',()=>{
 const r=probe({action:'crop-proof',nodes:cropNodes,text:'调整图片'});assert.equal(r.ok,true,r.error);assert.equal(r.proof.groupId,'100');
 for(const nodes of [cropNodes.filter(x=>x.id!==103),[...cropNodes,node(105,'Text','调整图片',{parentId:100})],cropNodes.map(x=>x.id===101?{...x,parentId:200}:x).concat(node(200,'Edit','歌词'))]){
  const blocked=probe({action:'crop-proof',nodes,text:'调整图片'});assert.equal(blocked.ok,false);assert.equal(blocked.error,'CROP_DIALOG_SCOPE_REQUIRED');
 }
});
const editorDoc=node(1,'Document','腾讯音乐人',{value:'https://y.tencentmusic.com/#/user/manage/aiChoose/add',text:'当前曲目授权模式'});
test('official PDF nested under the editor is readable without becoming an independent official tab',()=>{
 const r=probe({action:'page-documents',nodes:[editorDoc,node(2,'Document','PDF.js viewer',{parentId:1,value:'https://y.tencentmusic.com/static/pdfjs/web/viewer.html?file=fixture',text:'授权书'})],strict:true,boundId:'1'});assert.equal(r.ok,true,r.error);assert.equal(r.id,1);assert.equal(r.text,'当前曲目授权模式');
});
test('independent official documents and a changed bound document remain blocked',()=>{
 const separate=probe({action:'page-documents',nodes:[editorDoc,node(2,'Document','腾讯音乐人',{value:'https://y.tencentmusic.com/#/help',text:'帮助'})]});assert.equal(separate.ok,false);assert.equal(separate.error,'OFFICIAL_ACTIVE_DOCUMENT_REQUIRED');
 const changed=probe({action:'page-documents',nodes:[editorDoc],strict:true,boundId:'9'});assert.equal(changed.ok,false);assert.equal(changed.error,'AI_DOCUMENT_CHANGED');
});
test('cyclic or self-parented documents cannot be discarded as proven children of the bound editor',()=>{
 for(const extra of [
  [node(2,'Document','PDF',{parentId:3,value:'https://y.tencentmusic.com/static/pdfjs/'}),node(3,'Document','PDF',{parentId:2,value:'https://y.tencentmusic.com/static/pdfjs/'})],
  [node(2,'Document','PDF',{parentId:2,value:'https://y.tencentmusic.com/static/pdfjs/'})],
 ]){
  const r=probe({action:'page-documents',nodes:[editorDoc,...extra],strict:true,boundId:'1'});assert.equal(r.ok,false);assert.equal(r.error,'OFFICIAL_ACTIVE_DOCUMENT_REQUIRED');
 }
});
test('a separate cyclic radio cluster cannot be discarded as mirrors of an unrelated radio',()=>{
 const r=probe({action:'unique-radio',nodes:[node(19,'RadioButton','完整版'),node(26,'RadioButton','完整版',{parentId:27}),node(27,'RadioButton','完整版',{parentId:26})]});assert.equal(r.ok,false);assert.equal(r.error,'CONTROL_NOT_UNIQUE');
});

// Windows-only execution: these replay production PowerShell functions, not a JavaScript translation.
test('symbol-prefixed smart-cover banners cannot certify a manual cover',()=>{
 for(const name of ['✓ 已为您生成智能专辑封面','ℹ️ 已为您生成智能专辑封面','✦已为您生成智能专辑封面','\ue001 已为您生成智能专辑封面']){
  const r=probe({action:'cover-state',nodes:[node(1,'Button','更换图片'),node(2,'Button','智能封面'),node(3,'Text',name)]});assert.equal(r.ok,true,r.error);assert.equal(r.state.generatorBanner,true);assert.equal(r.state.manualSelected,false);
 }
});
test('prefixed user text, hidden labels and editable descendants remain outside banner evidence',()=>{
 for(const extra of [{name:'歌词：已为您生成智能专辑封面'}, {name:'✓ 已为您生成智能专辑封面',offscreen:true}, {name:'✓ 已为您生成智能专辑封面',parentId:4}]){
  const r=probe({action:'cover-state',nodes:[node(1,'Button','更换图片'),node(2,'Button','智能封面'),node(3,'Text',extra.name,extra),node(4,'Edit','歌词')]});assert.equal(r.ok,true,r.error);assert.equal(r.state.generatorBanner,false);
 }
});
test('hidden cover controls are neither accepted as evidence nor clicked',()=>{
 const r=probe({action:'cover-state',nodes:[node(1,'Button','更换图片',{offscreen:true}),node(2,'Button','智能封面')]});assert.equal(r.ok,true,r.error);assert.equal(r.state.manualSelected,false);
 const target=probe({action:'cover-control',nodes:[node(1,'Button','上传图片',{offscreen:true})]});assert.equal(target.ok,false);assert.equal(target.error,'COVER_UPLOAD_CONTROL_NOT_UNIQUE');
});
test('crop confirmation invokes once and returns the settled snapshot despite a transient old success',()=>{
 const r=probe({action:'confirm-crop',nodes:cropNodes,sequence:[true,false,true,true,true]});assert.equal(r.ok,true,r.error);assert.equal(r.invocations,1);assert.equal(r.reads,5);assert.equal(r.snapshot.observedAt,'5');
});
test('crop confirmation timeout cannot invoke confirmation a second time',()=>{
 const r=probe({action:'confirm-crop',nodes:cropNodes,sequence:[false],timeoutMs:40});assert.equal(r.ok,false);assert.equal(r.error,'MANUAL_COVER_ACCEPTANCE_REQUIRED');assert.equal(r.invocations,1);
});
test('crop confirmation refuses a changed group before clicking and stops on permanent read errors',()=>{
 const changed=probe({action:'confirm-crop',nodes:cropNodes,groupId:'other',sequence:[true]});assert.equal(changed.ok,false);assert.equal(changed.error,'CROP_GROUP_CHANGED');assert.equal(changed.invocations,0);
 const failed=probe({action:'confirm-crop',nodes:cropNodes,permanentError:'AI_ROUTE_CHANGED'});assert.equal(failed.ok,false);assert.equal(failed.error,'AI_ROUTE_CHANGED');assert.equal(failed.invocations,1);assert.equal(failed.reads,1);
});

test('cover selection waits for a delayed new crop instead of accepting the old manual cover tree',()=>{
 const r=probe({action:'cover-flow',nodes:cropNodes});assert.equal(r.ok,true,r.error);assert.equal(r.value.status,'applied');assert.equal(r.value.snapshot.test.selections,1);assert.equal(r.value.snapshot.test.confirmations,1);assert.ok(r.value.snapshot.test.pageReads>=4);
});
test('an unchanged old manual cover without a new crop fails closed after one selection',()=>{
 const r=probe({action:'cover-flow',nodes:cropNodes,noCrop:true});assert.equal(r.ok,false);assert.equal(r.error,'CROP_COMPLETION_REQUIRED');assert.equal(r.test.selections,1);assert.equal(r.test.confirmations,0);
});

test('crop confirmation refuses navigation within the same official document before any click',()=>{
 const r=probe({action:'confirm-crop',nodes:cropNodes,route:'https://y.tencentmusic.com/#/account/settings',sequence:[true]});assert.equal(r.ok,false);assert.equal(r.error,'AI_ROUTE_CHANGED');assert.equal(r.invocations,0);
});
