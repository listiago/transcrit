import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'transcribe-storage-test-'));
const env = { ...process.env, TRANSCRIBE_STORAGE_TEST: directory };
delete env.ELECTRON_RUN_AS_NODE;
try {
  for (const mode of ['--write-fixture', '--read-fixture', '--read-fixture']) {
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [path.join(import.meta.dirname, 'storage-worker.cjs'), mode], { env, windowsHide: true, stdio: 'ignore' });
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Storage test timeout')); }, 20000);
      child.on('error', reject);
      child.on('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Storage process exited ${code}`)); });
    });
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'result.json'), 'utf8')), { keyReadable: true, keyStatus: 'ready', historyReadable: true });
  }
  assert.ok(!(await fs.readFile(path.join(directory, 'preferences.json'), 'utf8')).includes('sk-storage-test'));
  console.log('PASS: cofre nativo preserva chave e histórico em três processos independentes, sem Playwright ou API simulando a criptografia.');
} finally { await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
