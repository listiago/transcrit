// Opt-in integration check. Uses the saved key only inside Electron's main process.
// Sends two synthetic fixtures, never microphone input or history, to the real API.
import { _electron as electron, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
if (process.argv[2] !== '--synthetic-audio') throw new Error('Use --synthetic-audio to explicitly run the paid API check.');
if (process.platform !== 'win32') throw new Error('Este teste sintético usa o sintetizador de voz do Windows.');
await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/create-voice-fixtures.ps1')], { windowsHide: true, timeout: 15000 });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-live-check-'));
for (const file of ['Local State', 'preferences.json']) {
  const source = path.join(process.env.APPDATA, 'transcribe', file);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dataDir, file));
}
const env = { ...process.env, TRANSCRIBE_TEST: '1', TRANSCRIBE_TEST_DATA: dataDir }; delete env.ELECTRON_RUN_AS_NODE;
const desktop = await electron.launch({ args: ['.', '--hidden'], env, timeout: 30000 });
try {
  const actualData = await desktop.evaluate(({ app }) => app.getPath('userData'));
  if (path.resolve(actualData).toLowerCase() !== path.resolve(dataDir).toLowerCase()) throw new Error('Perfil de teste não está isolado.');
  await expect.poll(() => desktop.windows().some(page => page.url().includes('index.html')), { timeout: 15000 }).toBe(true);
  const result = await desktop.evaluate(async ({ app, safeStorage }, fixtureDir) => {
    const { createRequire } = process.getBuiltinModule('node:module');
    const require = createRequire(app.getAppPath() + '/package.json');
    const fs = require('node:fs'), path = require('node:path');
    const { Store } = require(app.getAppPath() + '/electron/store.cjs');
    const { transcribeAudio, MODEL } = require(app.getAppPath() + '/electron/core.cjs');
    const { DictationSession } = require(app.getAppPath() + '/electron/dictation-session.cjs');
    const store = new Store(app.getPath('userData'), safeStorage);
    const key = store.key(); if (!key) throw new Error('Chave salva indisponível para o teste.');
    const previews = [];
    const session = new DictationSession((audio, signal, context) => transcribeAudio(audio, key, { ...store.settings(), language: 'pt' }, signal, fetch, context, { allowEmpty: true }), value => { if (value.text) previews.push(value.text); });
    for (let sequence = 0; sequence < 2; sequence++) {
      const bytes = fs.readFileSync(path.join(fixtureDir, `live-phrase-${sequence + 1}.wav`));
      session.append({ sequence, bytes, duration: bytes.length / 48000 });
    }
    const text = await session.finish();
    return { model: MODEL, chunks: session.next, text, previewUpdatedBeforeFinal: previews.some(value => value !== text) };
  }, path.resolve('test-results'));
  const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  const expected = normalize(JSON.parse(fs.readFileSync(new URL('./voice-fixtures.json', import.meta.url), 'utf8')).join(' '));
  const actual = normalize(result.text);
  let distances = Array.from({ length: actual.length + 1 }, (_, i) => i);
  for (let i = 1; i <= expected.length; i++) {
    const next = [i];
    for (let j = 1; j <= actual.length; j++) next[j] = Math.min(next[j - 1] + 1, distances[j] + 1, distances[j - 1] + Number(expected[i - 1] !== actual[j - 1]));
    distances = next;
  }
  result.wordErrorRate = distances[actual.length] / expected.length;
  if (result.model !== 'gpt-transcribe' || !result.previewUpdatedBeforeFinal || result.wordErrorRate > .25) throw new Error(`Transcrição inesperada: ${JSON.stringify(result)}`);
  console.log('PASS: API real, GPT Transcribe, dois WAVs sintéticos, contexto e prévia incremental.');
  console.log(JSON.stringify(result));
  fs.writeFileSync('test-results/live-validation.json', JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2));
} finally { await desktop.close(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
