param(
  [Parameter(Mandatory)][ValidateSet('Capture','Stop')][string]$Action,
  [Parameter(Mandatory)][string]$ExecutablePath,
  [Parameter(Mandatory)][string]$EntryPath,
  [Parameter(Mandatory)][string]$Owner,
  [Parameter(Mandatory)][string]$StateFile,
  [Parameter(Mandatory)][string]$RuntimePath
)
if ($PSVersionTable.PSVersion.Major -ne 7) { throw 'PS7 required' }
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public sealed class QaPinnedProcess : IDisposable {
  IntPtr handle;
  public uint Pid {get;private set;}
  public string Executable {get;private set;}
  public string CreationFileTime {get;private set;}
  [StructLayout(LayoutKind.Sequential)] struct FT { public uint low,high; }
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr h,out FT created,out FT exited,out FT kernel,out FT user);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr h,uint flags,StringBuilder text,ref uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr h,uint code);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h,out uint code);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h,uint ms);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("shell32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CommandLineToArgvW(string text,out int argc);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr h);
  public static string[] Args(string text) {
    if(String.IsNullOrEmpty(text)) return new string[0];
    int n;var p=CommandLineToArgvW(text,out n);if(p==IntPtr.Zero)throw new Exception("QA_ARGUMENTS_UNAVAILABLE");
    try {var result=new string[n];for(int i=0;i<n;i++)result[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(p,i*IntPtr.Size));return result;}finally{LocalFree(p);}
  }
  public static QaPinnedProcess Open(uint pid) {
    var h=OpenProcess(0x101001,false,pid); // query + terminate + synchronize, pinned against PID reuse
    if(h==IntPtr.Zero){int e=Marshal.GetLastWin32Error();if(e==87||e==1168)return null;throw new Exception("QA_PROCESS_ACCESS_DENIED");}
    try {
      FT c,e,k,u;if(!GetProcessTimes(h,out c,out e,out k,out u))throw new Exception("QA_PROCESS_TIME_UNAVAILABLE");
      var text=new StringBuilder(32768);uint size=(uint)text.Capacity;
      if(!QueryFullProcessImageName(h,0,text,ref size))throw new Exception("QA_PROCESS_PATH_UNAVAILABLE");
      return new QaPinnedProcess {handle=h,Pid=pid,Executable=text.ToString(),CreationFileTime=(((ulong)c.high<<32)|c.low).ToString()};
    } catch {CloseHandle(h);throw;}
  }
  public bool Alive {get {uint code;return GetExitCodeProcess(handle,out code)&&code==259;}}
  public bool Stop() {if(!Alive)return false;if(!TerminateProcess(handle,137))throw new Exception("QA_PROCESS_STOP_FAILED");WaitForSingleObject(handle,1500);return true;}
  public void Dispose(){if(handle!=IntPtr.Zero){CloseHandle(handle);handle=IntPtr.Zero;}}
}
'@
function Same-Path([string]$a,[string]$b) { [string]::Equals($a,$b,[StringComparison]::OrdinalIgnoreCase) }
function Owned-Command($row) {
  $arguments=[QaPinnedProcess]::Args($row.CommandLine)
  return ($arguments -contains ('--rainfall-qa-owner='+$Owner)) -and @($arguments | Where-Object {Same-Path $_ $EntryPath}).Count -eq 1
}
function Owned-Runtime($row) {
  # Electron propagates this exact per-run directory to renderer/GPU/utility
  # processes. Independent evidence: never infer ownership from a saved PID graph.
  $arguments=[QaPinnedProcess]::Args($row.CommandLine)
  return @($arguments | Where-Object {Same-Path $_ ('--user-data-dir='+$RuntimePath)}).Count -eq 1
}
function Process-Rows {
  $name=[IO.Path]::GetFileName($ExecutablePath)
  if($name -notmatch '^[a-zA-Z0-9_.-]+\.exe$'){throw 'QA_EXECUTABLE_REJECTED'}
  @(Get-CimInstance Win32_Process -Filter ("Name='"+$name+"'") | Where-Object {Same-Path $_.ExecutablePath $ExecutablePath})
}
function Descriptor($pin,$parent) { @{pid=[int]$pin.Pid;parentPid=[int]$parent;executable=$pin.Executable;creationFileTime=$pin.CreationFileTime} }
function Matches-Row($pin,$row) {
  # CIM reports microseconds; kernel FILETIME retains 100 ns. Reject a reused PID.
  return (Same-Path $pin.Executable $ExecutablePath) -and [Math]::Abs(([DateTime]::FromFileTimeUtc([long]$pin.CreationFileTime).Ticks-$row.CreationDate.ToUniversalTime().Ticks)) -lt 10
}
function Emit($result) { $result | ConvertTo-Json -Depth 8 -Compress }
$pins=@{}
try {
  if($Owner -notmatch '^[a-f0-9-]{36}$' -or -not [IO.Path]::IsPathRooted($ExecutablePath) -or -not [IO.Path]::IsPathRooted($EntryPath) -or -not(Same-Path $RuntimePath ([IO.Path]::Combine([IO.Path]::GetDirectoryName($StateFile),'data','runtime')))){throw 'QA_SCOPE_REJECTED'}
  $rows=@(Process-Rows)
  if($Action -eq 'Capture') {
    $roots=@($rows | Where-Object {Owned-Command $_})
    if($roots.Count -eq 0){Emit @{state='absent'};exit 0}
    if($roots.Count -ne 1){throw 'QA_OWNER_AMBIGUOUS'}
    $rootRow=$roots[0];$rootPin=[QaPinnedProcess]::Open($rootRow.ProcessId)
    if(-not $rootPin){Emit @{state='absent'};exit 0}
    if(-not(Matches-Row $rootPin $rootRow)){$rootPin.Dispose();throw 'QA_ROOT_CHANGED_DURING_CAPTURE'}
    $pins[[int]$rootPin.Pid]=$rootPin
    $descriptors=@{};$descriptors[[int]$rootPin.Pid]=Descriptor $rootPin $rootRow.ParentProcessId
    do {$added=$false;foreach($row in $rows){$id=[int]$row.ProcessId;$parent=[int]$row.ParentProcessId;if($pins.ContainsKey($id) -or -not $pins.ContainsKey($parent)){continue};$pin=[QaPinnedProcess]::Open($id);if($pin -and (Matches-Row $pin $row) -and [long]$pin.CreationFileTime -ge [long]$pins[$parent].CreationFileTime){$pins[$id]=$pin;$descriptors[$id]=Descriptor $pin $parent;$added=$true}elseif($pin){$pin.Dispose()}}}while($added)
    $state=@{format=2;owner=$Owner;entryPath=$EntryPath;executable=$ExecutablePath;runtimePath=$RuntimePath;root=$descriptors[[int]$rootPin.Pid];processes=@($descriptors.Values);capturedAt=[DateTime]::UtcNow.ToString('o')}
    $temporary=$StateFile+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
    [IO.File]::WriteAllText($temporary,($state | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
    [IO.File]::Move($temporary,$StateFile,$true)
    Emit @{state='captured';root=$state.root;processes=$state.processes};exit 0
  }
  if(-not(Test-Path -LiteralPath $StateFile)){Emit @{state='absent';stopped=@();remaining=@()};exit 0}
  $state=Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
  if($state.format -ne 2 -or $state.owner -ne $Owner -or -not(Same-Path $state.executable $ExecutablePath) -or -not(Same-Path $state.entryPath $EntryPath) -or -not(Same-Path $state.runtimePath $RuntimePath)){Emit @{state='refused';reason='QA_STATE_IDENTITY_MISMATCH';stopped=@();remaining=@()};exit 0}
  $rootId=[int]$state.root.pid;$rootRow=@($rows | Where-Object {[int]$_.ProcessId -eq $rootId})
  $rootPin=[QaPinnedProcess]::Open($rootId)
  if($rootPin){
    if(-not(Same-Path $rootPin.Executable $ExecutablePath) -or $rootPin.CreationFileTime -ne $state.root.creationFileTime -or ($rootPin.Alive -and ($rootRow.Count -ne 1 -or -not(Owned-Command $rootRow[0])))){$rootPin.Dispose();Emit @{state='refused';reason='QA_ROOT_IDENTITY_MISMATCH';stopped=@();remaining=@()};exit 0}
    $pins[$rootId]=$rootPin
  }
  $stopped=[Collections.Generic.List[int]]::new()
  # Hold every verified native handle until all passes finish, preventing PID reuse.
  # Runtime ownership also finds late workers after Main has already disappeared.
  for($pass=0;$pass -lt 3;$pass++){
    $rows=@(Process-Rows)
    foreach($row in $rows){$id=[int]$row.ProcessId;if($pins.ContainsKey($id) -or -not(Owned-Runtime $row)){continue};$pin=[QaPinnedProcess]::Open($id);if($pin -and (Matches-Row $pin $row) -and [long]$pin.CreationFileTime -ge [long]$state.root.creationFileTime){$pins[$id]=$pin}elseif($pin){$pin.Dispose()}}
    if($pins.ContainsKey($rootId) -and $pins[$rootId].Stop()){$stopped.Add($rootId)}
    foreach($id in @($pins.Keys)){if($id -ne $rootId -and $pins[$id].Stop()){$stopped.Add($id)}}
  }
  $remaining=@($pins.Values | Where-Object Alive | ForEach-Object {[int]$_.Pid})
  $remaining+=@(Process-Rows | Where-Object {Owned-Runtime $_} | ForEach-Object {[int]$_.ProcessId})
  $remaining=@($remaining | Select-Object -Unique)
  Emit @{state=if($remaining.Count -eq 0){'cleaned'}else{'incomplete'};stopped=@($stopped.ToArray());remaining=$remaining}
} catch {Emit @{state='refused';reason='QA_NATIVE_OPERATION_FAILED';stopped=@();remaining=@()};exit 1}
finally {foreach($pin in $pins.Values){$pin.Dispose()}}
