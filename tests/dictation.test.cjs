const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DictationSession } = require('../electron/dictation-session.cjs');
const { transcribeAudio, DEFAULT_SETTINGS } = require('../electron/core.cjs');
const { overlayBounds } = require('../electron/overlay-window.cjs');
const turn = () => new Promise(resolve => setImmediate(resolve));
async function audio(sequence) {
  const { wav } = await import('../src/audio-segments.mjs');
  return { sequence, bytes: wav([new Int16Array(2400).fill(1000)], 24000), duration: .1 };
}
test('captura contínua conserva cada amostra, inclusive a cauda, entre trechos WAV', async () => {
  const { AudioSegments } = await import('../src/audio-segments.mjs');
  const chunks = [], original = [];
  const segmenter = new AudioSegments(1000, (bytes, duration) => chunks.push({ bytes, duration }));
  for (let n = 0; n < 217; n++) {
    const frame = new Int16Array(n === 216 ? 37 : 100).fill(1000 + n);
    original.push(...frame); segmenter.push(frame);
  }
  segmenter.flush();
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.flatMap(({ bytes }) => [...new Int16Array(bytes.slice(44))]), original);
  const header = new DataView(chunks[0].bytes);
  assert.equal(header.getUint32(24, true), 1000);
  assert.equal(header.getUint32(40, true), chunks[0].bytes.byteLength - 44);
});
test('silêncio sozinho não é enviado; pausa natural disponibiliza prévia antes do fim', async () => {
  const { AudioSegments } = await import('../src/audio-segments.mjs');
  const chunks = [], segmenter = new AudioSegments(1000, bytes => chunks.push(bytes));
  for (let n = 0; n < 300; n++) segmenter.push(new Int16Array(100));
  assert.equal(chunks.length, 0);
  for (let n = 0; n < 15; n++) segmenter.push(new Int16Array(100).fill(2000));
  for (let n = 0; n < 7; n++) segmenter.push(new Int16Array(100));
  assert.equal(chunks.length, 1);
  segmenter.flush(); assert.equal(chunks.length, 1);
});
test('fila ordena prévia e texto final, com contexto e apenas uma requisição por trecho', async () => {
  const calls = [], updates = []; let resolve;
  const session = new DictationSession(async (_audio, _signal, context) => {
    calls.push(context); if (calls.length === 1) await new Promise(r => { resolve = r; });
    return calls.length === 1 ? 'Primeiro.' : 'Segundo.';
  }, value => updates.push(value));
  session.append(await audio(0)); session.append(await audio(1));
  assert.equal(calls.length, 1); resolve();
  assert.equal(await session.finish(), 'Primeiro. Segundo.');
  assert.deepEqual(calls, ['', 'Primeiro.']);
  assert.ok(updates.some(value => value.text === 'Primeiro.' && value.pending === 1));
  assert.equal(session.chunks.length, 0);
});
test('nova tentativa mantém trechos prontos, reenvia só a pendência e não perde ordem', async () => {
  let count = 0, fail = true;
  const session = new DictationSession(async () => { count++; if (count > 1 && fail) throw new Error('offline'); return count === 1 ? 'Um.' : 'Dois.'; }, () => {});
  session.append(await audio(0)); await turn();
  session.append(await audio(1));
  await assert.rejects(session.finish(), /offline/); assert.equal(session.text, 'Um.');
  fail = false;
  assert.equal(await session.finish(true), 'Um. Dois.'); assert.equal(count, 3);
});
test('trecho vazio não bloqueia fala anterior nem posterior e não é reenviado', async () => {
  const replies = ['Primeiro.', '', 'Último.', '']; let calls = 0;
  const session = new DictationSession((input, signal, context) => transcribeAudio(input, 'fixture', DEFAULT_SETTINGS, signal, async () => new Response(JSON.stringify({ text: replies[calls++] })), context, { allowEmpty: true }), () => {});
  for (let sequence = 0; sequence < replies.length; sequence++) session.append(await audio(sequence));
  assert.equal(await session.finish(), 'Primeiro. Último.');
  assert.equal(calls, 4); assert.equal(session.error, ''); assert.equal(session.chunks.length, 0);
});
test('ditado inteiramente sem fala permite uma nova gravação, sem loop de retry', async () => {
  const session = new DictationSession(async () => '', () => {});
  session.append(await audio(0)); session.append(await audio(1));
  await assert.rejects(session.finish(), error => error.code === 'no_speech' && error.retryable === false);
  assert.equal(session.error, ''); assert.equal(session.chunks.length, 0);
});
test('cauda muito curta preserva amostras e recebe silêncio suficiente para um WAV válido', async () => {
  const { AudioSegments } = await import('../src/audio-segments.mjs');
  const chunks = [], input = new Int16Array(128).fill(1800);
  const segmenter = new AudioSegments(24000, bytes => chunks.push(bytes));
  segmenter.push(input); segmenter.flush();
  const samples = new Int16Array(chunks[0].slice(44));
  assert.equal(samples.length, 7200); assert.deepEqual(samples.slice(0, 128), input);
  assert.ok(samples.slice(128).every(sample => sample === 0));
});
test('cancelar aborta rede e impede prévia atrasada; sessão não aceita áudio novo', async () => {
  let resolve, signal, updates = 0;
  const session = new DictationSession(async (_audio, current) => { signal = current; return new Promise(r => { resolve = r; }); }, () => updates++);
  session.append(await audio(0)); const before = updates;
  session.cancel(); assert.equal(signal.aborted, true); resolve('Não inserir.');
  await assert.rejects(session.finish(), /cancelada/);
  assert.equal(updates, before); assert.equal(session.text, '');
  assert.throws(() => session.append({}), /terminou/);
});
test('rejeita sequência incorreta e áudio inválido antes de chamar a API', async () => {
  const session = new DictationSession(() => { throw new Error('Não deveria chamar'); }, () => {});
  assert.throws(() => session.append({ sequence: 2 }), /sequência/);
  assert.throws(() => session.append({ sequence: 0, bytes: new Uint8Array(200) }), /inválido/);
  session.cancel();
});
test('minicard tem tamanho fixo, nasce à direita e preserva posição em monitores deslocados', () => {
  const area = { x: -1920, y: 100, width: 1920, height: 1080 };
  const anchor = { right: -20, top: 400 };
  const dock = overlayBounds(area, true, anchor), expanded = overlayBounds(area, false, anchor);
  assert.deepEqual(dock, expanded);
  const initial = overlayBounds(area, false);
  assert.equal(initial.x + initial.width, area.x + area.width - 20);
  assert.equal(initial.width, 136); assert.equal(initial.height, 72);
  assert.equal(dock.x + dock.width, expanded.x + expanded.width); assert.equal(dock.y, expanded.y);
  const clamped = overlayBounds(area, false, { right: 1000, top: 2000 });
  assert.ok(clamped.x + clamped.width <= 0); assert.ok(clamped.y + clamped.height <= 1180);
});
