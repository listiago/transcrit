import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const archives = process.platform === 'win32'
  ? ['release/win-unpacked/resources/app.asar']
  : ['release/mac-arm64/Transcribe.app/Contents/Resources/app.asar', 'release/mac/Transcribe.app/Contents/Resources/app.asar'];

for (const archive of archives) {
  const files = asar.listPackage(archive).map(file => file.replaceAll('\\', '/').replace(/^\//, ''));
  for (const expected of ['electron/main.cjs', 'electron/preload.cjs', 'dist/index.html', 'resources/icon.png', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    assert.ok(files.includes(expected), `${archive}: missing ${expected}`);
  }
  assert.ok(!files.some(file => /(^|\/)(preferences\.json|history\.enc|diagnostics\.jsonl|\.env)(\/|$)/.test(file)), 'Personal data must not be packaged');
  assert.ok(!files.some(file => /^(tests|test-results|scripts|\.git)\//.test(file)), 'Development files must not be packaged');
  const bundled = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  assert.equal(bundled.version, pkg.version);
  assert.equal(bundled.license, 'MIT');
  assert.equal(bundled.main, 'electron/main.cjs');
  assert.ok(asar.extractFile(archive, 'electron/core.cjs').toString().includes("const MODEL = 'gpt-transcribe'"));
  if (process.platform === 'win32') {
    assert.ok(fs.existsSync(path.join(`${archive}.unpacked`, 'electron/native/windows.ps1')));
    assert.ok(fs.existsSync(path.join(`${archive}.unpacked`, 'electron/native/keyboard-guard.ps1')));
  }
  console.log(`Verified package: ${archive}`);
}
