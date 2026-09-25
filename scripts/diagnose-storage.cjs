// Read-only diagnostic: copy this app's encrypted files into an isolated profile.
// Never print a key, transcript, or encrypted payload.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const source = path.join(process.env.APPDATA, 'transcribe');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-storage-probe-'));
for (const name of ['Local State', 'preferences.json', 'history.enc']) {
  const file = path.join(source, name);
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(directory, name));
}
app.setPath('userData', directory);
app.setPath('sessionData', directory);
app.setName('Transcribe');
app.whenReady().then(async () => {
  const result = { userData: app.getPath('userData'), sessionData: app.getPath('sessionData') };
  const preferences = JSON.parse(fs.readFileSync(path.join(directory, 'preferences.json'), 'utf8'));
  const encrypted = Buffer.from(preferences.encryptedKey, 'base64');
  for (const mode of ['sync', 'async']) {
    try {
      const key = mode === 'sync' ? safeStorage.decryptString(encrypted) : (await safeStorage.decryptStringAsync(encrypted)).result;
      result[mode] = { readable: typeof key === 'string' && key.startsWith('sk-') };
    } catch (error) { result[mode] = { readable: false, error: error.message }; }
  }
  try { result.roundTrip = safeStorage.decryptString(safeStorage.encryptString('local-storage-test')) === 'local-storage-test'; }
  catch (error) { result.roundTrip = error.message; }
  try { result.historyReadable = Array.isArray(JSON.parse(safeStorage.decryptString(Buffer.from(fs.readFileSync(path.join(directory, 'history.enc'), 'utf8'), 'base64')))); }
  catch { result.historyReadable = false; }
  fs.writeFileSync(path.join(__dirname, '../test-results/storage-diagnostic.json'), JSON.stringify(result, null, 2));
  app.quit();
}).catch(error => { console.error(error.message); app.exit(1); });
