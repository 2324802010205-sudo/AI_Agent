// Reports only whether CredReadW succeeds for a target. The secret is never printed.
using System;
using System.Runtime.InteropServices;

static class CredProbe
{
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredReadW(string target, int type, int flags, out IntPtr cred);
    [DllImport("advapi32.dll")] static extern void CredFree(IntPtr p);

    static int Main(string[] a)
    {
        IntPtr c;
        bool ok = CredReadW(a[0], 1 /*CRED_TYPE_GENERIC*/, 0, out c);
        int err = Marshal.GetLastWin32Error();
        if (ok) CredFree(c);
        Console.WriteLine("{\"cred_read_ok\":" + (ok ? "true" : "false") + ",\"win32_error\":" + (ok ? 0 : err) + "}");
        return ok ? 0 : 1;
    }
}
