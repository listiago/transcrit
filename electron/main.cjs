const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, screen, safeStorage, clipboard, shell, dialog, systemPreferences, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { Store } = require('./store.cjs');
const { MODEL, validateAudio, validateSettings, transcribeAudio } = require('./core.cjs');
const { captureTarget, pasteToTarget, waitForControlKeysReleased } = require('./native.cjs');
const { SessionControls } = require('./session-controls.cjs');
const { startKeyboardGuard } = require('./keyboard-guard.cjs');
const { raiseOverlay, showOverlay } = require('./overlay-window.cjs');
const { DictationSession } = require('./dictation-session.cjs');
const { Diagnostics } = require('./diagnostics.cjs');

const testMode = !app.isPackaged && process.env.TRANSCRIBE_TEST === '1';
if (testMode && process.env.TRANSCRIBE_TEST_DATA) {
  app.setPath('userData', process.env.TRANSCRIBE_TEST_DATA);
  app.setPath('sessionData', process.env.TRANSCRIBE_TEST_DATA);
}
if (testMode) { app.commandLine.appendSwitch('use-fake-ui-for-media-stream'); app.commandLine.appendSwitch('use-fake-device-for-media-stream'); }
app.setName('Transcribe');
app.setAppUserModelId('app.transcribe.desktop');
const singleInstance = testMode || app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
let mainWindow, overlay, tray, store, controller, guardStart, keyboardGuard, diagnostics;
let quitting = false, active = false, toggling = false, ready = false, target = '', shortcutSession = false, shortcutRegistered = false;
let dictation, anchor, overlayDisplay, hiddenByUser = false, pendingAction = '';
let overlayState = { status: 'idle', message: '', preview: '', pending: 0, previewError: '', retryable: false };
const controls = new SessionControls(globalShortcut, async () => {
    if (guardStart) await guardStart.catch(() => {});
    const released = keyboardGuard ? await keyboardGuard.waitForRelease() : await waitForControlKeysReleased();
    if (released && keyboardGuard) { await keyboardGuard.stop(); keyboardGuard = undefined; }
    return released;
  },
  () => { active = false; updateOverlay('processing'); mainWindow.webContents.send('recording-action', 'finish'); },
  () => { mainWindow.webContents.send('recording-action', 'cancel'); });
const releaseControls = () => controls.release().catch(async () => { await keyboardGuard?.stop(); keyboardGuard = undefined; });
const devURL = !app.isPackaged ? process.env.VITE_DEV_SERVER_URL : undefined;
const rendererURL = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
const allowedPage = url => devURL ? url === devURL || url.startsWith(`${devURL}/`) : url === rendererURL || url.startsWith(`${rendererURL}#`);
const publicState = () => ({ settings: store.settings(), hasKey: !!store.data.encryptedKey, keyStatus: store.keyStatus(), platform: process.platform, version: app.getVersion(), shortcutRegistered, warning: store.warning, secureStorage: safeStorage.isEncryptionAvailable() });

