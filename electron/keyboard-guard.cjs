const { spawn } = require('node:child_process');
const path = require('node:path');
const { createInterface } = require('node:readline');

function startKeyboardGuard(onAction, onFailure) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, 'native', 'keyboard-guard.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let ready = false, stopped = false, exited = false, pending, stopPromise;
    const failure = () => new Error('Não foi possível proteger Enter e Esc. Tente iniciar a gravação novamente.');
    const startupTimer = setTimeout(() => { stopped = true; child.kill(); reject(failure()); }, 10000);
    const lines = createInterface({ input: child.stdout });
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(startupTimer); reject(failure()); });
    child.on('exit', () => {
      exited = true; clearTimeout(startupTimer); lines.close();
      if (pending) { clearTimeout(pending.timer); pending.reject(failure()); pending = undefined; }
      if (!ready) reject(failure());
      else if (!stopped) onFailure();
    });
    const guard = {
      waitForRelease() {
        if (exited) return Promise.reject(failure());
        return new Promise((done, failed) => {
          const timer = setTimeout(() => { pending = undefined; failed(failure()); }, 2000);
          pending = { resolve: done, reject: failed, timer };
          child.stdin.write('status\n');
        });
      },
      stop() {
        if (stopPromise) return stopPromise;
        stopped = true;
        if (exited) return Promise.resolve();
        stopPromise = new Promise(done => {
          const timer = setTimeout(() => { child.kill(); done(); }, 2000);
          child.once('exit', () => { clearTimeout(timer); done(); });
          child.stdin.end('stop\n');
        });
        return stopPromise;
      }
    };
    lines.on('line', line => {
      if (line === 'ready') { ready = true; clearTimeout(startupTimer); resolve(guard); }
      else if (line === 'enter' || line === 'escape') onAction(line === 'enter' ? 'finish' : 'cancel');
      else if ((line === 'released' || line === 'held') && pending) {
        const request = pending; pending = undefined; clearTimeout(request.timer);
        // Avoid spinning when the user is still holding a key.
        if (line === 'held') setTimeout(() => request.resolve(false), 50);
        else request.resolve(true);
      }
    });
  });
}
module.exports = { startKeyboardGuard };
