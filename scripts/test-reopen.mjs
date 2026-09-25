import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'transcribe-reopen-'));
const env = { ...process.env, TRANSCRIBE_TEST: '1', TRANSCRIBE_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.TRANSCRIBE_TEST_EXECUTABLE;
const args = executablePath ? [`--user-data-dir=${directory}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] : ['.'];
const desktop = await electron.launch({ ...(executablePath ? { executablePath } : {}), args, env, timeout: 30000 });
const run = (script, args = []) => promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts', script), ...args], { windowsHide: true, timeout: 15000 });
try {
  const actual = await desktop.evaluate(({ app }) => app.getPath('userData'));
  if (path.resolve(actual).toLowerCase() !== directory.toLowerCase()) throw new Error('Perfil não isolado.');
  await expect.poll(() => desktop.windows().some(page => page.url().includes('index.html') && !page.url().includes('#overlay'))).toBe(true);
  const main = desktop.windows().find(page => page.url().includes('index.html') && !page.url().includes('#overlay'));
  const overlay = desktop.windows().find(page => page.url().includes('#overlay'));
  const errors = []; main.on('pageerror', error => errors.push(error.message)); overlay.on('pageerror', error => errors.push(error.message));
  await main.evaluate(() => window.transcribe.saveKey('sk-test-only-reopen-regression-no-live-key'));
  await main.reload(); await expect(main.getByRole('button', { name: 'Começar a falar' })).toBeEnabled();
  await main.evaluate(() => {
    window.__tracks = []; window.__actions = [];
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async input => { const stream = await capture(input); window.__tracks.push(...stream.getTracks()); return stream; };
    window.transcribe.onRecordingAction(action => window.__actions.push(action));
  });
  const targetPromise = desktop.waitForEvent('window');
  await desktop.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('#overlay')).hide();
    globalThis.__target = new BrowserWindow({ width: 700, height: 320, alwaysOnTop: true, title: 'Teste de reabertura' });
    await globalThis.__target.loadURL('data:text/html,<textarea autofocus aria-label="Destino" style="width:95%;height:220px"></textarea>');
    globalThis.fetch = async () => new Response('{"text":"Primeiro ditado."}');
  });
  const target = await targetPromise;
  const handles = await desktop.evaluate(({ BrowserWindow }) => ({ target: globalThis.__target.getNativeWindowHandle().readBigUInt64LE().toString(), overlay: BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('#overlay')).getNativeWindowHandle().readBigUInt64LE().toString() }));
  const focus = () => run('test-focus.ps1', ['-TargetWindow', handles.target]);
  const shortcut = () => run('test-shortcut.ps1');
  const released = () => expect.poll(() => desktop.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Enter') || globalShortcut.isRegistered('Escape')), { timeout: 15000 }).toBe(false);
  const click = async name => {
    const box = await overlay.getByRole('button', { name, exact: true }).boundingBox();
    if (!box) throw new Error('Botão ausente: ' + name);
    try { await run('test-overlay-hit.ps1', ['-TargetWindow', handles.overlay, '-X', String(Math.round(box.x + box.width / 2)), '-Y', String(Math.round(box.y + box.height / 2)), '-Click']); }
    catch (error) {
      console.log('Hit test:', name, await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ handle: window.getNativeWindowHandle().readBigUInt64LE().toString(), bounds: window.getBounds(), visible: window.isVisible(), focused: window.isFocused(), overlay: window.webContents.getURL().includes('#overlay') }))));
      throw error;
    }
  };
  const begin = async () => {
    await released(); await focus(); await target.getByRole('textbox').fill(''); await shortcut();
    await expect(overlay.getByRole('button', { name: 'Parar e inserir texto' })).toBeEnabled({ timeout: 15000 });
    await expect(main.getByRole('button', { name: 'Terminar gravação' })).toBeVisible({ timeout: 15000 });
    await expect(main.locator('.time')).not.toHaveText('00:00');
    const hidden = await desktop.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html') && !window.webContents.getURL().includes('#overlay')).isVisible());
    if (!hidden) throw new Error('Teste deve gravar com a janela principal escondida.');
  };
  const stop = async expected => { await focus(); await click('Parar e inserir texto'); await expect(target.getByRole('textbox')).toHaveValue(expected, { timeout: 15000 }); await released(); };

  console.log('TEST: primeiro ditado.');
  await begin(); await stop('Primeiro ditado.');
  console.log('TEST: fechar e reabrir com trecho final vazio.');
  await click('Fechar card');
  await desktop.evaluate(() => { globalThis.__calls = 0; globalThis.fetch = async () => new Response(JSON.stringify({ text: ++globalThis.__calls === 1 ? 'Frase preservada após reabrir.' : '' })); });
  await begin();
  await expect.poll(() => desktop.evaluate(() => globalThis.__calls), { timeout: 20000 }).toBeGreaterThan(0);
  await focus(); await click('Parar e inserir texto');
  if (process.env.TRANSCRIBE_EXPECT_REOPEN_BUG === '1') {
    await expect(overlay.getByRole('button', { name: 'Tentar novamente' })).toBeVisible({ timeout: 15000 });
    await expect(target.getByRole('textbox')).toHaveValue('');
    console.log('REPRODUZIDO: trecho final vazio prende a versão anterior no ícone de retry, apesar da fala já transcrita.');
  } else {
    await expect(target.getByRole('textbox')).toHaveValue('Frase preservada após reabrir.', { timeout: 15000 }); await released();
    await expect(overlay.getByRole('button', { name: 'Iniciar ditado' })).toBeEnabled();
    console.log('PASS: fechar → atalho → gravação com trecho final vazio → clique em parar insere a fala, sem ciclo de retry.');

    await desktop.evaluate(() => { globalThis.fetch = async () => new Response('{"text":"Novo ditado funcionando."}'); });
    for (let cycle = 0; cycle < 2; cycle++) {
      const before = await main.evaluate(() => window.__actions.filter(action => action === 'cancel').length);
      await click('Fechar card'); await begin();
      const after = await main.evaluate(() => window.__actions.filter(action => action === 'cancel').length);
      if (after !== before) throw new Error('Fechar o card ocioso enviou cancelamento para a próxima gravação.');
      await stop('Novo ditado funcionando.');
    }
    console.log('PASS: reaberturas sucessivas mantêm microfone e controles funcionando com a janela principal escondida.');

    await main.evaluate(() => {
      window.__oldResumeReturned = false; let delay = true;
      const resume = AudioContext.prototype.resume;
      AudioContext.prototype.resume = async function() {
        await resume.call(this);
        if (delay) { delay = false; await new Promise(resolve => { window.__releaseOldResume = resolve; }); window.__oldResumeReturned = true; }
      };
    });
    await focus(); await target.getByRole('textbox').fill(''); await shortcut();
    await expect.poll(() => main.evaluate(() => typeof window.__releaseOldResume)).toBe('function');
    await click('Fechar card'); await released();
    await begin();
    await main.evaluate(async () => { window.__releaseOldResume(); await new Promise(resolve => setTimeout(resolve, 300)); });
    const captureAlive = await main.evaluate(() => window.__oldResumeReturned && window.__tracks.at(-1).readyState === 'live');
    if (!captureAlive) throw new Error('Uma preparação antiga encerrou o microfone da nova gravação.');
    await stop('Novo ditado funcionando.');
    await expect.poll(() => main.evaluate(() => window.__tracks.every(track => track.readyState === 'ended'))).toBe(true);
    console.log('PASS: fechar durante preparação e reabrir não permite que a sessão antiga desligue o novo microfone.');

    await desktop.evaluate(() => { globalThis.fetch = async () => new Response('{"text":""}'); });
    await begin(); await focus(); await click('Parar e inserir texto');
    await expect(overlay.getByRole('alert')).toContainText('Nenhuma fala foi identificada');
    await expect(overlay.getByRole('button', { name: 'Iniciar ditado' })).toBeEnabled();
    await expect(overlay.getByRole('button', { name: 'Tentar novamente' })).toHaveCount(0);
    await expect(target.getByRole('textbox')).toHaveValue(''); await released();
    await desktop.evaluate(() => { globalThis.fetch = async () => new Response('{"text":"Recuperado pelo microfone."}'); });
    await focus(); await click('Iniciar ditado');
    await expect(main.getByRole('button', { name: 'Terminar gravação' })).toBeVisible();
    await expect(main.locator('.time')).not.toHaveText('00:00');
    await stop('Recuperado pelo microfone.');
    console.log('PASS: áudio inteiramente sem fala permite gravar novamente pelo microfone, sem retry inútil.');
    if (errors.length) throw new Error(errors.join('\n'));
  }
} finally { await desktop.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 }); }