function showMain(page) {
  mainWindow.show(); mainWindow.focus();
  if (page) mainWindow.webContents.send('navigate', page);
}
function showEntry() {
  if (!mainWindow || !store) return;
  if (store.keyStatus() !== 'ready') { showMain('settings'); return; }
  hiddenByUser = false;
  updateOverlay(overlayState.status === 'idle' ? 'docked' : overlayState.status, overlayState.message);
}
function updateOverlay(status, message = '') {
  if (status !== overlayState.status) diagnostics?.write('state', { phase: status });
  overlayState = { ...overlayState, status, message, retryable: status === 'error' && !!dictation?.error };
  if (!overlay || overlay.isDestroyed()) return;
  overlay.webContents.send('overlay-state', overlayState);
  if (status === 'idle') { overlay.hide(); return; }
  if (hiddenByUser) return;
  overlayDisplay ||= screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const workArea = screen.getAllDisplays().find(display => display.id === overlayDisplay.id)?.workArea || screen.getPrimaryDisplay().workArea;
  showOverlay(overlay, workArea, status === 'docked', anchor);
}
function dockOverlay(message = '') {
  if (hiddenByUser || overlayState.status === 'idle') { updateOverlay('idle'); return; }
  const display = screen.getDisplayMatching(overlay.getBounds()); overlayDisplay = display;
  const bounds = overlay.getBounds();
  anchor = { right: bounds.x + bounds.width, top: bounds.y };
  updateOverlay('docked', message);
}
async function toggleRecording() {
  if (!ready || toggling || controller) return;
  if (controls.phase === 'recording' || controls.phase === 'starting') { controls.finish(); return; }
  if (controls.phase !== 'idle') return;
  if (!store.data.encryptedKey) { showMain('settings'); return; }
  toggling = true;
  hiddenByUser = false; pendingAction = '';
  try {
    if (!active) { shortcutSession = true; target = await captureTarget().catch(() => ''); }
    mainWindow.webContents.send('toggle-recording');
  } finally { setTimeout(() => { toggling = false; }, 350); }
}
function registerShortcut(value) { try { return globalShortcut.register(value, toggleRecording); } catch { return false; } }
function handle(name, fn, allowOverlay = false) {
  ipcMain.handle(name, async (event, ...args) => {
    try {
      const known = event.sender === mainWindow?.webContents || (allowOverlay && event.sender === overlay?.webContents);
      if (!known || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || !allowedPage(event.senderFrame.url)) throw new Error('Origem não autorizada.');
      return { ok: true, value: await fn(...args) };
    } catch (error) {
      diagnostics?.write('failure', { operation: name, code: error.code || 'unknown', httpStatus: error.httpStatus });
      return { ok: false, error: error.message || 'Não foi possível concluir esta ação.', code: error.code, retryable: error.retryable };
    }
  });
}
async function deliver(text, duration, source, requestTarget, fromShortcut, settings) {
      controls.setPhase('delivering');
      if (controls.owned.length) updateOverlay('inserting');
      const item = { id: randomUUID(), text, createdAt: new Date().toISOString(), duration: duration, source: source };
      let warning = '';
      try { store.addHistory(item); } catch { warning = 'O texto está pronto, mas não foi possível salvar no histórico.'; }
      let delivery = 'ready';
      if (fromShortcut) {
        try {
          await clipboard.writeText(text);
          delivery = 'copied';
          if (settings.autoPaste && requestTarget) {
            const isSelf = process.platform === 'win32' ? requestTarget === mainWindow.getNativeWindowHandle().readBigUInt64LE().toString() : requestTarget === (app.isPackaged ? 'app.transcribe.desktop' : 'com.github.Electron');
            if (!isSelf) {
              if (process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(false)) {
                delivery = await pasteToTarget(requestTarget).catch(() => 'blocked');
                if (delivery !== 'pasted') delivery = 'copied';
              }
            }
          }
        } catch { warning = 'O texto está pronto. Use o botão Copiar para levá-lo a outro aplicativo.'; }
      }
      await releaseControls();
      if (fromShortcut) dockOverlay( delivery === 'pasted' ? 'Texto inserido. Enter funciona normalmente.' : 'Texto pronto. Cole com ' + (process.platform === 'darwin' ? '⌘ V' : 'Ctrl + V'));
      else dockOverlay('Texto pronto no Transcribe');
      return { item, delivery, warning };
}
function installHandlers() {
  handle('begin-recording', async () => {
    if (controller) throw new Error('Aguarde a transcrição atual terminar.');
    if (!store.key()) throw new Error('Adicione sua chave OpenAI nas configurações para começar.');
    dictation?.cancel();
    const settings = store.settings();
    const next = new DictationSession((audio, signal, context) => transcribeAudio(audio, store.key(), settings, signal, fetch, context, { allowEmpty: true }), preview => {
      if (dictation !== next) return;
      overlayState = { ...overlayState, preview: preview.text, pending: preview.pending, previewError: preview.previewError };
      overlay?.webContents.send('overlay-state', overlayState);
    });
    dictation = next; next.requestTarget = target; next.fromShortcut = shortcutSession; next.settings = settings;
    if (pendingAction !== 'cancel') hiddenByUser = false;
    overlayState = { ...overlayState, preview: '', pending: 0, previewError: '', retryable: false };
    controls.arm(); updateOverlay('starting');
    if (pendingAction === 'finish') controls.finish();
    else if (pendingAction === 'cancel') controls.cancel();
    pendingAction = '';
    guardStart = startKeyboardGuard(action => action === 'finish' ? controls.finish() : controls.cancel(), () => controls.cancel());
    try { keyboardGuard = await guardStart; }
    catch (error) { await releaseControls(); throw error; }
    finally { guardStart = undefined; }
    return next.id;
  });
  handle('recording-action', action => {
    if (action === 'start') return toggleRecording();
    if (action === 'finish' || action === 'cancel') {
      if (toggling && controls.phase === 'idle') pendingAction = action;
      else if (action === 'finish') controls.finish(); else controls.cancel();
    }
    else if (action === 'retry' && overlayState.retryable && !controller) mainWindow.webContents.send('recording-action', 'retry');
    else throw new Error('Ação inválida.');
  }, true);
  handle('overlay-state', () => overlayState, true);
  handle('move-overlay', (dx, dy) => {
    if (![dx, dy].every(value => Number.isFinite(value) && Math.abs(value) <= 4000)) throw new Error('Posição inválida.');
    const bounds = overlay.getBounds();
    const display = screen.getDisplayNearestPoint({ x: Math.round(bounds.x + bounds.width / 2 + dx), y: Math.round(bounds.y + bounds.height / 2 + dy) });
    overlayDisplay = display; anchor = { right: bounds.x + bounds.width + dx, top: bounds.y + dy };
    showOverlay(overlay, display.workArea, overlayState.status === 'docked', anchor);
    const moved = overlay.getBounds(); anchor = { right: moved.x + moved.width, top: moved.y };
  }, true);
  handle('open-settings', () => { updateOverlay('idle'); showMain('settings'); }, true);
  handle('dismiss-overlay', () => {
    if (controls.phase === 'delivering' || controls.phase === 'releasing') return;
    hiddenByUser = true;
    if (toggling && controls.phase === 'idle') pendingAction = 'cancel';
    else if (controls.owned.length) controls.cancel();
    else if (dictation || controller) { dictation?.cancel(); dictation = undefined; mainWindow.webContents.send('recording-action', 'cancel'); }
    updateOverlay('idle');
  }, true);
  handle('state', publicState);
  handle('save-key', key => { store.saveKey(key); return publicState(); });
  handle('remove-key', () => { if (active || controller) throw new Error('Conclua a gravação antes de remover a chave.'); store.removeKey(); return publicState(); });
  handle('test-key', async () => {
    const key = store.key(); if (!key) throw new Error('Cadastre sua chave primeiro.');
    let response;
    try { response = await fetch(`https://api.openai.com/v1/models/${MODEL}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('Não foi possível conectar à OpenAI. Confira sua internet.'); }
    if (response.status === 401) throw new Error('A chave não foi aceita. Confira e salve novamente.');
    if (!response.ok) throw new Error('Não foi possível confirmar acesso ao modelo. Confira as permissões da chave e do projeto OpenAI.');
    return true;
  });
  handle('settings', input => {
    const patch = validateSettings(input), previous = store.settings();
    if (patch.shortcut && patch.shortcut !== previous.shortcut) {
      if (!registerShortcut(patch.shortcut)) throw new Error('Este atalho já está em uso. Escolha outro.');
    }
    try { store.saveSettings(patch); }
    catch (error) { if (patch.shortcut !== previous.shortcut && patch.shortcut) globalShortcut.unregister(patch.shortcut); throw error; }
    if (patch.shortcut && patch.shortcut !== previous.shortcut) { globalShortcut.unregister(previous.shortcut); shortcutRegistered = true; }
    if ('launchAtLogin' in patch && app.isPackaged) app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin, args: ['--hidden'] });
    return publicState();
  });
  handle('recording-state', (value, message = '') => {
    if (!['recording', 'processing', 'idle', 'error'].includes(value)) throw new Error('Estado inválido.');
    if (typeof message !== 'string' || message.length > 1000) throw new Error('Mensagem inválida.');
    active = value === 'recording';
    if (value === 'idle') dockOverlay();
    else if (controls.owned.length || shortcutSession || value === 'error') updateOverlay(value, value === 'error' ? message || 'Não foi possível concluir. Abra as configurações.' : '');
    if (value === 'recording' || value === 'processing') controls.setPhase(value);
    tray?.setToolTip(value === 'recording' ? 'Transcribe — Enter conclui. Esc cancela.' : 'Transcribe — Sua voz, em palavras');
    if (value === 'idle' || value === 'error') {
      if (value === 'error' && dictation && !dictation.closed) { dictation.cancel(); dictation = undefined; }
      target = ''; shortcutSession = false; void releaseControls();
    }
  });
  handle('microphone-permission', async () => process.platform !== 'darwin' || await systemPreferences.askForMediaAccess('microphone'));
  handle('append-segment', input => {
    if (!dictation || input?.id !== dictation.id) throw new Error('Esta gravação já terminou.');
    dictation.append(input);
  });
  handle('finish-dictation', async (id, duration, retry = false) => {
    const current = dictation;
    if (!current || id !== current.id || controller) throw new Error('Esta gravação não está disponível.');
    if (retry) {
      controls.arm();
      guardStart = startKeyboardGuard(action => action === 'cancel' && controls.cancel(), () => controls.cancel());
      try { keyboardGuard = await guardStart; } finally { guardStart = undefined; }
    }
    controls.setPhase('processing'); updateOverlay('processing'); controller = current.controller;
    try {
      const text = await current.finish(retry);
      if (dictation !== current || current.controller.signal.aborted) throw new Error('Transcrição cancelada.');
      const result = await deliver(text, Math.max(0, Math.min(Number(duration) || 0, 600)), 'mic', current.requestTarget, current.fromShortcut, current.settings);
      dictation = undefined; return result;
    } finally {
      await releaseControls();
      if (controller === current.controller) controller = undefined;
      active = false; target = ''; shortcutSession = false;
    }
  });
  handle('transcribe', async input => {
    if (controller || active || controls.owned.length) throw new Error('Aguarde a transcrição atual terminar.');
    const audio = validateAudio(input), key = store.key();
    if (!key) throw new Error('Adicione sua chave OpenAI nas configurações para começar.');
    dictation?.cancel(); dictation = undefined;
    const requestTarget = audio.source === 'mic' ? target : '';
    const fromShortcut = audio.source === 'mic' && shortcutSession;
    const settings = store.settings();
    controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]);
    try {
      const text = await transcribeAudio(audio, key, settings, signal);
      if (signal.aborted) throw new Error('Transcrição cancelada.');
      return await deliver(text, audio.duration, audio.source, requestTarget, fromShortcut, settings);
    } catch (error) { if (fromShortcut) updateOverlay(signal.aborted ? 'idle' : 'error', error.message); throw error; }
    finally { await releaseControls(); controller = undefined; target = ''; shortcutSession = false; active = false; }
  });
  handle('cancel', () => {
    if (controls.phase === 'delivering' || controls.phase === 'releasing') return false;
    controller?.abort(); dictation?.cancel(); dictation = undefined;
    controls.setPhase('cancelling'); active = false; target = ''; shortcutSession = false;
    overlayState = { ...overlayState, preview: '', previewError: '', pending: 0, retryable: false };
    dockOverlay('Ditado cancelado'); void releaseControls(); return true;
  });
  handle('history', () => store.history());
  handle('delete-history', id => { if (typeof id !== 'string') throw new Error('Registro inválido.'); store.deleteHistory(id); });
  handle('clear-history', () => store.clearHistory());
  const validateText = text => { if (typeof text !== 'string' || text.length > 500000) throw new Error('Texto inválido.'); return text; };
  handle('copy', text => clipboard.writeText(validateText(text)));
  handle('export', async text => {
    validateText(text);
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Salvar transcrição', defaultPath: `Transcribe-${new Date().toISOString().slice(0, 10)}.txt`, filters: [{ name: 'Texto', extensions: ['txt'] }] });
    if (!result.canceled && result.filePath) { await fs.promises.writeFile(result.filePath, text, 'utf8'); return true; }
    return false;
  });
  handle('external', name => {
    const links = { keys: 'https://platform.openai.com/api-keys', billing: 'https://platform.openai.com/settings/organization/billing/overview', microphone: process.platform === 'darwin' ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone' : 'ms-settings:privacy-microphone' };
    if (!Object.hasOwn(links, name)) throw new Error('Link inválido.');
    return shell.openExternal(links[name]);
  });
  handle('accessibility', () => process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(true));
  handle('minimize', () => mainWindow.minimize());
  handle('close', () => mainWindow.close());
}
function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!allowedPage(url)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
}
async function createWindows() {
  const icon = path.join(__dirname, '../resources/icon.png');
  const webPreferences = { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false };
  mainWindow = new BrowserWindow({ width: 1120, height: 800, minWidth: 860, minHeight: 670, show: false, backgroundColor: '#f8f7f4', title: 'Transcribe', icon, titleBarStyle: 'hidden', ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 20, y: 20 } } : {}), webPreferences });
  overlay = new BrowserWindow({ width: 450, height: 80, title: 'Transcribe — ditado', frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, focusable: false, acceptFirstMouse: true, ...(process.platform === 'darwin' ? { type: 'panel' } : {}), show: false, hasShadow: false, webPreferences });
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.on('show', () => raiseOverlay(overlay));
  overlay.on('always-on-top-changed', (_event, onTop) => { if (!onTop && overlay.isVisible()) raiseOverlay(overlay); });
  secureWindow(mainWindow); secureWindow(overlay);
  mainWindow.on('close', event => { if (!quitting) { event.preventDefault(); mainWindow.hide(); if (active || controller) updateOverlay(active ? 'recording' : 'processing'); } });
  mainWindow.on('minimize', () => { if (active || controller) updateOverlay(active ? 'recording' : 'processing'); });
  mainWindow.webContents.on('render-process-gone', () => { controller?.abort(); dictation?.cancel(); dictation = undefined; void releaseControls(); active = false; target = ''; shortcutSession = false; ready = false; updateOverlay('idle'); mainWindow.reload(); });
  mainWindow.webContents.on('did-finish-load', () => { ready = true; });
  await Promise.all([mainWindow.loadURL(devURL || rendererURL), overlay.loadURL((devURL || rendererURL) + '#overlay')]);
  if (!process.argv.includes('--hidden')) {
    if (store.keyStatus() === 'ready') updateOverlay('docked');
    else mainWindow.show();
  }
  tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 20, height: 20 }));
  tray.setToolTip('Transcribe — Sua voz, em palavras');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Transcribe', click: () => showMain() },
    { label: 'Iniciar / parar ditado', click: toggleRecording },
    { type: 'separator' }, { label: 'Configurações', click: () => showMain('settings') },
    { label: 'Sair do Transcribe', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', () => showMain());
}
if (singleInstance) app.whenReady().then(async () => {
  diagnostics = new Diagnostics(app.getPath('userData'));
  store = new Store(app.getPath('userData'), safeStorage);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(contents === mainWindow?.webContents && permission === 'media' && allowedPage(details.requestingUrl) && details.mediaTypes?.every(type => type === 'audio') === true));
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => contents === mainWindow?.webContents && permission === 'media' && allowedPage(details.requestingUrl || contents?.getURL() || '') && details.mediaType === 'audio');
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ label: 'Transcribe', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }, { role: 'editMenu' }]) : null);
  installHandlers();
  shortcutRegistered = registerShortcut(store.settings().shortcut);
  if (!shortcutRegistered) store.warning = 'O atalho está em uso por outro aplicativo. Escolha outro nas configurações.';
  await createWindows();
}).catch(error => { dialog.showErrorBox('Não foi possível iniciar o Transcribe', error.message); app.quit(); });
app.on('second-instance', showEntry);
app.on('activate', showEntry);
app.on('before-quit', () => { quitting = true; controller?.abort(); dictation?.cancel(); void keyboardGuard?.stop(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
