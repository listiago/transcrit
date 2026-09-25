param([Parameter(Mandatory=$true)][int]$ApplicationProcess)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class CardWindow {
  public delegate bool EnumProc(IntPtr window, IntPtr data);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
  public static void Read(uint pid) {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    EnumWindows((window, data) => {
      uint process; GetWindowThreadProcessId(window, out process);
      if(process != pid) return true;
      RECT r; GetWindowRect(window, out r); double scale = GetDpiForWindow(window) / 96.0;
      if(Math.Abs((r.right-r.left)/scale - 136) < 2 && Math.Abs((r.bottom-r.top)/scale - 72) < 2)
        Console.WriteLine("{{\"handle\":\"{0}\",\"visible\":{1},\"x\":{2},\"y\":{3}}}", window.ToInt64(), IsWindowVisible(window) ? "true" : "false", r.left, r.top);
      return true;
    }, IntPtr.Zero);
  }
}
'@
[CardWindow]::Read($ApplicationProcess)
