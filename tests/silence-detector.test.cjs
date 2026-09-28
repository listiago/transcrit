const { test } = require('node:test');
const assert = require('node:assert/strict');

test('silêncio inicial e ruídos breves não iniciam a finalização automática', async () => {
  const { SilenceDetector } = await import('../src/silence-detector.mjs');
  const detector = new SilenceDetector(24000, 4);
  for (let i = 0; i < 100; i++) assert.equal(detector.push(0, 2400), false);
  assert.equal(detector.push(0.2, 2400), false);
  for (let i = 0; i < 100; i++) assert.equal(detector.push(0.002, 2400), false);
});
test('conclui uma vez após o tempo escolhido; falar novamente reinicia a pausa', async () => {
  const { SilenceDetector } = await import('../src/silence-detector.mjs');
  for (const rate of [24000, 48000]) for (const seconds of [2, 4, 30]) {
    const detector = new SilenceDetector(rate, seconds);
    detector.push(0.03, rate / 2);
    assert.equal(detector.push(0.001, rate * (seconds - 1)), false);
    assert.equal(detector.push(0.015, rate / 2), false);
    assert.equal(detector.push(0.001, rate * seconds - 1), false);
    assert.equal(detector.push(0, 1), true);
    assert.equal(detector.push(0, rate * seconds), false);
  }
});
test('frames inválidos não avançam o relógio de áudio nem armam o detector', async () => {
  const { SilenceDetector } = await import('../src/silence-detector.mjs');
  const detector = new SilenceDetector(24000, 2);
  assert.equal(detector.push(NaN, 48000), false);
  assert.equal(detector.push(0.1, -48000), false);
  assert.equal(detector.push(0, 48000), false);
  detector.push(0.02, 4800);
  assert.equal(detector.push(0, 1.5), false);
  assert.equal(detector.push(0, 47999), false);
  assert.equal(detector.push(0, 1), true);
});
test('barras representam bandas de frequência e voltam ao repouso sem sinal', async () => {
  const { meterBands } = await import('../src/audio-meter.mjs');
  const spectrum = new Uint8Array(256);
  spectrum[Math.round(1000 * 512 / 24000)] = 255;
  const bands = meterBands(spectrum, 24000, 512, 0.05);
  assert.equal(bands.length, 8);
  assert.equal(bands[4], 1);
  assert.equal(bands[0], 0);
  assert.ok(bands.every(n => Number.isFinite(n) && n >= 0 && n <= 1));
  assert.deepEqual(meterBands(spectrum, 24000, 512, 0.001), Array(8).fill(0));
});
