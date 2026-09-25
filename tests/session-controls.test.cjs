const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SessionControls } = require('../electron/session-controls.cjs');
function setup(wait = async () => true, failKey) {
  const registered = new Map(); let finishes = 0, cancels = 0;
  const shortcuts = { register(key, action) { if (key === failKey) return false; registered.set(key, action); return true; }, unregister(key) { registered.delete(key); } };
  const controls = new SessionControls(shortcuts, wait, () => finishes++, () => cancels++);
  return { controls, registered, counts: () => ({ finishes, cancels }) };
}
test('Enter conclui uma vez e é consumido durante processamento; Esc cancela uma vez', async () => {
  const { controls, registered, counts } = setup();
  assert.equal(registered.size, 0);
  controls.arm(); controls.setPhase('recording');
  registered.get('Enter')(); registered.get('Enter')();
  assert.deepEqual(counts(), { finishes: 1, cancels: 0 });
  assert.equal(registered.size, 2);
  registered.get('Escape')(); registered.get('Escape')();
  assert.deepEqual(counts(), { finishes: 1, cancels: 1 });
  await controls.release(); assert.equal(registered.size, 0);
});
test('conclusão espera soltura física; nova gravação não reutiliza captura pendente', async () => {
  let resolve;
  const { controls, registered } = setup(() => new Promise(done => { resolve = done; }));
  controls.arm(); controls.setPhase('delivering');
  const release = controls.release();
  assert.equal(registered.size, 2);
  assert.throws(() => controls.arm(), /solte/);
  assert.equal(controls.release(), release);
  resolve(true); await release;
  assert.equal(registered.size, 0);
  controls.arm(); await Promise.resolve();
  assert.equal(controls.phase, 'starting');
});
test('falha ao capturar uma tecla desfaz apenas as capturas desta sessão', () => {
  const { controls, registered } = setup(undefined, 'Escape');
  registered.set('CommandOrControl+Shift+Space', () => {});
  assert.throws(() => controls.arm(), /Esc/);
  assert.equal(registered.size, 1);
  assert.ok(registered.has('CommandOrControl+Shift+Space'));
  assert.equal(controls.phase, 'idle');
});
test('entrega não pode ser cancelada depois que a inserção começa', async () => {
  const { controls, counts } = setup();
  controls.arm(); controls.setPhase('delivering');
  controls.cancel(); controls.finish();
  assert.deepEqual(counts(), { finishes: 0, cancels: 0 });
  await controls.release();
});
test('falha do helper libera o teclado em vez de bloquear o sistema', async () => {
  const { controls, registered } = setup(async () => { throw new Error('helper indisponível'); });
  controls.arm();
  await assert.rejects(controls.release(), /helper/);
  assert.equal(registered.size, 0);
  assert.equal(controls.phase, 'idle');
});

test('Enter durante a preparação é atendido assim que o microfone fica pronto', async () => {
  const { controls, registered, counts } = setup();
  controls.arm(); registered.get('Enter')(); registered.get('Enter')();
  assert.equal(counts().finishes, 0);
  controls.setPhase('recording');
  assert.equal(counts().finishes, 1);
  assert.equal(controls.phase, 'processing');
  await controls.release(); controls.arm(); controls.setPhase('recording');
  assert.equal(counts().finishes, 1);
  await controls.release();
});
