const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('../electron/store.cjs');
const directory = process.env.TRANSCRIBE_STORAGE_TEST;
if (!directory || !path.basename(directory).startsWith('transcribe-storage-test-')) throw new Error('Isolated test profile required.');
app.setPath('userData', directory);
app.setPath('sessionData', directory);
app.whenReady().then(() => {
  const store = new Store(directory, safeStorage);
  const fixture = 'sk-storage-test-only-not-a-real-key';
  if (process.argv.includes('--write-fixture')) {
    store.saveKey(fixture);
    store.addHistory({ id: 'fixture', text: 'Teste de persistência criptografada.' });
  }
  const status = { keyReadable: store.key() === fixture, keyStatus: store.keyStatus(), historyReadable: store.history()[0]?.id === 'fixture' };
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(status));
  app.quit();
}).catch(() => app.exit(1));
