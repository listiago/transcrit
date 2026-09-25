const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateAudio, validateSettings, transcribeAudio, MAX_AUDIO_BYTES, DEFAULT_SETTINGS, MODEL } = require('../electron/core.cjs');
const { Store } = require('../electron/store.cjs');
const audio = () => validateAudio({ bytes: new Uint8Array(1024), name: 'voz.webm', duration: 8, source: 'mic' });

test('áudio rejeita entradas vazias, grandes e extensões incompatíveis antes do envio', () => {
  assert.throws(() => validateAudio({ bytes: 'not bytes' }), /inválido/);
  assert.throws(() => validateAudio({ bytes: new ArrayBuffer(10) }), /curta/);
  assert.throws(() => validateAudio({ bytes: new ArrayBuffer(MAX_AUDIO_BYTES + 1) }), /25 MB/);
  assert.throws(() => validateAudio({ bytes: new ArrayBuffer(100), name: 'script.exe' }), /formato/);
  const subarray = new Uint8Array([9, ...Array(100).fill(1), 9]).subarray(1, 101);
  assert.deepEqual(validateAudio({ bytes: subarray }).bytes, Buffer.alloc(100, 1));
});
test('configurações rejeitam atalhos arbitrários e ignoram chaves desconhecidas', () => {
  assert.throws(() => validateSettings({ shortcut: 'Alt+F4' }), /Atalho/);
  assert.throws(() => validateSettings({ autoPaste: 'true' }), /inválida/);
  assert.throws(() => validateSettings({ language: '../../secret' }), /Idioma/);
  assert.deepEqual(validateSettings({ language: 'pt', endpoint: 'https://evil.example' }), { language: 'pt' });
});
test('requisição usa endpoint fixo, multipart e modelo atual com idioma opcional', async () => {
  const text = await transcribeAudio(audio(), 'sk-test-fixture', { ...DEFAULT_SETTINGS, language: 'pt' }, new AbortController().signal, async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(init.headers.Authorization, 'Bearer sk-test-fixture');
    assert.equal(init.body.get('model'), MODEL);
    assert.equal(init.body.get('language'), 'pt');
    assert.equal(init.body.get('file').type, 'audio/webm');
    assert.equal(init.body.get('file').name, 'audio.webm');
    return new Response(JSON.stringify({ text: ' Olá, mundo. ' }), { status: 200 });
  });
  assert.equal(text, 'Olá, mundo.');
});
test('idioma automático não envia valor inválido à API', async () => {
  await transcribeAudio(audio(), 'sk-test', DEFAULT_SETTINGS, null, async (_, init) => {
    assert.equal(init.body.has('language'), false);
    return new Response(JSON.stringify({ text: 'Olá.' }));
  });
});
test('erros de autenticação, quota, rede e cancelamento têm mensagens úteis sem segredos', async () => {
  for (const [status, code, expected] of [[401, 'invalid_api_key', /não foi aceita/], [429, 'insufficient_quota', /sem créditos/], [500, '', /indisponível/]]) {
    await assert.rejects(() => transcribeAudio(audio(), 'sk-secret', DEFAULT_SETTINGS, null, async () => new Response(JSON.stringify({ error: { code, message: 'sk-secret' } }), { status })), expected);
  }
  await assert.rejects(() => transcribeAudio(audio(), 'key', DEFAULT_SETTINGS, null, async () => { throw new Error('network'); }), /internet/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => transcribeAudio(audio(), 'key', DEFAULT_SETTINGS, controller.signal, async () => { throw new Error('abort'); }), /cancelada/);
  await assert.rejects(() => transcribeAudio(audio(), 'key', DEFAULT_SETTINGS, null, async () => new Response('{"text":""}')), /Nenhuma fala/);
});

test('chave e histórico ficam criptografados e sobrevivem ao reinício', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-unit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const secret = crypto.randomBytes(32);
  const provider = {
    isEncryptionAvailable: () => true,
    encryptString: text => { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', secret, iv); const encrypted = Buffer.concat([cipher.update(text), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]); },
    decryptString: buffer => { const decipher = crypto.createDecipheriv('aes-256-gcm', secret, buffer.subarray(0, 12)); decipher.setAuthTag(buffer.subarray(12, 28)); return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString(); }
  };
  const store = new Store(directory, provider);
  store.saveKey('sk-test-only-never-a-real-key');
  assert.equal(store.keyStatus(), 'ready');
  store.addHistory({ id: '1', text: 'um texto particular' });
  assert.ok(!fs.readFileSync(store.file, 'utf8').includes('sk-test-only'));
  assert.ok(!fs.readFileSync(store.historyFile, 'utf8').includes('particular'));
  const restored = new Store(directory, provider);
  assert.equal(restored.key(), 'sk-test-only-never-a-real-key');
  assert.equal(restored.history()[0].text, 'um texto particular');
  restored.saveSettings({ keepHistory: false });
  restored.addHistory({ id: '2', text: 'não guardar' });
  assert.equal(restored.history().length, 1);
  restored.deleteHistory('1'); assert.equal(restored.history().length, 0);
  restored.removeKey(); assert.equal(restored.key(), ''); assert.equal(restored.keyStatus(), 'missing');
});
test('chave ilegível é detectada sem apagar as credenciais nem fingir que está pronta', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-unit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const saved = { settings: DEFAULT_SETTINGS, encryptedKey: 'b2xkLWVuY3J5cHRlZC1rZXk=' };
  fs.writeFileSync(path.join(directory, 'preferences.json'), JSON.stringify(saved));
  const store = new Store(directory, { decryptString() { throw new Error('ciphertext mismatch'); } });
  assert.equal(store.keyStatus(), 'unreadable');
  assert.throws(() => store.key(), /cofre/);
  assert.deepEqual(JSON.parse(fs.readFileSync(store.file)), saved);
});
test('sem cofre, o aplicativo recusa gravar chave em texto puro', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-unit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory, { isEncryptionAvailable: () => false });
  assert.throws(() => store.saveKey('sk-test-only-never-a-real-key'), /cofre/);
  assert.ok(!fs.existsSync(store.file));
});
