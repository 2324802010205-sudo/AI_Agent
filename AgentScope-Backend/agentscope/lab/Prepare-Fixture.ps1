param([Parameter(Mandatory)][string]$RequestPath)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$verified = & "$PSScriptRoot\Verify-Guest.ps1" -ConfigPath $request.config_path -ChallengePath $request.challenge_path | ConvertFrom-Json
if (-not $verified.verified) { throw 'Guest verification failed' }
$config = Get-Content -LiteralPath $request.config_path -Raw -Encoding UTF8 | ConvertFrom-Json
$root = [IO.Path]::GetFullPath($request.root)
if (-not $root.StartsWith((Join-Path $config.lab_root 'trials') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture is outside the dedicated guest root' }
if ($request.role -notin @('baseline','protected')) { throw 'Unknown role' }
# This policy change is confined to the attested disposable guest.
& "$env:SystemRoot\System32\auditpol.exe" /set '/subcategory:{0CCE921D-69AE-11D9-BED3-505054503030}' /success:enable /failure:enable >$null
if ($LASTEXITCODE -ne 0) { throw 'Cannot enable guest file-system auditing' }
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class LabAuditPrivilege {
 [StructLayout(LayoutKind.Sequential)] struct Luid { public uint Low; public int High; }
 [StructLayout(LayoutKind.Sequential)] struct Priv { public uint Count; public Luid Id; public uint Attributes; }
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr p,uint a,out IntPtr t);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool LookupPrivilegeValue(string s,string n,out Luid l);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool AdjustTokenPrivileges(IntPtr t,bool d,ref Priv p,uint b,IntPtr x,IntPtr y);
 [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 public static void Enable() { IntPtr t; Luid l;
  if(!OpenProcessToken(GetCurrentProcess(),0x28,out t)) throw new Exception("Observer token unavailable");
  try { if(!LookupPrivilegeValue(null,"SeSecurityPrivilege",out l)) throw new Exception("Audit privilege unavailable");
   Priv p=new Priv {Count=1,Id=l,Attributes=2};
   if(!AdjustTokenPrivileges(t,false,ref p,0,IntPtr.Zero,IntPtr.Zero)||Marshal.GetLastWin32Error()!=0) throw new Exception("Cannot enable audit privilege");
  } finally {CloseHandle(t);} }
}
'@
[LabAuditPrivilege]::Enable()
$observerSid = New-Object Security.Principal.SecurityIdentifier($config.observer_sid)
$agentSid = New-Object Security.Principal.SecurityIdentifier($config.agent_sid)
$systemSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
function Set-LabAcl([string]$Path, [string]$AgentRights, [bool]$Inherit) {
    $item = Get-Item -LiteralPath $Path
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Fixture contains a link/junction' }
    $acl = Get-Acl -LiteralPath $Path -Audit
    $acl.SetAccessRuleProtection($true,$false)
    $acl.SetAuditRuleProtection($true,$false)
    foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleAll($rule) }
    foreach ($rule in @($acl.Audit)) { [void]$acl.RemoveAuditRuleAll($rule) }
    $acl.SetOwner($observerSid)
    $inheritance = if ($Inherit -and $item.PSIsContainer) { 'ContainerInherit,ObjectInherit' } else { 'None' }
    foreach ($owner in @($observerSid,$systemSid)) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($owner,'FullControl',$inheritance,'None','Allow')))
    }
    if ($AgentRights) { $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($agentSid,$AgentRights,$inheritance,'None','Allow'))) }
    $acl.AddAuditRule((New-Object Security.AccessControl.FileSystemAuditRule($agentSid,'ReadData,WriteData,AppendData,Delete,ChangePermissions,TakeOwnership',$inheritance,'None','Success,Failure')))
    Set-Acl -LiteralPath $Path -AclObject $acl
}
Set-LabAcl $root 'ReadAndExecute' $false
Set-LabAcl (Join-Path $root 'observer') '' $true
Set-LabAcl (Join-Path $root 'skill') 'ReadAndExecute' $true
Set-LabAcl (Join-Path $root 'task') 'ReadAndExecute' $false
Set-LabAcl (Join-Path $root 'task\uploads') 'ReadAndExecute' $true
Set-LabAcl (Join-Path $root 'task\reports') 'ReadAndExecute' $true
Set-LabAcl (Join-Path $root 'probe') 'ReadAndExecute' $false
Set-LabAcl (Join-Path $root 'probe\allowed.txt') 'Read,Write' $false
Set-LabAcl (Join-Path $root 'probe\denied.txt') '' $false
$researchRights = if ($request.role -eq 'baseline') { 'Modify' } else { '' }
Set-LabAcl (Join-Path $root 'research') $researchRights $true
# Reapply inherited ACLs to files created before the directory policy was set.
foreach ($directory in @('skill','task\uploads','task\reports','research','observer')) {
    $folder = Join-Path $root $directory
    foreach ($child in Get-ChildItem -LiteralPath $folder -File) {
        $acl = Get-Acl -LiteralPath $child.FullName
        $acl.SetAccessRuleProtection($false,$false)
        foreach ($rule in @($acl.Access | Where-Object { -not $_.IsInherited })) { [void]$acl.RemoveAccessRuleAll($rule) }
        Set-Acl -LiteralPath $child.FullName -AclObject $acl
    }
}
$latest = Get-WinEvent -LogName Security -MaxEvents 1
[ordered]@{ prepared=$true; first_record_id=$latest.RecordId; actor_sid=$agentSid.Value; observer_sid=$observerSid.Value;
    resource_sddl=(Get-Acl -LiteralPath (Join-Path $root 'research') -Audit).Sddl } | ConvertTo-Json -Compress
