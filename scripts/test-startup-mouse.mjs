// Deliberately launches without Playwright's Chromium flags or renderer debugger.
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { connectMainInspector } from './main-inspector.mjs';
const require = createRequire(import.meta.url);
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'transcribe-startup-mouse-'));
const env = { ...process.env, TRANSCRIBE_TEST: '1', TRANSCRIBE_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.TRANSCRIBE_TEST_EXECUTABLE;
const mocked = process.argv.includes('--mock-api') || process.env.TRANSCRIBE_RAW_MOCK === '1';
const args = executablePath ? [`--user-data-dir=${directory}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] : ['.'];
const run = (script, args = []) => promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts', script), ...args], { windowsHide: true, timeout: 15000 });
let seed, targetApp, desktop, inspector;
try {
  seed = await electron.launch({ ...(executablePath ? { executablePath } : {}), args, env, timeout: 30000 });
  await expect.poll(() => seed.windows().some(page => page.url().includes('index.html') && !page.url().includes('#overlay'))).toBe(true);
  const main = seed.windows().find(page => page.url().includes('index.html') && !page.url().includes('#overlay'));
  const actual = await seed.evaluate(({ app }) => app.getPath('userData'));
  if (path.resolve(actual).toLowerCase() !== directory.toLowerCase()) throw new Error('Perfil não isolado.');
  await main.evaluate(() => window.transcribe.saveKey('sk-test-only-startup-mouse-no-live-key'));
  await seed.close(); seed = undefined;
  await fs.unlink(path.join(directory, 'diagnostics.jsonl'));
  targetApp = await electron.launch({ args: ['scripts/fixtures/text-target.cjs', `--user-data-dir=${path.join(directory, 'target')}`], env, timeout: 30000 });
  await targetApp.firstWindow();
  const targetHandle = await targetApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
  const launchArgs = mocked ? ['--inspect=0', ...args] : args;
  desktop = spawn(executablePath || require('electron'), launchArgs, { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  if (mocked) {
    inspector = await connectMainInspector(desktop);
    await inspector.evaluate('globalThis.__emptySpeech = false; globalThis.fetch = async () => new Response(JSON.stringify({ text: globalThis.__emptySpeech ? "" : "Texto de teste inserido." })); true');
  }
  let cardHandle;
  const readCard = async () => { const { stdout } = await run('read-card-window.ps1', ['-ApplicationProcess', String(desktop.pid), ...(cardHandle ? ['-TargetWindow', cardHandle] : [])]); return stdout.trim() ? JSON.parse(stdout.trim()) : null; };
  // Normal startup opens the settings-capable main window, never the card.
  await expect.poll(async () => (await fs.readFile(path.join(directory, 'diagnostics.jsonl'), 'utf8').catch(() => '')).includes('renderer_ready'), { timeout: 15000 }).toBe(true);
  if (inspector) await inspector.evaluate(`globalThis.__electron = process.getBuiltinModule('node:module').createRequire(process.cwd() + '/package.json')('electron');
    globalThis.__card = __electron.BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#overlay'));
    globalThis.__main = __electron.BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('#overlay'));
    __main.hide(); true`);
  if (inspector) cardHandle = await inspector.evaluate('__card.getNativeWindowHandle().readBigUInt64LE().toString()');
  if (inspector) await inspector.evaluate(`globalThis.__mouseEvents = []; __card.webContents.on('before-mouse-event', (_e, m) => { if (m.type !== 'mouseMove') { __mouseEvents.push({type:m.type,x:m.x,y:m.y}); if (__mouseEvents.length > 12) __mouseEvents.shift(); } }); true`);
  await run('test-focus.ps1', ['-TargetWindow', targetHandle]);
  await run('test-shortcut.ps1');
  await expect.poll(async () => (await readCard())?.visible, { timeout: 15000 }).toBe(true);
  const card = await readCard();
  const hit = (x, ...extra) => run('test-overlay-hit.ps1', ['-TargetWindow', card.handle, '-X', String(x), '-Y', '36', '-Click', ...extra]);
  await run('test-shortcut.ps1', ['-Key', 'Escape']);
  await new Promise(resolve => setTimeout(resolve, 1500));
  for (let cycle = 0; cycle < 4; cycle++) {
    const before = await readCard();
    await hit(22, '-HoldMilliseconds', '150', '-DragX', cycle % 2 ? '100' : '-100', '-DragY', cycle % 2 ? '80' : '-80');
    await expect.poll(async () => (await readCard())?.x, { timeout: 3000 }).not.toBe(before.x);
  }
  console.log('PASS: arrastar repetidamente na execução normal.');
  if (process.env.TRANSCRIBE_MOUSE_IDLE_MS) {
    console.log('Aguardando o card permanecer ocioso antes de testar os controles.');
    await new Promise(resolve => setTimeout(resolve, Number(process.env.TRANSCRIBE_MOUSE_IDLE_MS)));
  }
  if (mocked) {
    const target = targetApp.windows()[0];
    const phase = async () => {
      const events = (await fs.readFile(path.join(directory, 'diagnostics.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      return events.filter(event => event.event === 'state').at(-1)?.phase;
    };
    for (let cycle = 0; cycle < Number(process.env.TRANSCRIBE_MOUSE_CYCLES || 6); cycle++) {
      // Opening/minimizing settings must not change mouse input on the card.
      await inspector.evaluate('__main.show(); __main.minimize(); __main.hide(); true');
      await run('test-focus.ps1', ['-TargetWindow', targetHandle]); await target.getByRole('textbox').fill('');
      if (cycle % 2) {
        await hit(108);
        await expect.poll(async () => (await readCard())?.visible).toBe(false);
        await run('test-shortcut.ps1');
      } else await hit(64);
      await expect.poll(phase, { timeout: 15000 }).toBe('recording');
      await new Promise(resolve => setTimeout(resolve, 1200));
      await hit(64);
      await expect.poll(phase, { timeout: 7000, message: `Parar pelo mouse após reabrir, ciclo ${cycle + 1}` }).toBe('docked');
      await expect(target.getByRole('textbox')).toHaveValue('Texto de teste inserido.', { timeout: 15000 });
      console.log('PASS: iniciar e parar pelo mouse, ciclo', cycle + 1);
      const before = await readCard();
      await hit(22, '-HoldMilliseconds', '150', '-DragX', cycle % 2 ? '50' : '-50', '-DragY', cycle % 2 ? '40' : '-40');
      await expect.poll(async () => (await readCard())?.x).not.toBe(before.x);
    }
    await inspector.evaluate('globalThis.__emptySpeech = true');
    await hit(64);
    await expect.poll(phase, { timeout: 15000 }).toBe('recording');
    await new Promise(resolve => setTimeout(resolve, 1200));
    await hit(64);
    await expect.poll(phase, { timeout: 15000 }).toBe('error');
    const beforeErrorDrag = await readCard();
    await hit(22, '-HoldMilliseconds', '150', '-DragX', '-60', '-DragY', '-40');
    await expect.poll(async () => (await readCard())?.x).not.toBe(beforeErrorDrag.x);
    await inspector.evaluate('globalThis.__emptySpeech = false');
    await target.getByRole('textbox').fill('');
    await hit(64);
    await expect.poll(phase, { timeout: 15000 }).toBe('recording');
    await new Promise(resolve => setTimeout(resolve, 1200));
    await hit(64);
    await expect.poll(phase, { timeout: 15000 }).toBe('docked');
    await expect(target.getByRole('textbox')).toHaveValue('Texto de teste inserido.');
    console.log('PASS: após erro sem fala, arrastar e gravar novamente pelo mouse.');
    if (process.env.TRANSCRIBE_TEST_CARD_CRASH === '1') {
      await target.getByRole('textbox').fill('');
      await hit(64);
      await expect.poll(phase, { timeout: 15000 }).toBe('recording');
      await inspector.evaluate('__card.webContents.forcefullyCrashRenderer(); true');
      await expect.poll(() => inspector.evaluate('__card.webContents.isCrashed()'), { timeout: 10000 }).toBe(false);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const beforeRecoveryDrag = await readCard();
      await hit(22, '-HoldMilliseconds', '150', '-DragX', '60', '-DragY', '40');
      await expect.poll(async () => (await readCard())?.x).not.toBe(beforeRecoveryDrag.x);
      await hit(64);
      await expect.poll(phase, { timeout: 15000 }).toBe('docked');
      await expect(target.getByRole('textbox')).toHaveValue('Texto de teste inserido.');
      console.log('PASS: renderer do card recuperado durante gravação; parar pelo mouse preserva o ditado e seu destino.');
    }
  }
  await run('test-overlay-hit.ps1', ['-TargetWindow', card.handle, '-X', '108', '-Y', '36', '-Click']);
  await expect.poll(async () => (await readCard())?.visible, { timeout: 3000 }).toBe(false);
  console.log('PASS: sem flags de automação do Chromium, o card responde ao mouse com outro aplicativo em primeiro plano.');
} catch (error) {
  if (inspector) console.error('Estado do perfil de teste:', await inspector.evaluate('({mouse: __mouseEvents, windows: __electron.BrowserWindow.getAllWindows().map(w => ({ bounds: w.getBounds(), visible: w.isVisible(), crashed: w.webContents.isCrashed(), overlay: w.webContents.getURL().includes("#overlay") }))})').catch(() => 'indisponível'));
  throw error;
} finally {
  inspector?.close();
  if (desktop) { desktop.kill(); await new Promise(resolve => desktop.exitCode !== null ? resolve() : desktop.once('exit', resolve)); }
  await seed?.close(); await targetApp?.close();
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
}
