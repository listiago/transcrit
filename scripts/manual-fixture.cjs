// Isolated native UI fixture for testing with Computer Use. Never contacts an API.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-ui-fixture-'));
process.env.TRANSCRIBE_TEST = '1';
process.env.TRANSCRIBE_TEST_DATA = directory;
fs.writeFileSync(path.join(directory, 'preferences.json'), JSON.stringify({ encryptedKey: Buffer.from('v10-invalid-ciphertext').toString('base64') }));
globalThis.fetch = async () => new Response(JSON.stringify({ text: 'Texto de teste inserido no campo correto.' }));
require('../electron/main.cjs');
app.whenReady().then(async () => {
  const target = new BrowserWindow({ width: 580, height: 290, title: 'Transcribe — destino de teste' });
  await target.loadURL('data:text/html,<title>Transcribe — destino de teste</title><h2>Destino isolado de teste</h2><textarea aria-label="Destino do ditado" style="width:95%;height:160px"></textarea>');
  fs.writeFileSync(path.join(__dirname, '../test-results/manual-fixture.json'), JSON.stringify({ directory, pid: process.pid }));
});
