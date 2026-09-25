import { _electron as electron, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const data = await fs.mkdtemp(path.join(os.tmpdir(), 'transcribe-keys-'));
const env = { ...process.env, TRANSCRIBE_TEST: '1', TRANSCRIBE_TEST_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
const desktop = await electron.launch({ args: ['.'], env });
try {
  await expect.poll(() => desktop.windows().some(page => page.url().includes('index.html'))).toBe(true);
  const windowPromise = desktop.waitForEvent('window');
  const handle = await desktop.evaluate(async ({ app, BrowserWindow, globalShortcut }) => {
    globalThis.__field = new BrowserWindow({ width: 480, height: 250, alwaysOnTop: true });
    await globalThis.__field.loadURL('data:text/html,<textarea autofocus style="width:90%;height:130px"></textarea>');
    globalThis.__field.show(); globalThis.__field.focus();
    globalThis.__hits = [];
    if (!globalShortcut.register('Enter', () => globalThis.__hits.push('Enter')) || !globalShortcut.register('Escape', () => globalThis.__hits.push('Escape'))) throw new Error('Falha ao registrar teclas');
    const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json');
    globalThis.__guard = await require(app.getAppPath() + '/electron/keyboard-guard.cjs').startKeyboardGuard(action => globalThis.__hits.push(action === 'finish' ? 'Enter' : 'Escape'), () => {});
    return globalThis.__field.getNativeWindowHandle().readBigUInt64LE().toString();
  });
  const page = await windowPromise;
  await page.evaluate(() => { window.keys = []; for (const type of ['keydown', 'keyup']) document.addEventListener(type, event => window.keys.push(`${type}:${event.key}`)); });
  const run = (file, ...args) => promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(file), ...args], { windowsHide: true });
  await run('scripts/test-focus.ps1', '-TargetWindow', handle);
  for (const key of ['Enter', 'Escape']) await run('scripts/test-shortcut.ps1', '-Key', key);
  expect(await desktop.evaluate(() => globalThis.__hits)).toEqual(['Enter', 'Escape']);
  expect(await page.evaluate(() => window.keys)).toEqual([]);
  expect(await desktop.evaluate(() => globalThis.__guard.waitForRelease())).toBe(true);
  await desktop.evaluate(() => globalThis.__guard.stop());
  console.log('PASS: Enter/Esc não entregam keydown nem keyup ao campo de destino.');
} finally { await desktop.close(); await fs.rm(data, { recursive: true, force: true }); }
