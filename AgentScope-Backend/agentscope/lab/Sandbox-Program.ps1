param([Parameter(Mandatory)][string]$RequestPath)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
# Hash constants are generated from the reviewed sources, not supplied by callers.
$allowlist = @{ 'approved_arithmetic.py'='64ffa7da44f86136de8b75d328f15f9602fd1a257741bc8d1756d619b286f6c9'; 'approved_isolation_probe.py'='bc6b2faee94c6c06a346f667cc236847e657c16d940353784c2cedbc4abdd001' }
$programName = [IO.Path]::GetFileName($request.program)
if (-not $allowlist.ContainsKey($programName)) { throw 'Program is not allowlisted' }
if ((Get-FileHash -LiteralPath $request.program -Algorithm SHA256).Hash.ToLowerInvariant() -ne $allowlist[$programName]) { throw 'Approved program hash mismatch' }
$caseRoot = [IO.Path]::GetFullPath($request.case_root)
if (-not $request.program.StartsWith($caseRoot + '\',[StringComparison]::OrdinalIgnoreCase) -or -not $request.executable.StartsWith($caseRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Runtime must be a dedicated copy inside the case' }
if ($request.profile_name -notmatch '^AgentScope\.Arithmetic\.[0-9a-f]{32}$') { throw 'Invalid disposable profile name' }
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class ArithmeticContainer {
 [StructLayout(LayoutKind.Sequential)] struct Cap { public IntPtr Sid,Capabilities; public uint Count,Reserved; }
 [StructLayout(LayoutKind.Sequential)] struct SA { public int Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct SI {
  public int cb; public string reserved,desktop,title; public uint x,y,xs,ys,xc,yc,fill,flags; public short show,reserved2; public IntPtr r2,input,output,error;
 }
 [StructLayout(LayoutKind.Sequential)] struct SIX { public SI startup; public IntPtr attributes; }
 [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr process,thread; public uint pid,tid; }
 [DllImport("userenv.dll",CharSet=CharSet.Unicode)] static extern int CreateAppContainerProfile(string n,string d,string x,IntPtr c,uint count,out IntPtr sid);
 [DllImport("userenv.dll",CharSet=CharSet.Unicode)] public static extern int DeleteAppContainerProfile(string n);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertSidToStringSid(IntPtr sid,out IntPtr text);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr p,uint a,out IntPtr t);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr t,int c,IntPtr b,uint n,out uint len);
 [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr l,int n,int f,ref IntPtr size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr l,uint f,IntPtr a,IntPtr v,IntPtr n,IntPtr p,IntPtr r);
 [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr l);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string a,StringBuilder c,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref SIX s,out PI p);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFileW(string n,uint a,uint share,ref SA sa,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr t);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr p,uint ms);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr p,out uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr p,uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string s,uint r,out IntPtr d,out uint size);
 [DllImport("user32.dll",SetLastError=true)] static extern IntPtr GetProcessWindowStation();
 [DllImport("user32.dll",SetLastError=true)] static extern bool SetProcessWindowStation(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateWindowStationW(string n,uint f,uint access,ref SA s);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateDesktopW(string n,IntPtr d,IntPtr dev,uint flags,uint access,ref SA s);
 [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
 [DllImport("user32.dll")] static extern bool CloseWindowStation(IntPtr h);
 static void Check(bool ok, string stage="native setup") { if(!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(),stage+": "+new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()).Message); }
 public static IntPtr Sid; public static string SidText;
 public static void Create(string name) {
  int error=CreateAppContainerProfile(name,"AgentScope arithmetic","Disposable reviewed-program containment test",IntPtr.Zero,0,out Sid);
  if(error!=0) Marshal.ThrowExceptionForHR(error);
  IntPtr text; Check(ConvertSidToStringSid(Sid,out text));
  try { SidText=Marshal.PtrToStringUni(text); } finally { LocalFree(text); }
 }
 public static void Free() { if(Sid!=IntPtr.Zero) { FreeSid(Sid); Sid=IntPtr.Zero; } }
 public static string Run(string exe,string command,string cwd,string output,string error,string runtime) {
  IntPtr size=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,3,0,ref size);
  IntPtr list=Marshal.AllocHGlobal(size), caps=IntPtr.Zero, policy=IntPtr.Zero, handles=IntPtr.Zero, environment=IntPtr.Zero;
  PI pi=new PI(); IntPtr stdout=IntPtr.Zero,stderr=IntPtr.Zero,stdin=IntPtr.Zero,token=IntPtr.Zero;
  bool done=false;
  IntPtr originalStation=IntPtr.Zero,privateStation=IntPtr.Zero,privateDesktop=IntPtr.Zero,objectSecurity=IntPtr.Zero;
  try {
   Check(InitializeProcThreadAttributeList(list,3,0,ref size));
   Cap cap=new Cap {Sid=Sid,Capabilities=IntPtr.Zero,Count=0}; caps=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Cap))); Marshal.StructureToPtr(cap,caps,false);
   Check(UpdateProcThreadAttribute(list,0,(IntPtr)0x20009,caps,(IntPtr)Marshal.SizeOf(typeof(Cap)),IntPtr.Zero,IntPtr.Zero));
   policy=Marshal.AllocHGlobal(4); Marshal.WriteInt32(policy,1);
   Check(UpdateProcThreadAttribute(list,0,(IntPtr)0x2000E,policy,(IntPtr)4,IntPtr.Zero,IntPtr.Zero));
   SA sa=new SA {Length=Marshal.SizeOf(typeof(SA)),Inherit=true};
   stdout=CreateFileW(output,0x40000000,1,ref sa,1,0x80,IntPtr.Zero); Check(stdout!=new IntPtr(-1));
   stderr=CreateFileW(error,0x40000000,1,ref sa,1,0x80,IntPtr.Zero); Check(stderr!=new IntPtr(-1));
   stdin=CreateFileW("NUL",0x80000000,3,ref sa,3,0x80,IntPtr.Zero); Check(stdin!=new IntPtr(-1));
   handles=Marshal.AllocHGlobal(IntPtr.Size*3); Marshal.Copy(new IntPtr[]{stdin,stdout,stderr},0,handles,3);
   Check(UpdateProcThreadAttribute(list,0,(IntPtr)0x20002,handles,(IntPtr)(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero));
   string windows=Environment.GetEnvironmentVariable("SystemRoot");
   string env="ALLUSERSPROFILE="+Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData)+"\0APPDATA="+cwd+"\0COMSPEC="+windows+"\\System32\\cmd.exe\0LOCALAPPDATA="+cwd+"\0PATH="+runtime+"\0SystemDrive="+System.IO.Path.GetPathRoot(windows).TrimEnd('\\')+"\0SystemRoot="+windows+"\0TEMP="+cwd+"\0TMP="+cwd+"\0USERPROFILE="+cwd+"\0WINDIR="+windows+"\0\0";
   environment=Marshal.StringToHGlobalUni(env);
   // Use private noninteractive UI objects, never WinSta0 or the user's desktop.
   string owner=System.Security.Principal.WindowsIdentity.GetCurrent().User.Value;
   uint sdSize; Check(ConvertStringSecurityDescriptorToSecurityDescriptorW("D:P(A;;GA;;;"+owner+")(A;;GA;;;SY)(A;;GA;;;"+SidText+")S:(ML;;NW;;;LW)",1,out objectSecurity,out sdSize),"Private object security");
   SA uiSecurity=new SA {Length=Marshal.SizeOf(typeof(SA)),Descriptor=objectSecurity,Inherit=false};
   string stationName="AgentScopeArithmetic"+Guid.NewGuid().ToString("N");
   originalStation=GetProcessWindowStation(); privateStation=CreateWindowStationW(stationName,0,0x000F037F,ref uiSecurity); Check(privateStation!=IntPtr.Zero,"Create private window station");
   Check(SetProcessWindowStation(privateStation),"Select private window station");
   privateDesktop=CreateDesktopW("Arithmetic",IntPtr.Zero,IntPtr.Zero,0,0x000F01FF,ref uiSecurity); Check(privateDesktop!=IntPtr.Zero,"Create private desktop");
   SIX si=new SIX(); si.startup.cb=Marshal.SizeOf(typeof(SIX)); si.startup.flags=0x100; si.startup.input=stdin;si.startup.output=stdout;si.startup.error=stderr;si.attributes=list;
   si.startup.desktop=stationName+"\\Arithmetic";
   Check(CreateProcessW(exe,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,0x08080404,environment,cwd,ref si,out pi),"CreateProcess AppContainer");
   // Inspect the actual suspended process before any Python code runs.
   Check(OpenProcessToken(pi.process,8,out token),"Open suspended process token"); uint count;
   IntPtr data=Marshal.AllocHGlobal(256);
   try {
    Check(GetTokenInformation(token,29,data,256,out count)); if(Marshal.ReadInt32(data)!=1) throw new Exception("Process is not an AppContainer");
    Check(GetTokenInformation(token,30,data,256,out count)); if(Marshal.ReadInt32(data)!=0) throw new Exception("Unexpected AppContainer capabilities");
   } finally { Marshal.FreeHGlobal(data); }
   Check(ResumeThread(pi.thread)!=0xFFFFFFFF);
   if(WaitForSingleObject(pi.process,10000)!=0) throw new Exception("Approved program timed out");
   uint exit; Check(GetExitCodeProcess(pi.process,out exit)); done=true;
   return "{\"pid\":"+pi.pid+",\"exit_code\":"+exit+",\"token_is_appcontainer\":true,\"capability_count\":0,\"child_process_policy\":\"restricted\"}";
  } finally {
   if(!done && pi.process!=IntPtr.Zero) {TerminateProcess(pi.process,1);WaitForSingleObject(pi.process,2000);}
   if(originalStation!=IntPtr.Zero) SetProcessWindowStation(originalStation);
   if(privateDesktop!=IntPtr.Zero) CloseDesktop(privateDesktop);
   if(privateStation!=IntPtr.Zero) CloseWindowStation(privateStation);
   if(objectSecurity!=IntPtr.Zero) LocalFree(objectSecurity);
   foreach(IntPtr h in new IntPtr[]{token,pi.thread,pi.process,stdin,stdout,stderr}) if(h!=IntPtr.Zero && h!=new IntPtr(-1)) CloseHandle(h);
   if(environment!=IntPtr.Zero) Marshal.FreeHGlobal(environment);
   if(handles!=IntPtr.Zero) Marshal.FreeHGlobal(handles);
   if(policy!=IntPtr.Zero) Marshal.FreeHGlobal(policy);
   if(caps!=IntPtr.Zero) Marshal.FreeHGlobal(caps);
   DeleteProcThreadAttributeList(list);Marshal.FreeHGlobal(list);
  }
 }
}
'@
$profileCreated = $false
try {
    [ArithmeticContainer]::Create($request.profile_name)
    $profileCreated = $true
    $sid = [ArithmeticContainer]::SidText
    & "$env:SystemRoot\System32\icacls.exe" $caseRoot /grant ("*" + $sid + ':(RX)') >$null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot grant traversal to the disposable case' }
    & "$env:SystemRoot\System32\icacls.exe" $request.runtime_root /grant ("*" + $sid + ':(OI)(CI)(RX)') /T /Q >$null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot grant read-only copied runtime access' }
    & "$env:SystemRoot\System32\icacls.exe" $request.output_root /grant ("*" + $sid + ':(OI)(CI)(M)') /T /Q >$null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot grant the dedicated output directory' }
    & "$env:SystemRoot\System32\icacls.exe" $request.output_root /setintegritylevel '(OI)(CI)L' /T /Q >$null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot set low-integrity disposable output' }
    $result = [ArithmeticContainer]::Run($request.executable,$request.command_line,$request.output_root,$request.stdout_path,$request.stderr_path,$request.runtime_root) | ConvertFrom-Json
    $result | Add-Member -NotePropertyName appcontainer_sid -NotePropertyValue $sid
    $result | ConvertTo-Json -Compress
} finally {
    [ArithmeticContainer]::Free()
    if ($profileCreated) { [void][ArithmeticContainer]::DeleteAppContainerProfile($request.profile_name) }
}
