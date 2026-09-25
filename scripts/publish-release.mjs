import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.match(version, /^\d+\.\d+\.\d+$/);
const tag = `v${version}`;
const sha = process.env.GITHUB_SHA;
assert.match(sha || '', /^[a-f0-9]{40}$/);
const ref = process.env.GITHUB_REF;
assert.ok(ref === 'refs/heads/main' || ref === `refs/tags/${tag}`, 'Publish only main or the matching version tag');
const notes = `docs/releases/${tag}.md`;
assert.ok(fs.existsSync(notes), 'Release notes are required');
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

// Refuse to move a tag or replace an already published release.
const existingTag = spawnSync('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], { encoding: 'utf8' });
if (existingTag.status === 0) assert.equal(existingTag.stdout.trim(), sha, 'The version tag already points to another commit');
const existingRelease = spawnSync('gh', ['release', 'view', tag, '--json', 'isDraft,targetCommitish'], { encoding: 'utf8' });
if (existingRelease.status === 0) {
  const release = JSON.parse(existingRelease.stdout);
  assert.ok(release.isDraft, 'This version is already public; publish a new version instead');
  assert.equal(release.targetCommitish, sha, 'The draft belongs to another commit');
} else {
  gh('release', 'create', tag, '--target', sha, '--title', `Transcribe ${version}`, '--notes-file', notes, '--draft');
}

const assets = fs.readdirSync('artifacts').sort().map(name => path.join('artifacts', name));
assert.equal(assets.length, 6, 'Five downloads and a checksum file are required');
assert.ok(assets.includes(path.join('artifacts', 'SHA256SUMS.txt')));
gh('release', 'upload', tag, ...assets, '--clobber');
const uploaded = JSON.parse(gh('release', 'view', tag, '--json', 'assets')).assets;
assert.deepEqual(uploaded.map(asset => asset.name).sort(), assets.map(asset => path.basename(asset)).sort());
for (const asset of uploaded) assert.equal(asset.size, fs.statSync(path.join('artifacts', asset.name)).size, `Upload size mismatch: ${asset.name}`);
gh('release', 'edit', tag, '--draft=false', '--latest');
console.log(gh('release', 'view', tag, '--json', 'url', '--jq', '.url'));
