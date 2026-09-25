param([Parameter(Mandatory=$true)][long]$TargetWindow)
# Click only the known test window: Windows may refuse focus() from background tests.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class TranscribeFocusTest {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  public static void Focus(long handle) {
    RECT rect; POINT point;
    if (!GetWindowRect(new IntPtr(handle), out rect) || !GetCursorPos(out point)) throw new Exception("Janela de teste indisponivel");
    bool wasTopmost = (GetWindowLongPtr(new IntPtr(handle), -20).ToInt64() & 8) != 0;
    SetWindowPos(new IntPtr(handle), new IntPtr(-1), 0, 0, 0, 0, 0x13);
    SetCursorPos(rect.left + 50, rect.top + 90);
    mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero);
    if (!wasTopmost) SetWindowPos(new IntPtr(handle), new IntPtr(-2), 0, 0, 0, 0, 0x13);
    SetCursorPos(point.x, point.y);
  }
}
'@
[TranscribeFocusTest]::Focus($TargetWindow)
