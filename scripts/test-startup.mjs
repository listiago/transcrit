import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'transcribe-entry-test-'));
const env = { ...process.env, TRANSCRIBE_TEST: '1', TRANSCRIBE_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.TRANSCRIBE_TEST_EXECUTABLE;
const argumentsFor = hidden => executablePath
  ? [`--user-data-dir=${directory}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(hidden ? ['--hidden'] : [])]
  : ['.', ...(hidden ? ['--hidden'] : [])];
let desktop;
const launch = async hidden => {
  desktop = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: argumentsFor(hidden), env, timeout: 30000 });
  await expect.poll(() => desktop.windows().filter(page => page.url().includes('index.html')).length).toBe(2);
  const page = desktop.windows().find(page => page.url().includes('index.html') && !page.url().includes('#overlay'));
  await expect.poll(() => page.evaluate(async () => !!(await window.transcribe?.getState()))).toBe(true);
  return page;
};
const windows = () => desktop.evaluate(({ BrowserWindow }) => {
  const main = BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('#overlay'));
  const card = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('#overlay'));
  return { main: main.isVisible(), minimized: main.isMinimized(), card: card.isVisible() };
});
const reopened = () => desktop.evaluate(({ app }) => app.emit('second-instance', {}, ['Transcribe.exe'], process.cwd()));
try {
  let page = await launch(false);
  assert.equal((await windows()).main, true);
  await page.evaluate(() => window.transcribe.saveKey('sk-test-only-startup-saved-key'));
  await desktop.close();

  page = await launch(false);
  assert.equal((await page.evaluate(() => window.transcribe.getState())).keyStatus, 'ready');
  assert.deepEqual(await windows(), { main: true, minimized: false, card: false });
  await page.evaluate(() => window.transcribe.openSettings());
  await expect(page.getByRole('heading', { name: 'Conexão com a OpenAI' })).toBeVisible();
  await page.evaluate(() => window.transcribe.saveKey('sk-test-only-replacement-saved-key'));
  await page.evaluate(() => window.transcribe.close());
  assert.equal((await windows()).main, false);
  await reopened();
  assert.equal((await windows()).main, true);
  await page.evaluate(() => window.transcribe.minimize());
  await reopened();
  assert.equal((await windows()).minimized, false);
  console.log('PASS: saved key survives restart; normal launch, second launch and minimized restore open the main window and settings.');
  await desktop.close();

  page = await launch(true);
  assert.deepEqual(await windows(), { main: false, minimized: false, card: false });
  await desktop.evaluate(({ app }) => app.emit('second-instance', {}, ['Transcribe.exe', '--hidden'], process.cwd()));
  assert.equal((await windows()).main, false);
  await desktop.evaluate(() => {
    globalThis.__calls = 0;
    globalThis.fetch = async () => {
      if (++globalThis.__calls === 1) throw new Error('Network not ready after startup');
      return new Response('{"text":"Ditado recuperado."}');
    };
  });
  // Invoke the same recorder event as the shortcut, without injecting OS keys or pasting into another app.
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('#overlay')).webContents.send('toggle-recording'));
  await expect.poll(() => page.evaluate(() => window.transcribe.getOverlayState()).then(value => value.status), { timeout: 15000 }).toBe('recording');
  await expect.poll(() => desktop.evaluate(() => globalThis.__calls), { timeout: 20000 }).toBeGreaterThan(1);
  await page.evaluate(() => window.transcribe.recordingAction('finish'));
  await expect.poll(() => page.evaluate(() => window.transcribe.getOverlayState()).then(value => value.status), { timeout: 15000 }).toBe('docked');
  assert.equal((await windows()).main, false);
  await expect.poll(() => desktop.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Enter'))).toBe(false);
  console.log('PASS: hidden startup records in the minicard, recovers the first network failure and releases Enter.');

  await desktop.evaluate(() => { globalThis.fetch = async () => new Response('{"error":{"code":"invalid_api_key"}}', { status: 401 }); });
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('#overlay')).webContents.send('toggle-recording'));
  await expect.poll(() => page.evaluate(() => window.transcribe.getOverlayState()).then(value => value.status)).toBe('recording');
  await expect.poll(() => page.evaluate(() => window.transcribe.getOverlayState()).then(value => value.previewError), { timeout: 20000 }).not.toBe('');
  await page.evaluate(() => window.transcribe.recordingAction('finish'));
  await expect.poll(() => page.evaluate(() => window.transcribe.getOverlayState()).then(value => value.status)).toBe('error');
  const state = await page.evaluate(() => window.transcribe.getOverlayState());
  assert.equal(state.retryable, false);
  assert.equal(state.errorAction, 'settings');
  const card = desktop.windows().find(page => page.url().includes('#overlay'));
  await expect(card.getByRole('button', { name: 'Abrir configurações' })).toBeVisible();
  await page.evaluate(() => window.transcribe.openSettings());
  await expect(page.getByRole('heading', { name: 'Conexão com a OpenAI' })).toBeVisible();
  console.log('PASS: a rejected key leads to settings instead of an endless retry icon.');
} finally {
  await desktop?.close().catch(() => {});
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
