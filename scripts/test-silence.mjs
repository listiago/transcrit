import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'transcribe-silence-'));
const env = { ...process.env, TRANSCRIBE_TEST: '1', TRANSCRIBE_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.TRANSCRIBE_TEST_EXECUTABLE;
const args = executablePath ? [`--user-data-dir=${directory}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] : ['.'];
const desktop = await electron.launch({ ...(executablePath ? { executablePath } : {}), args, env, timeout: 30000 });
const run = (script, args = []) => promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts', script), ...args], { windowsHide: true, timeout: 15000 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  expect(path.resolve(await desktop.evaluate(({ app }) => app.getPath('userData'))).toLowerCase()).toBe(directory.toLowerCase());
  await expect.poll(() => desktop.windows().some(p => p.url().includes('index.html') && !p.url().includes('#overlay'))).toBe(true);
  const main = desktop.windows().find(p => p.url().includes('index.html') && !p.url().includes('#overlay'));
  const overlay = desktop.windows().find(p => p.url().includes('#overlay'));
  const errors = []; main.on('pageerror', e => errors.push(e.message)); overlay.on('pageerror', e => errors.push(e.message));
  await main.evaluate(() => window.transcribe.saveKey('sk-test-only-silence-no-live-key'));
  await main.reload();
  await main.getByRole('button', { name: 'Configurações', exact: true }).click();
  const toggle = main.getByRole('switch', { name: 'Finalizar após silêncio', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(main.getByLabel('Tempo de silêncio', { exact: true })).toHaveCount(0);
  await toggle.click();
  await expect(main.getByLabel('Tempo de silêncio', { exact: true })).toHaveValue('4');
  await main.getByLabel('Tempo de silêncio', { exact: true }).selectOption('2');
  await expect.poll(() => main.evaluate(async () => (await window.transcribe.getState()).settings.silenceSeconds)).toBe(2);
  await main.reload();
  await main.getByRole('button', { name: 'Configurações', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(main.getByLabel('Tempo de silêncio', { exact: true })).toHaveValue('2');
  await fs.mkdir('test-results', { recursive: true });
  await toggle.scrollIntoViewIfNeeded();
  await main.screenshot({ path: 'test-results/silence-settings.png' });
  console.log('PASS: desligado por padrão; ativação, duração e persistência pelas configurações.');
  const injectAudio = () => main.evaluate(() => {
    window.__tracks = [];
    navigator.mediaDevices.getUserMedia = async () => {
      await window.__sourceContext?.close();
      const ctx = new AudioContext({ sampleRate: 24000 }); window.__sourceContext = ctx;
      const destination = ctx.createMediaStreamDestination();
      const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(destination); window.__voiceGain = gain;
      for (const [frequency, level] of [[160, .06], [280, .025], [700, .035], [1200, .012], [2100, .02], [3600, .008]]) {
        const oscillator = ctx.createOscillator(), volume = ctx.createGain();
        oscillator.frequency.value = frequency; volume.gain.value = level;
        oscillator.connect(volume); volume.connect(gain); oscillator.start();
      }
      await ctx.resume(); window.__tracks.push(...destination.stream.getTracks()); return destination.stream;
    };
  });
  await injectAudio();
  const targetPromise = desktop.waitForEvent('window');
  await desktop.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('#overlay')).hide();
    globalThis.__target = new BrowserWindow({ width: 700, height: 320, title: 'Teste de silêncio', alwaysOnTop: true });
    await __target.loadURL('data:text/html,<textarea autofocus aria-label="Destino" style="width:95%;height:220px"></textarea>');
    globalThis.__calls = 0;
    globalThis.fetch = async () => { __calls++; return new Response('{"text":"Texto finalizado após silêncio."}'); };
  });
  const target = await targetPromise;
  const handles = await desktop.evaluate(({ BrowserWindow }) => ({ target: __target.getNativeWindowHandle().readBigUInt64LE().toString(), overlay: BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#overlay')).getNativeWindowHandle().readBigUInt64LE().toString() }));
  const phase = () => main.evaluate(async () => (await window.transcribe.getOverlayState()).status);
  const voice = level => main.evaluate(level => { window.__voiceGain.gain.value = level; }, level);
  const released = () => expect.poll(() => desktop.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Enter') || globalShortcut.isRegistered('Escape'))).toBe(false);
  const begin = async () => {
    await target.getByRole('textbox').fill(''); await run('test-focus.ps1', ['-TargetWindow', handles.target]);
    await run('test-shortcut.ps1'); await expect.poll(phase, { timeout: 15000 }).toBe('recording');
  };
  const click = async name => {
    const box = await overlay.getByRole('button', { name, exact: true }).boundingBox();
    await run('test-overlay-hit.ps1', ['-TargetWindow', handles.overlay, '-ExpectedForeground', handles.target, '-X', String(Math.round(box.x + box.width / 2)), '-Y', String(Math.round(box.y + box.height / 2)), '-Click']);
  };
  const heights = () => overlay.locator('.voice-spectrum i').evaluateAll(nodes => nodes.map(n => parseFloat(n.style.height)));
  await begin(); await pause(2500); expect(await phase()).toBe('recording');
  expect((await heights()).every(h => h === 3)).toBe(true);
  const centerBefore = await overlay.locator('.overlay-mic').boundingBox();
  await voice(1); await expect.poll(async () => Math.max(...await heights())).toBeGreaterThan(8);
  await overlay.screenshot({ path: 'test-results/card-listening.png', omitBackground: true });
  await pause(550); await voice(0); await pause(800); expect(await phase()).toBe('recording');
  await voice(1); await pause(600); const endedAt = Date.now(); await voice(0);
  await pause(1200); expect(await phase()).toBe('recording');
  await expect.poll(phase, { timeout: 8000, intervals: [100] }).toBe('docked');
  expect(Date.now() - endedAt).toBeGreaterThanOrEqual(1900);
  await expect(target.getByRole('textbox')).toHaveValue('Texto finalizado após silêncio.');
  await released(); expect(await main.evaluate(() => window.__tracks.every(t => t.readyState === 'ended'))).toBe(true);
  await pause(250);
  const centerAfter = await overlay.locator('.overlay-mic').boundingBox();
  expect(centerAfter.x + centerAfter.width / 2).toBeCloseTo(centerBefore.x + centerBefore.width / 2, 0);
  await expect(overlay.locator('.overlay-shortcuts')).toHaveCount(0);
  console.log('PASS: áudio real move as barras; silêncio inicial não conclui; nova fala reinicia prazo; conclusão automática insere uma vez e libera teclado/microfone.');
  await begin(); await voice(1); await pause(600); await voice(0);
  await click('Cancelar ditado (Esc)'); await released(); await pause(2300);
  await expect(target.getByRole('textbox')).toHaveValue(''); expect(await phase()).toBe('docked');
  console.log('PASS: dica Esc clicável cancela a contagem, sem inserir texto.');
  await begin(); await voice(1); await pause(600); await click('Concluir ditado (Enter)');
  await expect(target.getByRole('textbox')).toHaveValue('Texto finalizado após silêncio.'); await released();
  console.log('PASS: dica Enter clicável conclui e preserva foco no campo externo.');
  await main.evaluate(() => window.transcribe.saveSettings({ autoStop: false })); await main.reload(); await injectAudio();
  await begin(); await voice(1); await pause(600); await voice(0); await pause(2700);
  expect(await phase()).toBe('recording'); await expect(target.getByRole('textbox')).toHaveValue('');
  await click('Parar e inserir texto'); await expect(target.getByRole('textbox')).toHaveValue('Texto finalizado após silêncio.'); await released();
  expect(errors).toEqual([]);
  console.log('PASS: desativado mantém gravação durante silêncio até a parada manual; nenhum erro de renderer.');
} finally {
  await desktop.close();
  // mkdtemp created this isolated test profile; never clean the real app profile.
  if (!directory.startsWith(path.join(os.tmpdir(), 'transcribe-silence-'))) throw new Error('Diretório de teste inválido.');
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
}
