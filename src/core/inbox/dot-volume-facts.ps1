param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public static class InboxVolumeFacts {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool GetVolumeInformation(string root,StringBuilder label,uint labelSize,out uint serial,out uint maxComponent,out uint flags,StringBuilder fileSystem,uint fileSystemSize);
 public static object Read(string root){var label=new StringBuilder(261);var system=new StringBuilder(261);uint serial,max,flags;if(!GetVolumeInformation(root,label,261,out serial,out max,out flags,system,261))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());return new{serial,flags,fileSystem=system.ToString()};}
}
'@
[InboxVolumeFacts]::Read($Root) | ConvertTo-Json -Compress
