$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class TranscribeKeyboardGuard {
  delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
  static HookProc callback = Handle;
  static IntPtr hook;
  static volatile bool enterDown, escapeDown;
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT point; public uint privateValue; }
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetWindowsHookEx(int kind, HookProc proc, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr value);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr value, int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG message, IntPtr window, uint min, uint max);
  [DllImport("user32.dll")] static extern bool PeekMessage(out MSG message, IntPtr window, uint min, uint max, uint remove);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG message);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG message);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint message, UIntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  static void Send(string value) { Console.WriteLine(value); Console.Out.Flush(); }
  static IntPtr Handle(int code, IntPtr message, IntPtr data) {
    if (code >= 0) {
      int key = Marshal.ReadInt32(data);
      if (key == 13 || key == 27) {
        bool down = message.ToInt64() == 0x100 || message.ToInt64() == 0x104;
        bool up = message.ToInt64() == 0x101 || message.ToInt64() == 0x105;
        if (down) {
          bool wasDown = key == 13 ? enterDown : escapeDown;
          if (key == 13) enterDown = true; else escapeDown = true;
          if (!wasDown) Send(key == 13 ? "enter" : "escape");
          return new IntPtr(1);
        }
        if (up) { if (key == 13) enterDown = false; else escapeDown = false; return new IntPtr(1); }
      }
    }
    return CallNextHookEx(hook, code, message, data);
  }
  public static void Run() {
    uint threadId = GetCurrentThreadId();
    MSG message; PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
    hook = SetWindowsHookEx(13, callback, GetModuleHandle(null), 0);
    if (hook == IntPtr.Zero) throw new Exception("Nao foi possivel proteger Enter e Esc.");
    var reader = new Thread(() => {
      try {
        string command;
        while ((command = Console.ReadLine()) != null) {
          if (command == "status") Send(enterDown || escapeDown ? "held" : "released");
          if (command == "stop") break;
        }
      } finally { PostThreadMessage(threadId, 0x12, UIntPtr.Zero, IntPtr.Zero); }
    });
    reader.IsBackground = true; reader.Start(); Send("ready");
    try { while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref message); DispatchMessage(ref message); } }
    finally { UnhookWindowsHookEx(hook); }
  }
}
'@
[TranscribeKeyboardGuard]::Run()
