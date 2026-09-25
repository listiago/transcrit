import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { open, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const directory = process.argv[2] || 'artifacts';
const expected = [
  `Transcribe-Setup-${version}-x64.exe`,
  ...['arm64', 'x64'].flatMap(arch => ['dmg', 'zip'].map(ext => `Transcribe-${version}-macOS-${arch}.${ext}`)),
].sort();
const files = (await readdir(directory)).filter(name => name !== 'SHA256SUMS.txt').sort();
assert.deepEqual(files, expected, 'The release must contain exactly the five expected downloads');

const checksums = [];
for (const name of expected) {
  const filename = path.join(directory, name);
  const handle = await open(filename);
  try {
    const { size } = await handle.stat();
    assert.ok(size > 10_000_000, `Unexpectedly small package: ${name}`);
    const bytes = Buffer.alloc(4);
    await handle.read(bytes, 0, bytes.length, name.endsWith('.dmg') ? size - 512 : 0);
    assert.equal(bytes.toString('ascii', 0, name.endsWith('.dmg') ? 4 : 2), name.endsWith('.dmg') ? 'koly' : name.endsWith('.exe') ? 'MZ' : 'PK', `Invalid file format: ${name}`);
  } finally {
    await handle.close();
  }
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  checksums.push(`${hash.digest('hex')}  ${name}`);
  console.log(`Verified download: ${name}`);
}
await writeFile(path.join(directory, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`);
