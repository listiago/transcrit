param([ValidateSet('capture', 'paste', 'release-keys')][string]$Action, [string]$TargetWindow = '0')
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class TranscribeNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION data; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT keyboard; [FieldOffset(0)] public MOUSEINPUT mouse; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort key; public ushort scan; public uint flags; public uint time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int x; public int y; public uint mouseData; public uint flags; public uint time; public UIntPtr extra; }
  public static bool Paste() {
    var inputs = new INPUT[4];
    ushort[] keys = { 0x11, 0x56, 0x56, 0x11 };
    for (int i = 0; i < 4; i++) { inputs[i].type = 1; inputs[i].data.keyboard.key = keys[i]; inputs[i].data.keyboard.flags = (uint)(i > 1 ? 2 : 0); }
    return SendInput(4, inputs, Marshal.SizeOf(typeof(INPUT))) == 4;
  }
}
'@
if ($Action -eq 'release-keys') {
  for ($attempt = 0; $attempt -lt 100; $attempt++) {
    $held = (([TranscribeNative]::GetAsyncKeyState(0x0D) -band 0x8000) -ne 0) -or (([TranscribeNative]::GetAsyncKeyState(0x1B) -band 0x8000) -ne 0)
    if (-not $held) { 'released'; exit 0 }
    Start-Sleep -Milliseconds 50
  }
  'held'
} elseif ($Action -eq 'capture') {
  [TranscribeNative]::GetForegroundWindow().ToInt64().ToString()
} else {
  $targetHandle = [long]::Parse($TargetWindow)
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $held = $false
    foreach ($key in @(0x10, 0x11, 0x12, 0x5B, 0x5C)) { if (([TranscribeNative]::GetAsyncKeyState($key) -band 0x8000) -ne 0) { $held = $true } }
    if (-not $held) { break }
    Start-Sleep -Milliseconds 50
  }
  if ($held -or $targetHandle -eq 0 -or [TranscribeNative]::GetForegroundWindow().ToInt64() -ne $targetHandle) { 'focus-changed'; exit 0 }
  if ([TranscribeNative]::Paste()) { 'pasted' } else { 'blocked' }
}
