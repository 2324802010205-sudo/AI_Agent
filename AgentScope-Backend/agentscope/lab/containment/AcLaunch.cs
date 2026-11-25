// AcLaunch: run one command inside a Windows AppContainer and a kill-on-close Job Object.
//
//   AcLaunch.exe --profile NAME [--cap internetClient] --cwd DIR --report FILE
//                [--proc-log FILE] [--console] --env K=V [--env K=V]... -- EXE [ARGS...]
//
// --console keeps the child attached to this console (interactive sign-in only).
//
// * The child receives an explicit environment block (nothing inherited) and only this
//   launcher's stdin/stdout/stderr handles (PROC_THREAD_ATTRIBUTE_HANDLE_LIST).
// * The child is created suspended. Its real primary token is read back (AppContainer flag,
//   package SID, capability SIDs, integrity level) and written to --report before it runs.
//   A mismatch terminates it without resuming.
// * Every process that ever joins the job (the child and all descendants) is recorded in
//   --proc-log from kernel job notifications: PID, image path, command line, exit code.
// * Closing the job handle (launcher exit or crash) kills every remaining descendant.
// No privilege is required; nothing here changes system-wide configuration.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class AcLaunch
{
    [StructLayout(LayoutKind.Sequential)] struct SidAndAttr { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential)] struct TokenGroups { public uint Count; public SidAndAttr First; }
    [StructLayout(LayoutKind.Sequential)] struct SecCaps { public IntPtr AppContainerSid, Capabilities; public uint CapabilityCount, Reserved; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct SI { public int cb; public string r, desktop, title; public uint x, y, xs, ys, xc, yc, fill, flags; public short show, r2; public IntPtr r3, input, output, error; }
    [StructLayout(LayoutKind.Sequential)] struct SIX { public SI si; public IntPtr attrs; }
    [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr process, thread; public uint pid, tid; }
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimit { public long a, b; public uint LimitFlags; public UIntPtr c, d; public uint e; public UIntPtr f; public uint g, h; }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong a, b, c, d, e, f; }
    [StructLayout(LayoutKind.Sequential)] struct ExtLimit { public BasicLimit Basic; public IoCounters Io; public UIntPtr a, b, c, d; }
    [StructLayout(LayoutKind.Sequential)] struct CompletionPort { public IntPtr Key, Port; }
    [StructLayout(LayoutKind.Sequential)] struct UnicodeString { public ushort Length, MaximumLength; public IntPtr Buffer; }

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int CreateAppContainerProfile(string n, string d, string x, IntPtr caps, uint count, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int DeriveAppContainerSidFromAppContainerName(string n, out IntPtr sid);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr s);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertStringSidToSid(string s, out IntPtr sid);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr p, uint a, out IntPtr t);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr t, int c, IntPtr b, int n, out int len);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr l, int n, int f, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr l, uint f, IntPtr a, IntPtr v, IntPtr n, IntPtr p, IntPtr r);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref SIX si, out PI pi);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GetStdHandle(int n);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr sa, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr j, int c, ref ExtLimit info, int len);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr j, int c, ref CompletionPort info, int len);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateIoCompletionPort(IntPtr file, IntPtr port, IntPtr key, uint threads);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetQueuedCompletionStatus(IntPtr port, out uint msg, out IntPtr key, out IntPtr overlapped, uint ms);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageNameW(IntPtr p, int flags, StringBuilder name, ref int size);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr p, int cls, IntPtr buf, int len, out int ret);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr t);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr p, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr p, uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);

    static void Check(bool ok, string stage) { if (!ok) { int e = Marshal.GetLastWin32Error(); throw new Win32Exception(e, stage + ": " + new Win32Exception(e).Message); } }
    static string SidText(IntPtr sid)
    {
        IntPtr text;
        Check(ConvertSidToStringSid(sid, out text), "ConvertSidToStringSid");
        try { return Marshal.PtrToStringUni(text); }
        finally { LocalFree(text); }
    }
    static string Q(string s)
    {
        if (s == null) return "null";
        var b = new StringBuilder("\"");
        foreach (char c in s)
        {
            if (c == '"' || c == '\\') b.Append('\\').Append(c);
            else if (c < 0x20) b.AppendFormat("\\u{0:x4}", (int)c);
            else b.Append(c);
        }
        return b.Append('"').ToString();
    }
    static string Now() { return DateTime.UtcNow.ToString("o"); }

    static string Quote(string a)
    {
        if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return a;
        var b = new StringBuilder("\"");
        int bs = 0;
        foreach (char c in a)
        {
            if (c == '\\') { bs++; continue; }
            if (c == '"') { b.Append('\\', bs * 2 + 1); b.Append('"'); bs = 0; continue; }
            b.Append('\\', bs); bs = 0; b.Append(c);
        }
        b.Append('\\', bs * 2); b.Append('"');
        return b.ToString();
    }

    static string Image(IntPtr h)
    {
        var sb = new StringBuilder(1024); int n = sb.Capacity;
        return QueryFullProcessImageNameW(h, 0, sb, ref n) ? sb.ToString() : null;
    }

    static string CommandLine(IntPtr h)
    {
        IntPtr buf = Marshal.AllocHGlobal(65536);
        try
        {
            int ret; // ProcessCommandLineInformation = 60
            if (NtQueryInformationProcess(h, 60, buf, 65536, out ret) != 0) return null;
            var us = (UnicodeString)Marshal.PtrToStructure(buf, typeof(UnicodeString));
            return us.Buffer == IntPtr.Zero ? null : Marshal.PtrToStringUni(us.Buffer, us.Length / 2);
        }
        finally { Marshal.FreeHGlobal(buf); }
    }

    static StreamWriter procLog;
    static readonly object logLock = new object();
    static void Log(string json) { if (procLog == null) return; lock (logLock) { procLog.WriteLine(json); procLog.Flush(); } }

    sealed class TokenFacts
    {
        public bool IsAppContainer;
        public bool? Elevated;
        public string Sid, Integrity, UserSid, AdministratorsGroup;
        public readonly List<string> Capabilities = new List<string>();

        public string Fields()
        {
            return "\"token_is_appcontainer\":" + (IsAppContainer ? "true" : "false") +
                ",\"token_appcontainer_sid\":" + Q(Sid) + ",\"token_integrity_sid\":" + Q(Integrity) +
                ",\"token_user_sid\":" + Q(UserSid) +
                ",\"token_elevated\":" + (Elevated.HasValue ? (Elevated.Value ? "true" : "false") : "null") +
                ",\"token_administrators_group\":" + Q(AdministratorsGroup) +
                ",\"token_capabilities\":[" + string.Join(",", Capabilities.ConvertAll(Q)) + "]";
        }
    }

    static string ReadAdministratorsGroup(IntPtr token)
    {
        const int tokenGroups = 2;
        const uint groupEnabled = 0x4, groupDenyOnly = 0x10;
        int length;
        GetTokenInformation(token, tokenGroups, IntPtr.Zero, 0, out length);
        if (length <= 0) return null;

        IntPtr buffer = Marshal.AllocHGlobal(length);
        try
        {
            if (!GetTokenInformation(token, tokenGroups, buffer, length, out length)) return null;
            int count = Marshal.ReadInt32(buffer);
            int offset = Marshal.OffsetOf(typeof(TokenGroups), "First").ToInt32();
            int stride = Marshal.SizeOf(typeof(SidAndAttr));
            for (int i = 0; i < count; i++)
            {
                var group = (SidAndAttr)Marshal.PtrToStructure(buffer + offset + i * stride, typeof(SidAndAttr));
                if (SidText(group.Sid) != "S-1-5-32-544") continue; // BUILTIN\Administrators
                if ((group.Attributes & groupDenyOnly) != 0) return "deny_only";
                return (group.Attributes & groupEnabled) != 0 ? "enabled" : "disabled";
            }
            return "absent";
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    static TokenFacts ReadToken(IntPtr process)
    {
        IntPtr token; Check(OpenProcessToken(process, 8, out token), "OpenProcessToken");
        IntPtr buffer = Marshal.AllocHGlobal(4096);
        try
        {
            int length;
            var facts = new TokenFacts();
            Check(GetTokenInformation(token, 29, buffer, 4096, out length), "TokenIsAppContainer");
            facts.IsAppContainer = Marshal.ReadInt32(buffer) != 0;
            Check(GetTokenInformation(token, 31, buffer, 4096, out length), "TokenAppContainerSid");
            facts.Sid = SidText(Marshal.ReadIntPtr(buffer));
            Check(GetTokenInformation(token, 30, buffer, 4096, out length), "TokenCapabilities");
            int count = Marshal.ReadInt32(buffer);
            int stride = Marshal.SizeOf(typeof(SidAndAttr));
            for (int i = 0; i < count; i++)
                facts.Capabilities.Add(SidText(Marshal.ReadIntPtr(buffer + IntPtr.Size + i * stride)));
            Check(GetTokenInformation(token, 25, buffer, 4096, out length), "TokenIntegrityLevel");
            facts.Integrity = SidText(Marshal.ReadIntPtr(buffer));
            if (GetTokenInformation(token, 1, buffer, 4096, out length)) // TokenUser
                facts.UserSid = SidText(Marshal.ReadIntPtr(buffer));
            if (GetTokenInformation(token, 20, buffer, sizeof(uint), out length)) // TokenElevation
                facts.Elevated = Marshal.ReadInt32(buffer) != 0;
            facts.AdministratorsGroup = ReadAdministratorsGroup(token);
            return facts;
        }
        finally { Marshal.FreeHGlobal(buffer); CloseHandle(token); }
    }

    static void Watch(IntPtr port)
    {
        var handles = new Dictionary<uint, IntPtr>();
        while (true)
        {
            uint msg; IntPtr key, ov;
            if (!GetQueuedCompletionStatus(port, out msg, out key, out ov, 0xFFFFFFFF)) continue;
            uint pid = (uint)ov.ToInt64();
            if (msg == 6) // JOB_OBJECT_MSG_NEW_PROCESS
            {
                IntPtr h = OpenProcess(0x1000 | 0x0400 | 0x00100000, false, pid); // QUERY_LIMITED | QUERY | SYNCHRONIZE
                if (h == IntPtr.Zero) h = OpenProcess(0x1000 | 0x00100000, false, pid);
                string image = h != IntPtr.Zero ? Image(h) : null;
                string cmd = h != IntPtr.Zero ? CommandLine(h) : null;
                if (h != IntPtr.Zero) handles[pid] = h;
                string token = "null";
                if (h != IntPtr.Zero)
                    try { token = "{" + ReadToken(h).Fields() + "}"; } catch (Exception) { }
                Log("{\"event\":\"process_joined\",\"time\":" + Q(Now()) + ",\"pid\":" + pid + ",\"image\":" + Q(image) + ",\"command_line\":" + Q(cmd) + ",\"token\":" + token + "}");
            }
            else if (msg == 7 || msg == 8) // EXIT_PROCESS / ABNORMAL_EXIT_PROCESS
            {
                uint code = 0xFFFFFFFF; IntPtr h;
                if (handles.TryGetValue(pid, out h)) { GetExitCodeProcess(h, out code); CloseHandle(h); handles.Remove(pid); }
                Log("{\"event\":\"process_exited\",\"time\":" + Q(Now()) + ",\"pid\":" + pid + ",\"exit_code\":" + (code == 0xFFFFFFFF ? "null" : ((int)code).ToString()) + ",\"abnormal\":" + (msg == 8 ? "true" : "false") + "}");
            }
            else if (msg == 4) // ACTIVE_PROCESS_ZERO
            {
                Log("{\"event\":\"job_empty\",\"time\":" + Q(Now()) + "}");
            }
        }
    }

    static int Main(string[] argv)
    {
        string profile = null, cwd = null, report = null, plog = null; bool console = false; var caps = new List<string>(); var env = new List<string>();
        int i = 0;
        for (; i < argv.Length && argv[i] != "--"; i++)
        {
            switch (argv[i])
            {
                case "--profile": profile = argv[++i]; break;
                case "--cap": caps.Add(argv[++i]); break;
                case "--cwd": cwd = argv[++i]; break;
                case "--report": report = argv[++i]; break;
                case "--proc-log": plog = argv[++i]; break;
                case "--env": env.Add(argv[++i]); break;
                case "--console": console = true; break;
                default: Console.Error.WriteLine("AcLaunch: unknown option " + argv[i]); return 64;
            }
        }
        if (profile == null || cwd == null || report == null || env.Count == 0 || i + 1 >= argv.Length) { Console.Error.WriteLine("AcLaunch: usage error"); return 64; }
        string exe = argv[i + 1];
        var cmd = new StringBuilder(Quote(exe));
        for (int k = i + 2; k < argv.Length; k++) cmd.Append(' ').Append(Quote(argv[k]));

        IntPtr acSid;
        int hr = CreateAppContainerProfile(profile, profile, "AgentScope contained research", IntPtr.Zero, 0, out acSid);
        if (hr == unchecked((int)0x800700B7)) hr = DeriveAppContainerSidFromAppContainerName(profile, out acSid);
        if (hr != 0) Marshal.ThrowExceptionForHR(hr);

        // Only well-known capabilities that the caller names explicitly.
        var known = new Dictionary<string, string> { { "internetClient", "S-1-15-3-1" } };
        IntPtr capArray = IntPtr.Zero;
        int sz = Marshal.SizeOf(typeof(SidAndAttr));
        if (caps.Count > 0)
        {
            capArray = Marshal.AllocHGlobal(sz * caps.Count);
            for (int c = 0; c < caps.Count; c++)
            {
                if (!known.ContainsKey(caps[c])) { Console.Error.WriteLine("AcLaunch: capability not allowed: " + caps[c]); return 64; }
                IntPtr cs; Check(ConvertStringSidToSid(known[caps[c]], out cs), "capability sid");
                Marshal.StructureToPtr(new SidAndAttr { Sid = cs, Attributes = 4 /*SE_GROUP_ENABLED*/ }, capArray + c * sz, false);
            }
        }
        var sc = new SecCaps { AppContainerSid = acSid, Capabilities = capArray, CapabilityCount = (uint)caps.Count };
        IntPtr scPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SecCaps))); Marshal.StructureToPtr(sc, scPtr, false);

        IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
        IntPtr list = Marshal.AllocHGlobal(size); Check(InitializeProcThreadAttributeList(list, 2, 0, ref size), "attr list");
        Check(UpdateProcThreadAttribute(list, 0, (IntPtr)0x20009, scPtr, (IntPtr)Marshal.SizeOf(typeof(SecCaps)), IntPtr.Zero, IntPtr.Zero), "security capabilities");
        IntPtr[] std = { GetStdHandle(-10), GetStdHandle(-11), GetStdHandle(-12) };
        var inheritable = new List<IntPtr>();
        foreach (var h in std) if (h != IntPtr.Zero && h != new IntPtr(-1) && !inheritable.Contains(h) && SetHandleInformation(h, 1, 1)) inheritable.Add(h);
        IntPtr handles = Marshal.AllocHGlobal(IntPtr.Size * Math.Max(1, inheritable.Count));
        Marshal.Copy(inheritable.ToArray(), 0, handles, inheritable.Count);
        Check(UpdateProcThreadAttribute(list, 0, (IntPtr)0x20002, handles, (IntPtr)(IntPtr.Size * inheritable.Count), IntPtr.Zero, IntPtr.Zero), "handle list");

        var envBlock = new StringBuilder();
        foreach (var e in env) envBlock.Append(e).Append('\0');
        envBlock.Append('\0');
        IntPtr envPtr = Marshal.StringToHGlobalUni(envBlock.ToString());

        IntPtr job = CreateJobObjectW(IntPtr.Zero, null); Check(job != IntPtr.Zero, "CreateJobObject");
        var lim = new ExtLimit(); lim.Basic.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE; breakaway not permitted
        Check(SetInformationJobObject(job, 9, ref lim, Marshal.SizeOf(typeof(ExtLimit))), "job limits");
        if (plog != null)
        {
            procLog = new StreamWriter(plog, false, new UTF8Encoding(false));
            IntPtr port = CreateIoCompletionPort(new IntPtr(-1), IntPtr.Zero, IntPtr.Zero, 1); Check(port != IntPtr.Zero, "completion port");
            var cp = new CompletionPort { Key = job, Port = port };
            Check(SetInformationJobObject(job, 7, ref cp, Marshal.SizeOf(typeof(CompletionPort))), "job completion port");
            var t = new Thread(() => Watch(port)); t.IsBackground = true; t.Start();
        }

        var six = new SIX(); six.si.cb = Marshal.SizeOf(typeof(SIX)); six.attrs = list;
        six.si.flags = 0x100; six.si.input = std[0]; six.si.output = std[1]; six.si.error = std[2];
        PI pi;
        // CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW
        Check(CreateProcessW(exe, cmd, IntPtr.Zero, IntPtr.Zero, true, 0x4 | 0x400 | 0x80000 | (console ? 0u : 0x08000000u), envPtr, cwd, ref six, out pi), "CreateProcess in AppContainer");
        bool resumed = false;
        try
        {
            Check(AssignProcessToJobObject(job, pi.process), "assign job");
            TokenFacts token = ReadToken(pi.process);
            string expectedSid = SidText(acSid);
            File.WriteAllText(report, "{\"time\":" + Q(Now()) + ",\"pid\":" + pi.pid + "," + token.Fields() +
                ",\"expected_appcontainer_sid\":" + Q(expectedSid) +
                ",\"job_kill_on_close\":true,\"environment_inherited\":false,\"command_line\":" + Q(cmd.ToString()) + "}");
            var expectedCaps = new HashSet<string>(caps.ConvertAll(cap => known[cap]));
            if (!token.IsAppContainer || token.Sid != expectedSid || token.Integrity != "S-1-16-4096" ||
                token.Capabilities.Count != caps.Count || !expectedCaps.SetEquals(token.Capabilities))
                throw new Exception("token verification failed");
            Check(ResumeThread(pi.thread) != 0xFFFFFFFF, "ResumeThread"); resumed = true;
            WaitForSingleObject(pi.process, 0xFFFFFFFF);
            uint code; GetExitCodeProcess(pi.process, out code);
            Thread.Sleep(300); // let the watcher record final notifications
            return (int)code;
        }
        finally
        {
            if (!resumed) TerminateProcess(pi.process, 1);
            // Process exit closes the job handle; KILL_ON_JOB_CLOSE ends any descendants.
        }
    }
}
