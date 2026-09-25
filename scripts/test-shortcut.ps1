param([ValidateSet('shortcut', 'Enter', 'Escape')][string]$Key = 'shortcut', [ValidateSet('press', 'down', 'up')][string]$Action = 'press')
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class TranscribeShortcutTest {
  [DllImport("user32.dll")] static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  public static void Key(byte key, bool up) { keybd_event(key, 0, up ? 2U : 0U, UIntPtr.Zero); }
  public static void Press() {
    keybd_event(0x11, 0, 0, UIntPtr.Zero);
    keybd_event(0x10, 0, 0, UIntPtr.Zero);
    keybd_event(0x20, 0, 0, UIntPtr.Zero);
    keybd_event(0x20, 0, 2, UIntPtr.Zero);
    keybd_event(0x10, 0, 2, UIntPtr.Zero);
    keybd_event(0x11, 0, 2, UIntPtr.Zero);
  }
}
'@
if ($Key -eq 'shortcut') { [TranscribeShortcutTest]::Press() }
else {
  $code = if ($Key -eq 'Enter') { 0x0D } else { 0x1B }
  if ($Action -ne 'up') { [TranscribeShortcutTest]::Key($code, $false) }
  if ($Action -ne 'down') { [TranscribeShortcutTest]::Key($code, $true) }
}
