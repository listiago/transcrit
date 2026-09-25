const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Diagnostics } = require('../electron/diagnostics.cjs');
test('diagnóstico local guarda apenas metadados permitidos e tem tamanho limitado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-diagnostics-'));
  try {
    const log = new Diagnostics(dir);
    log.write('failure', { operation: 'finish-dictation', code: 'api_error', httpStatus: 429, message: 'private transcript', audio: 'private audio', key: 'sk-private' });
    let data = fs.readFileSync(log.file, 'utf8');
    assert.ok(!data.includes('private')); assert.equal(JSON.parse(data).httpStatus, 429);
    fs.writeFileSync(log.file, 'x'.repeat(65536)); log.write('state', { phase: 'idle' });
    data = fs.readFileSync(log.file, 'utf8'); assert.equal(JSON.parse(data).phase, 'idle'); assert.ok(data.length < 300);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
