import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const require = createRequire(import.meta.url);
const { captureTarget, pasteToTarget } = require('../electron/native.cjs');
const cwd = process.cwd();
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transcribe-e2e-'));
await fs.mkdir('test-results', { recursive: true });
const env = { ...process.env, TRANSCRIBE_TEST: '1', TRANSCRIBE_TEST_DATA: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.TRANSCRIBE_TEST_EXECUTABLE;
const args = executablePath ? [`--user-data-dir=${dataDir}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] : ['.'];
const desktop = await electron.launch({ ...(executablePath ? { executablePath } : {}), args, cwd, env, timeout: 30000 });
const errors = [];
try {
  const actualData = await desktop.evaluate(({ app }) => app.getPath('userData'));
  if (path.resolve(actualData).toLowerCase() !== path.resolve(dataDir).toLowerCase()) throw new Error('Teste precisa de perfil isolado.');
  await expect.poll(() => desktop.windows().some(window => window.url().includes('index.html') && !window.url().includes('#overlay')), { timeout: 15000 }).toBe(true);
  const page = desktop.windows().find(window => window.url().includes('index.html') && !window.url().includes('#overlay'));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.log('RENDERER:', message.text()); });
  await page.evaluate(() => {
    window.__capturedTracks = [];
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => { const stream = await capture(constraints); window.__capturedTracks.push(...stream.getTracks()); return stream; };
  });
  await expect(page.getByRole('heading', { name: 'Sua voz, em palavras.' })).toBeVisible();
  await expect(page.getByText('Falta só um detalhe para começar')).toBeVisible();
  await page.screenshot({ path: 'test-results/home.png' });
  console.log('PASS: aplicativo abre com onboarding e interface real.');

  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByLabel('Chave de API', { exact: true }).fill('sk-test-only-transcribe-fixture-no-live-key');
  await page.getByRole('button', { name: 'Salvar chave' }).click();
  await expect(page.getByText('Chave salva', { exact: true })).toBeVisible();
  const preferences = await fs.readFile(path.join(dataDir, 'preferences.json'), 'utf8');
  if (preferences.includes('sk-test-only')) throw new Error('Chave salva em texto puro.');
  const state = await page.evaluate(() => window.transcribe.getState());
  if (JSON.stringify(state).includes('sk-test-only')) throw new Error('Chave exposta no renderer.');
  await page.getByLabel('Idioma da fala', { exact: true }).selectOption('pt');
  await page.screenshot({ path: 'test-results/settings.png' });
  console.log('PASS: configuração persiste; chave criptografada e isolada do renderer.');

  await desktop.evaluate(() => {
    globalThis.__requestCount = 0;
    globalThis.fetch = async (_url, init) => {
      globalThis.__requestCount++;
      globalThis.__lastRequest = { model: init.body?.get('model'), language: init.body?.get('language'), size: init.body?.get('file')?.size };
      return new Response(JSON.stringify({ text: 'Uma ideia simples pode se transformar em algo extraordinário.' }), { status: 200 });
    };
  });
  await page.getByRole('button', { name: 'Transcrever', exact: true }).click();
  await page.getByRole('button', { name: 'Começar a falar' }).click();
  await expect(page.getByRole('button', { name: 'Terminar gravação' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.time')).not.toHaveText('00:00', { timeout: 5000 });
  await page.screenshot({ path: 'test-results/recording.png' });
  await page.getByRole('button', { name: 'Terminar gravação' }).click();
  await expect(page.getByLabel('Texto transcrito')).toHaveValue('Uma ideia simples pode se transformar em algo extraordinário.', { timeout: 15000 });
  const request = await desktop.evaluate(() => globalThis.__lastRequest);
  if (request.model !== 'gpt-transcribe' || request.language !== 'pt' || request.size < 100) throw new Error(`Requisição incorreta: ${JSON.stringify(request)}`);
  await page.getByRole('button', { name: 'Copiar texto', exact: true }).click();
  const copied = await desktop.evaluate(async ({ clipboard }) => clipboard.readText());
  if (!copied.includes('Uma ideia simples')) throw new Error('Cópia falhou.');
  await page.screenshot({ path: 'test-results/result.png' });
  console.log('PASS: captura PCM real com microfone de teste → WAV → IPC → multipart GPT Transcribe → resposta → copiar.');

  await page.getByRole('button', { name: /Histórico/ }).click();
  await expect(page.locator('.history-item')).toHaveCount(1);
  await page.getByPlaceholder('Buscar nas suas palavras…').fill('inexistente');
  await expect(page.getByRole('heading', { name: 'Nenhuma palavra encontrada.' })).toBeVisible();
  await page.getByPlaceholder('Buscar nas suas palavras…').fill('ideia');
  await expect(page.locator('.history-item')).toHaveCount(1);
  const historyFile = await fs.readFile(path.join(dataDir, 'history.enc'), 'utf8');
  if (historyFile.includes('extraordinário')) throw new Error('Histórico em texto puro.');
  await page.screenshot({ path: 'test-results/history.png' });
  console.log('PASS: histórico criptografado e busca.');

  await desktop.evaluate(() => { globalThis.fetch = async () => new Response('{"error":{"code":"insufficient_quota"}}', { status: 429 }); });
  await page.getByRole('button', { name: 'Transcrever', exact: true }).click();
  await page.getByLabel('Importar arquivo de áudio', { exact: true }).setInputFiles({ name: 'teste.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(512, 1) });
  await expect(page.getByRole('alert')).toContainText('sem créditos');
  await desktop.evaluate(() => { globalThis.fetch = async () => new Response('{"text":"Arquivo recuperado após tentar novamente."}'); });
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByLabel('Texto transcrito')).toHaveValue('Arquivo recuperado após tentar novamente.');
  console.log('PASS: importação, tratamento de quota e reenvio do áudio.');

  await desktop.evaluate(() => { globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort')))); });
  await page.getByLabel('Importar arquivo de áudio', { exact: true }).setInputFiles({ name: 'cancelar.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(512, 1) });
  await expect(page.getByRole('button', { name: 'Transcrevendo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Começar a falar' })).toBeVisible();
  await expect.poll(async () => (await page.evaluate(() => window.transcribe.getHistory())).length).toBe(2);
  console.log('PASS: cancelar interrompe requisição sem criar histórico falso.');

  if (process.platform === 'win32') {
    const focusNative = handle => promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(cwd, 'scripts/test-focus.ps1'), '-TargetWindow', handle], { windowsHide: true, timeout: 10000 });
    const targetPromise = desktop.waitForEvent('window');
    await desktop.evaluate(async ({ BrowserWindow, clipboard }) => {
      globalThis.__target = new BrowserWindow({ width: 500, height: 220, alwaysOnTop: true, title: 'Transcribe — teste de inserção' });
      await globalThis.__target.loadURL('data:text/html,<title>Teste de inserção</title><textarea autofocus aria-label="Destino" style="width:95%;height:130px"></textarea>');
      globalThis.__target.show(); globalThis.__target.focus();
      await clipboard.writeText('Texto inserido pelo Transcribe.');
    });
    const targetPage = await targetPromise;
    await targetPage.bringToFront();
    await targetPage.getByRole('textbox').click();
    const expectedTarget = await desktop.evaluate(() => globalThis.__target.getNativeWindowHandle().readBigUInt64LE().toString());
    await focusNative(expectedTarget);
    await expect.poll(captureTarget, { timeout: 10000 }).toBe(expectedTarget);
    const target = await captureTarget();
    const nativeStatus = await pasteToTarget(target);
    if (nativeStatus !== 'pasted') throw new Error(`Inserção nativa falhou: ${nativeStatus}`);
    await expect(targetPage.getByRole('textbox')).toHaveValue('Texto inserido pelo Transcribe.');
    await desktop.evaluate(({ BrowserWindow }) => { const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html') && !window.webContents.getURL().includes('#overlay')); main.show(); main.focus(); });
    await focusNative(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html') && !window.webContents.getURL().includes('#overlay')).getNativeWindowHandle().readBigUInt64LE().toString()));
    await expect.poll(() => pasteToTarget(target)).toBe('focus-changed');
    console.log('PASS: inserção nativa Windows e recusa quando o foco muda.');
    await desktop.evaluate(() => {
      globalThis.fetch = async () => new Response('{"text":"Ditado por atalho global funcionando."}');
      globalThis.__target.show(); globalThis.__target.focus();
    });
    await focusNative(expectedTarget);
    await targetPage.getByRole('textbox').fill('');
    const pressShortcut = () => promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(cwd, 'scripts/test-shortcut.ps1')], { windowsHide: true, timeout: 10000 });
    await pressShortcut();
    await expect(page.getByRole('button', { name: 'Terminar gravação' })).toBeVisible({ timeout: 15000 });
    const recordingTarget = await captureTarget();
    if (recordingTarget !== target) {
      const handles = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ handle: window.getNativeWindowHandle().readBigUInt64LE().toString(), overlay: window.webContents.getURL().includes('#overlay'), focused: window.isFocused() })));
      throw new Error(`Foco mudou durante gravação: ${JSON.stringify({ expected: target, actual: recordingTarget, handles })}`);
    }
    await expect(page.locator('.time')).not.toHaveText('00:00');
    await pressShortcut();
    await expect(targetPage.getByRole('textbox')).toHaveValue('Ditado por atalho global funcionando.', { timeout: 15000 });
    console.log('PASS: atalho global real → gravação sem roubar foco → transcrição → inserção automática.');
    const overlayPage = desktop.windows().find(window => window.url().includes('#overlay'));
    const overlayHandle = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('#overlay')).getNativeWindowHandle().readBigUInt64LE().toString());
    const physicalOverlay = async (name, click = false, extra = []) => {
      const box = await overlayPage.getByRole('button', { name, exact: true }).boundingBox();
      if (!box) throw new Error('Controle flutuante ausente.');
      const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(cwd, 'scripts/test-overlay-hit.ps1'), '-TargetWindow', overlayHandle, '-X', String(Math.round(box.x + box.width / 2)), '-Y', String(Math.round(box.y + box.height / 2))];
      if (click) args.push('-Click');
      args.push(...extra);
      await promisify(execFile)('powershell.exe', args, { windowsHide: true, timeout: 10000 });
    };
    const pressKey = (key, action = 'press') => promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(cwd, 'scripts/test-shortcut.ps1'), '-Key', key, '-Action', action], { windowsHide: true, timeout: 10000 });
    await targetPage.evaluate(() => {
      window.enterCount = 0; window.escapeCount = 0; window.enterUpCount = 0; window.escapeUpCount = 0;
      document.addEventListener('keydown', event => { if (event.key === 'Enter') window.enterCount++; if (event.key === 'Escape') window.escapeCount++; });
      document.addEventListener('keyup', event => { if (event.key === 'Enter') window.enterUpCount++; if (event.key === 'Escape') window.escapeUpCount++; });
    });
    const released = () => expect.poll(() => desktop.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Enter') || globalShortcut.isRegistered('Escape')), { timeout: 15000 }).toBe(false);
    const begin = async () => {
      await released();
      await desktop.evaluate(() => { globalThis.__target.show(); globalThis.__target.focus(); });
      await focusNative(expectedTarget);
      await targetPage.getByRole('textbox').fill('');
      await expect.poll(captureTarget, { timeout: 10000 }).toBe(target);
      await pressShortcut();
      await expect(page.getByRole('button', { name: 'Terminar gravação' })).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.time')).not.toHaveText('00:00');
    };

    if (!process.env.TRANSCRIBE_COMPACT_ONLY) {
    await desktop.evaluate(() => { globalThis.fetch = (_url, init) => new Promise((resolve, reject) => { globalThis.__resolveTranscript = () => resolve(new Response('{"text":"Concluído com Enter, sem enviar."}')); init.signal.addEventListener('abort', () => reject(new Error('abort'))); }); });
    await begin();
    await physicalOverlay('Parar e inserir texto');
    await overlayPage.screenshot({ path: 'test-results/overlay-controls.png' });
    await pressKey('Enter');
    await expect(page.getByRole('button', { name: 'Transcrevendo', exact: true })).toBeVisible();
    await pressKey('Enter');
    if (await targetPage.evaluate(() => window.enterCount) !== 0) throw new Error('Enter escapou durante gravação/transcrição.');
    if (await targetPage.evaluate(() => window.enterUpCount) !== 0) throw new Error('Soltar Enter escapou durante gravação/transcrição.');
    await desktop.evaluate(() => globalThis.__resolveTranscript());
    await expect(targetPage.getByRole('textbox')).toHaveValue('Concluído com Enter, sem enviar.', { timeout: 15000 });
    await released();
    await pressKey('Enter');
    await expect.poll(() => targetPage.evaluate(() => window.enterCount)).toBe(1);
    await expect(targetPage.getByRole('textbox')).toHaveValue('Concluído com Enter, sem enviar.\n');
    console.log('PASS: primeiro Enter conclui, Enter extra durante API é consumido, próximo Enter após entrega funciona normalmente.');

    await desktop.evaluate(() => { globalThis.fetch = async () => new Response('{"text":"Segurar Enter não envia o texto."}'); });
    await begin();
    try {
      await pressKey('Enter', 'down');
      await expect(targetPage.getByRole('textbox')).toHaveValue('Segurar Enter não envia o texto.', { timeout: 15000 });
      if (!await desktop.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Enter'))) throw new Error('Enter liberado antes de soltar a tecla.');
      await pressKey('Enter', 'down');
      if (await targetPage.evaluate(() => window.enterCount) !== 1) throw new Error('Repetição de Enter escapou para o destino.');
    } finally { await pressKey('Enter', 'up'); }
    await released();
    console.log('PASS: segurar/repetir Enter não envia; captura termina após soltar a tecla.');

    const historyBeforeCancel = (await page.evaluate(() => window.transcribe.getHistory())).length;
    await begin();
    await pressKey('Escape');
    await expect(page.getByRole('button', { name: 'Começar a falar' })).toBeVisible();
    await released();
    await expect(targetPage.getByRole('textbox')).toHaveValue('');
    if (await targetPage.evaluate(() => window.escapeCount) !== 0) throw new Error('Esc escapou da gravação.');
    if (await targetPage.evaluate(() => window.escapeUpCount) !== 0) throw new Error('Soltar Esc escapou da gravação.');
    if ((await page.evaluate(() => window.transcribe.getHistory())).length !== historyBeforeCancel) throw new Error('Cancelamento criou uma transcrição.');
    await pressKey('Escape');
    await expect.poll(() => targetPage.evaluate(() => window.escapeCount)).toBe(1);
    console.log('PASS: Esc cancela sem colar nem salvar, e volta a funcionar normalmente fora do ditado.');

    const historyBeforeRequestCancel = (await page.evaluate(() => window.transcribe.getHistory())).length;
    await desktop.evaluate(() => { globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort')))); });
    await begin();
    await pressKey('Enter');
    await expect(page.getByRole('button', { name: 'Transcrevendo', exact: true })).toBeVisible();
    await pressKey('Escape');
    await expect(page.getByRole('button', { name: 'Começar a falar' })).toBeVisible();
    await released();
    await expect(page.locator('.record-error')).toHaveCount(0);
    await expect(targetPage.getByRole('textbox')).toHaveValue('');
    if ((await page.evaluate(() => window.transcribe.getHistory())).length !== historyBeforeRequestCancel) throw new Error('Esc durante API salvou texto.');
    console.log('PASS: Esc durante API aborta, descarta áudio e libera teclado sem erro falso.');

    await page.evaluate(() => { window.__getUserMedia = navigator.mediaDevices.getUserMedia; navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
    await focusNative(expectedTarget);
    await pressShortcut();
    await expect(page.locator('.record-error')).toContainText('acesso ao microfone foi negado');
    await released();
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = window.__getUserMedia; });
    console.log('PASS: negar microfone também libera Enter e Esc.');

    await desktop.evaluate(() => { globalThis.fetch = async () => new Response('{"text":"Segurar Enter não envia o texto."}'); });
    await begin();
    await physicalOverlay('Parar e inserir texto', true);
    if (await captureTarget() !== target) throw new Error('Clicar em Concluir roubou o foco.');
    await expect(targetPage.getByRole('textbox')).toHaveValue('Segurar Enter não envia o texto.', { timeout: 15000 });
    await released();
    await begin();
    await physicalOverlay('Fechar card', true);
    await expect(page.getByRole('button', { name: 'Começar a falar' })).toBeVisible();
    await released();
    if (await captureTarget() !== target) throw new Error('Clicar em Cancelar roubou o foco.');
    await expect(targetPage.getByRole('textbox')).toHaveValue('');
    console.log('PASS: cliques físicos do Windows concluem e cancelam na barra visível sem roubar o foco.');

    }

    await desktop.evaluate(() => {
      globalThis.__chunks = [];
      globalThis.fetch = async (_url, init) => {
        const count = globalThis.__chunks.length + 1;
        globalThis.__chunks.push({ prompt: init.body.get('prompt'), model: init.body.get('model') });
        return new Response(JSON.stringify({ text: `Trecho ${count}.` }));
      };
    });
    await begin();
    await expect.poll(() => desktop.evaluate(() => globalThis.__chunks.length), { timeout: 20000 }).toBeGreaterThan(0);
    await expect(overlayPage.locator('.overlay-preview, .overlay-caption, footer')).toHaveCount(0);
    const compactBounds = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('#overlay')).getBounds());
    if (compactBounds.width !== 136 || compactBounds.height !== 72) throw new Error('Card cresceu durante o ditado.');
    await expect(targetPage.getByRole('textbox')).toHaveValue('');
    await overlayPage.screenshot({ path: 'test-results/overlay-compact-recording.png' });
    await focusNative(expectedTarget);
    await pressKey('Enter');
    await released();
    const chunks = await desktop.evaluate(() => globalThis.__chunks);
    await expect(targetPage.getByRole('textbox')).toHaveValue(chunks.map((_, i) => `Trecho ${i + 1}.`).join(' '));
    if (chunks.some(item => item.model !== 'gpt-transcribe')) throw new Error('Modelo do ditado foi alterado.');
    if (chunks.length > 1 && chunks[1].prompt !== 'Trecho 1.') throw new Error('Contexto perdido entre trechos.');
    await expect(overlayPage.locator('.dictation-overlay')).toHaveClass(/docked/);
    await expect.poll(() => page.evaluate(() => window.__capturedTracks.every(track => track.readyState === 'ended'))).toBe(true);
    const dockBounds = await desktop.evaluate(({ BrowserWindow, screen }) => { const bar = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('#overlay')); return { bounds: bar.getBounds(), area: screen.getDisplayMatching(bar.getBounds()).workArea, visible: bar.isVisible() }; });
    if (!dockBounds.visible || JSON.stringify(dockBounds.bounds) !== JSON.stringify(compactBounds)) throw new Error('Card mudou de tamanho ou posição ao concluir: ' + JSON.stringify(dockBounds));
    await overlayPage.screenshot({ path: 'test-results/overlay-docked.png' });
    console.log('PASS: card fixo de 136 × 72, sem textos ou prévia; inserção única ordenada e microfone desligado ao concluir.');

    await physicalOverlay('Mover card', true, ['-HoldMilliseconds', '150', '-DragX', '-100', '-DragY', '-80']);
    const moved = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('#overlay')).getBounds());
    if (moved.x >= dockBounds.bounds.x - 50 || moved.y >= dockBounds.bounds.y - 40) throw new Error('Arrastar não moveu a barra.');
    if (await captureTarget() !== target) throw new Error('Arrastar roubou foco.');

    const otherPromise = desktop.waitForEvent('window');
    await desktop.evaluate(async ({ BrowserWindow }) => {
      globalThis.__other = new BrowserWindow({ width: 500, height: 220, title: 'Outro destino de teste' });
      await globalThis.__other.loadURL('data:text/html,<textarea autofocus aria-label="Outro destino" style="width:95%;height:130px"></textarea>');
      globalThis.__other.show(); globalThis.__other.focus();
      globalThis.fetch = async () => new Response('{"text":"Ditado no novo campo."}');
    });
    const otherPage = await otherPromise;
    const otherHandle = await desktop.evaluate(() => globalThis.__other.getNativeWindowHandle().readBigUInt64LE().toString());
    await focusNative(otherHandle); await otherPage.getByRole('textbox').click();
    await physicalOverlay('Iniciar ditado', true);
    await expect(page.getByRole('button', { name: 'Terminar gravação' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.time')).not.toHaveText('00:00');
    await physicalOverlay('Parar e inserir texto', true);
    await expect(otherPage.getByRole('textbox')).toHaveValue('Ditado no novo campo.', { timeout: 15000 });
    await released();
    await otherPage.getByRole('textbox').fill('');
    await physicalOverlay('Iniciar ditado', true);
    await expect(page.getByRole('button', { name: 'Terminar gravação' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.time')).not.toHaveText('00:00');
    await focusNative(otherHandle);
    await physicalOverlay('Parar e inserir texto', true);
    await expect(otherPage.getByRole('textbox')).toHaveValue('Ditado no novo campo.', { timeout: 15000 });
    await released();
    await expect.poll(() => page.evaluate(() => window.__capturedTracks.every(track => track.readyState === 'ended'))).toBe(true);
    const afterDictation = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('#overlay')).getBounds());
    if (JSON.stringify(afterDictation) !== JSON.stringify(moved)) throw new Error('Card perdeu a posição escolhida.');
    console.log('PASS: arrastar preserva foco e posição; o mesmo botão inicia e para, inserindo no novo aplicativo.');
    await desktop.evaluate(() => globalThis.__other.destroy());

    await desktop.evaluate(() => { globalThis.fetch = async () => new Response('{"error":{"code":"insufficient_quota"}}', { status: 429 }); });
    await begin();
    await expect.poll(() => page.evaluate(async () => (await window.transcribe.getOverlayState()).previewError), { timeout: 20000 }).not.toBe('');
    await focusNative(expectedTarget);
    await pressKey('Enter'); await released();
    await expect(overlayPage.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
    await expect(targetPage.getByRole('textbox')).toHaveValue('');
    await page.evaluate(() => window.transcribe.saveKey('sk-test-updated-key-for-pending-segments-only'));
    await desktop.evaluate(() => {
      globalThis.__retryCount = 0;
      globalThis.fetch = async (_url, init) => {
        globalThis.__retryCount++;
        if (init.headers.Authorization !== 'Bearer sk-test-updated-key-for-pending-segments-only') return new Response('{"error":{"code":"invalid_api_key"}}', { status: 401 });
        return new Response('{"text":"Trecho recuperado."}');
      };
    });
    await physicalOverlay('Tentar novamente', true);
    await expect(overlayPage.locator('.dictation-overlay')).toHaveClass(/docked/, { timeout: 15000 }); await released();
    const retries = await desktop.evaluate(() => globalThis.__retryCount);
    await expect(targetPage.getByRole('textbox')).toHaveValue(Array(retries).fill('Trecho recuperado.').join(' '));
    console.log('PASS: falha mantém áudio pendente e permite retry pelo microfone, com chave atualizada e destino preservado.');

    await physicalOverlay('Fechar card', true);
    await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('#overlay')).isVisible())).toBe(false);
    await begin();
    await physicalOverlay('Fechar card', true);
    await expect(page.getByRole('button', { name: 'Começar a falar' })).toBeVisible(); await released();
    await expect(targetPage.getByRole('textbox')).toHaveValue('');
    await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('#overlay')).isVisible())).toBe(false);
    console.log('PASS: fechar oculta o card e cancela gravação; atalho reabre normalmente.');

    await desktop.evaluate(() => { globalThis.__target.setAlwaysOnTop(false); globalThis.__target.setFullScreen(true); });
    await expect.poll(() => desktop.evaluate(() => globalThis.__target.isFullScreen())).toBe(true);
    await begin();
    await physicalOverlay('Parar e inserir texto');
    await physicalOverlay('Fechar card', true);
    await released();
    await desktop.evaluate(() => globalThis.__target.setFullScreen(false));
    console.log('PASS: barra visível e clicável sobre janela em tela cheia, mantendo foco no destino.');
    await desktop.evaluate(() => globalThis.__target.destroy());
  }
  if (errors.length) throw new Error(`Erros no renderer: ${errors.join('\n')}`);
  console.log('PASS: nenhum erro JavaScript no renderer.');
} catch (error) {
  const main = desktop.windows().find(window => window.url().includes('index.html') && !window.url().includes('#overlay'));
  console.error('TEST STATE:', await main?.evaluate(() => window.transcribe.getOverlayState()).catch(() => null));
  if (process.platform === 'win32') console.error('FOCUS:', await captureTarget().catch(() => 'unavailable'));
  console.error('TEST WINDOWS:', await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ title: window.getTitle(), focused: window.isFocused(), handle: window.getNativeWindowHandle().toString('hex') }))).catch(() => []));
  throw error;
} finally {
  await desktop.close();
  await fs.rm(dataDir, { recursive: true, force: true });
}
