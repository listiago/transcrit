param([Parameter(Mandatory=$true)][long]$TargetWindow, [int]$X, [int]$Y, [switch]$Click, [int]$HoldMilliseconds = 0, [int]$DragX = 0, [int]$DragY = 0, [long]$ExpectedForeground = 0)
$ErrorActionPreference = 'Stop'
# Exercise actual Windows hit testing; CDP clicks cannot detect an obscured bar.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class TranscribeOverlayTest {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window, ref POINT point);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  public static void Run(long handle, int x, int y, bool click, int hold, int dx, int dy, long expectedForeground) {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    IntPtr target = new IntPtr(handle);
    double scale = GetDpiForWindow(target) / 96.0;
    POINT location = new POINT { x = (int)Math.Round(x * scale), y = (int)Math.Round(y * scale) };
    if (!ClientToScreen(target, ref location)) throw new Exception("Janela de teste indisponivel");
    IntPtr hit = GetAncestor(WindowFromPoint(location), 2);
    if (hit != target) throw new Exception("A barra esta encoberta ou nao recebe cliques: " + hit.ToInt64());
    IntPtr foreground = GetForegroundWindow();
    if (expectedForeground != 0 && foreground.ToInt64() != expectedForeground) throw new Exception("O aplicativo de destino do teste perdeu o foco antes do clique");
    if (foreground == target) throw new Exception("A barra roubou o foco do campo");
    if (click) {
      POINT previous; GetCursorPos(out previous);
      SetCursorPos(location.x, location.y);
      mouse_event(2, 0, 0, 0, UIntPtr.Zero);
      try {
        if (hold > 0) System.Threading.Thread.Sleep(hold);
        if (dx != 0 || dy != 0) {
          for (int i = 1; i <= 10; i++) { SetCursorPos(location.x + (int)(dx * scale * i / 10), location.y + (int)(dy * scale * i / 10)); System.Threading.Thread.Sleep(30); }
        }
      } finally { mouse_event(4, 0, 0, 0, UIntPtr.Zero); }
      SetCursorPos(previous.x, previous.y);
      System.Threading.Thread.Sleep(100);
      if (GetForegroundWindow() != foreground) throw new Exception("O controle mudou o foco do aplicativo de destino");
    }
    Console.WriteLine("visible-clickable");
  }
}
'@
[TranscribeOverlayTest]::Run($TargetWindow, $X, $Y, $Click.IsPresent, $HoldMilliseconds, $DragX, $DragY, $ExpectedForeground)
