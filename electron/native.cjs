const { execFile } = require('node:child_process');
const path = require('node:path');
const run = (file, args) => new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, timeout: 10000 }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
const windowsScript = () => path.join(__dirname, 'native', 'windows.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
async function captureTarget() {
  if (process.platform === 'win32') return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', windowsScript(), '-Action', 'capture']);
  if (process.platform === 'darwin') return run('/usr/bin/osascript', ['-e', 'tell application "System Events" to get bundle identifier of first application process whose frontmost is true']);
  return '';
}
async function pasteToTarget(target) {
  if (!target) return 'blocked';
  if (process.platform === 'win32') {
    if (!/^\d+$/.test(target)) return 'blocked';
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', windowsScript(), '-Action', 'paste', '-TargetWindow', target]);
  }
  if (process.platform === 'darwin') {
    return run('/usr/bin/osascript', ['-e', 'on run argv', '-e', 'tell application "System Events"', '-e', 'set currentApp to bundle identifier of first application process whose frontmost is true', '-e', 'if currentApp is not item 1 of argv then return "focus-changed"', '-e', 'key code 9 using command down', '-e', 'return "pasted"', '-e', 'end tell', '-e', 'end run', target]);
  }
  return 'blocked';
}
async function waitForControlKeysReleased() {
  if (process.platform === 'win32') return await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', windowsScript(), '-Action', 'release-keys']) === 'released';
  if (process.platform === 'darwin') {
    const script = 'ObjC.import("CoreGraphics"); function run() { for (var i = 0; i < 100; i++) { if (!$.CGEventSourceKeyState(0, 36) && !$.CGEventSourceKeyState(0, 76) && !$.CGEventSourceKeyState(0, 53)) return "released"; delay(0.05); } return "held"; }';
    return await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script]) === 'released';
  }
  return true;
}
module.exports = { captureTarget, pasteToTarget, waitForControlKeysReleased };
