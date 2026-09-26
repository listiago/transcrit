const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_SETTINGS, validateSettings } = require('./core.cjs');

class Store {
  constructor(directory, crypto) {
    this.directory = directory;
    this.crypto = crypto;
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, 'preferences.json');
    this.historyFile = path.join(directory, 'history.enc');
    this.data = { settings: { ...DEFAULT_SETTINGS }, encryptedKey: '' };
    this.warning = '';
    try {
      if (fs.existsSync(this.file)) {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = { settings: { ...DEFAULT_SETTINGS, ...validateSettings(saved.settings) }, encryptedKey: typeof saved.encryptedKey === 'string' ? saved.encryptedKey : '' };
      }
    } catch { this.warning = 'Não foi possível ler as preferências salvas. Configure o aplicativo novamente.'; }
  }
  encrypt(text) {
    if (!this.crypto.isEncryptionAvailable()) throw new Error('O cofre do sistema não está disponível. Não foi possível salvar os dados com segurança.');
    return this.crypto.encryptString(text).toString('base64');
  }
  decrypt(text) { return this.crypto.decryptString(Buffer.from(text, 'base64')); }
  write(file, text) {
    fs.writeFileSync(`${file}.tmp`, text, { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  }
  persist() { this.write(this.file, JSON.stringify(this.data, null, 2)); }
  key() {
    if (!this.data.encryptedKey) return '';
    try { return this.decrypt(this.data.encryptedKey); } catch { throw Object.assign(new Error('Não foi possível abrir sua chave no cofre do sistema. Cadastre-a novamente.'), { code: 'key_unreadable', retryable: false, action: 'settings' }); }
  }
  keyStatus() {
    if (!this.data.encryptedKey) return 'missing';
    try { return this.key() ? 'ready' : 'unreadable'; }
    catch { return 'unreadable'; }
  }
  saveKey(value) {
    if (typeof value !== 'string' || value.trim().length < 20 || value.length > 512 || /\s/.test(value.trim()) || !value.trim().startsWith('sk-')) throw new Error('Cole uma chave de API OpenAI válida, começando com sk-.');
    const previous = this.data.encryptedKey;
    const encrypted = this.encrypt(value.trim());
    if (this.decrypt(encrypted) !== value.trim()) throw new Error('Não foi possível verificar a chave no cofre do sistema. Tente salvar novamente.');
    this.data.encryptedKey = encrypted;
    try { this.persist(); } catch (error) { this.data.encryptedKey = previous; throw error; }
  }
  removeKey() { this.data.encryptedKey = ''; this.persist(); }
  settings() { return { ...this.data.settings }; }
  saveSettings(input) {
    const previous = this.data.settings;
    this.data.settings = { ...previous, ...validateSettings(input) };
    try { this.persist(); } catch (error) { this.data.settings = previous; throw error; }
    return this.settings();
  }
  history() {
    if (!fs.existsSync(this.historyFile)) return [];
    try { const items = JSON.parse(this.decrypt(fs.readFileSync(this.historyFile, 'utf8'))); return Array.isArray(items) ? items : []; }
    catch { throw new Error('Não foi possível abrir o histórico protegido neste computador.'); }
  }
  saveHistory(items) { this.write(this.historyFile, this.encrypt(JSON.stringify(items.slice(0, 100)))); }
  addHistory(item) { if (this.data.settings.keepHistory) this.saveHistory([item, ...this.history()]); }
  deleteHistory(id) { this.saveHistory(this.history().filter(item => item.id !== id)); }
  clearHistory() { if (fs.existsSync(this.historyFile)) fs.unlinkSync(this.historyFile); }
}
module.exports = { Store };
