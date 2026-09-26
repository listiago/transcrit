import { _electron as electron, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
const expectedVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const executablePath = process.argv[2] || path.join(process.env.LOCALAPPDATA, 'Programs', 'transcribe', 'Transcribe.exe');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
// Validate a copy of the profile: automated launches must not modify real data.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-installed-check-'));
for (const file of ['Local State', 'preferences.json', 'history.enc']) {
  const source = path.join(process.env.APPDATA, 'transcribe', file);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dataDir, file));
}
const desktop = await electron.launch({ executablePath, args: [`--user-data-dir=${dataDir}`], env, timeout: 30000 });
try {
  const actualData = await desktop.evaluate(({ app }) => app.getPath('userData'));
  if (path.resolve(actualData).toLowerCase() !== path.resolve(dataDir).toLowerCase()) throw new Error('Teste precisa de perfil isolado.');
  await expect.poll(() => desktop.windows().some(window => window.url().includes('index.html') && !window.url().includes('#overlay')), { timeout: 15000 }).toBe(true);
  const page = desktop.windows().find(window => window.url().includes('index.html') && !window.url().includes('#overlay'));
  await expect(page.getByRole('heading', { name: 'Sua voz, em palavras.' })).toBeVisible();
  const status = await desktop.evaluate(async ({ app }) => {
    const { createRequire } = process.getBuiltinModule('node:module');
    const require = createRequire(app.getAppPath() + '/package.json');
    const native = require(app.getAppPath() + '/electron/native.cjs');
    const foreground = await native.captureTarget();
    const guard = await require(app.getAppPath() + '/electron/keyboard-guard.cjs').startKeyboardGuard(() => {}, () => {});
    const keyboardGuardWorking = await guard.waitForRelease();
    await guard.stop();
    return { packaged: app.isPackaged, version: app.getVersion(), helperWorking: /^\d+$/.test(foreground), keyboardGuardWorking, appPath: app.getAppPath() };
  });
  if (!status.packaged || !status.helperWorking || !status.keyboardGuardWorking || status.version !== expectedVersion) throw new Error(JSON.stringify(status));
  const state = await page.evaluate(() => window.transcribe.getState());
  if (!state.shortcutRegistered || !state.secureStorage) throw new Error('Atalho ou cofre indisponível no app instalado.');
  if (state.hasKey && state.keyStatus !== 'ready') throw new Error('A chave copiada não pôde ser aberta no app instalado.');
  const entry = await desktop.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('#overlay'));
    const card = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('#overlay'));
    return { mainVisible: main.isVisible(), cardVisible: card.isVisible(), bounds: card.getBounds() };
  });
  if (!entry.mainVisible || entry.cardVisible) throw new Error('Abrir o aplicativo deve mostrar a janela principal, sem iniciar o minicard.');
  console.log('PASS: app instalado abre em perfil isolado, ASAR carrega, helper funciona, atalho registrado e chave protegida legível.');
  console.log(JSON.stringify(status));
  console.log('PASS: com a chave configurada, a inicialização mantém a janela e as configurações acessíveis.');
} finally { await desktop.close(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
