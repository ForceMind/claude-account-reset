import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DesktopService } from '../desktop/service.mjs';
import { createDemo } from '../desktop/demo.mjs';
import { fingerprint, contentTree } from '../lib/safety.mjs';

async function setup(t, emit = () => {}) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'desktop-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = await createDemo(root);
  const service = new DesktopService({ ...config, demo: true, emit });
  const found = await service.discover();
  const request = { directoryIds: found.directories.map(d => d.id), traces: false, identityRecords: false, includeKeychain: false };
  const profile = found.directories.find(d => d.kind === 'desktop').path;
  const sourceRoots = [profile, path.join(config.home, '.claude'), path.join(config.home, '.claude.json')];
  return { ...config, service, found, request, profile, sourceRoots };
}

test('desktop preview uses explicit source grants, preserves data, hides credentials and keeps backup deletion off', async t => {
  const f = await setup(t); const before = await fingerprint(f.sourceRoots);
  await assert.rejects(f.service.preview({ ...f.request, directoryIds: [] }), /至少选择/);
  await assert.rejects(f.service.preview({ ...f.request, directoryIds: ['ungranted'] }), /失效/);
  await assert.rejects(f.service.preview({ ...f.request, discardBackup: true }), /选项/);
  await assert.rejects(f.service.preview({ ...f.request, includeKeychain: true }), /钥匙串/);
  const p = await f.service.preview(f.request);
  assert.equal(p.desktopSessions, 1); assert.equal(p.codeSessions, 1);
  assert.equal(JSON.stringify(p).includes('SYNTHETIC-NOT-A-CREDENTIAL'), false);
  assert.equal(JSON.stringify(p).includes('SYNTHETIC THINKING'), false);
  const saved = JSON.parse(await fs.readFile(path.join(f.storage, 'plans', p.id + '.plan.json')));
  assert.equal(saved.options.discardBackup, false);
  assert.equal(saved.options.identityRecords, false); assert.equal(saved.options.includeKeychain, false);
  assert.deepEqual(await fingerprint(f.sourceRoots), before);
});

test('desktop synthetic end-to-end cleans, keeps transcript/thinking, validates backups and restores original files', async t => {
  const f = await setup(t); const before = await fingerprint(f.sourceRoots);
  const p = await f.service.preview(f.request), result = await f.service.execute(p.id);
  assert.equal(result.status, 'complete'); assert.equal(result.protectedDataVerified, true); assert.equal(result.backupDiscarded, false);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.profile, 'config.json'))).lastKnownAccountUuid, undefined);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.profile, 'config.json'))).userID, 'synthetic-user');
  const after = await fingerprint(f.sourceRoots);
  for (const root of [f.profile, path.join(f.home, '.claude')]) for (const [name, meta] of Object.entries(before[root])) if (/jsonl$|local_.*json$/.test(name)) assert.deepEqual(after[root][name], meta);
  await assert.rejects(f.service.execute(p.id), /失效/);
  const backups = await f.service.listBackups(); assert.equal(backups.length, 1); assert.equal(backups[0].valid, true);
  const restore = await f.service.previewRestore(backups[0].id); const restored = await f.service.restore(restore.id);
  assert.equal(restored.status, 'complete'); assert(restored.restored > 0);
  const original = await fingerprint(f.sourceRoots);
  for (const root of f.sourceRoots) assert.deepEqual(contentTree(original[root]), contentTree(before[root]));
});

test('changed selection or source invalidates desktop authorization before writes', async t => {
  const f = await setup(t);
  const old = await f.service.preview(f.request), current = await f.service.preview(f.request);
  await assert.rejects(f.service.execute(old.id), /失效/);
  // A consumed/invalid execution request also discards any other pending plan.
  await assert.rejects(f.service.execute(current.id), /失效/);
  const p = await f.service.preview(f.request);
  const file = path.join(f.profile, 'config.json'); const original = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, original + ' ');
  await assert.rejects(f.service.execute(p.id), /expired|changed/);
  assert.equal(await fs.readFile(file, 'utf8'), original + ' ');
  assert.equal((await f.service.listBackups()).length, 0);
});

test('desktop cancellation retains verified backup without changing source data', async t => {
  let service;
  const f = await setup(t, e => { if (e.phase === 'staging') service.cancelled = true; }); service = f.service;
  const before = await fingerprint(f.sourceRoots), p = await service.preview(f.request);
  await assert.rejects(service.execute(p.id), /stopped/);
  assert.deepEqual(await fingerprint(f.sourceRoots), before);
  service.cancelled = false;
  const backups = await service.listBackups(); assert.equal(backups.length, 1); assert.equal(backups[0].valid, true); assert.equal(backups[0].status, 'partial-or-stopped');
});

test('new user content and corrupt backup are never overwritten during desktop restore', async t => {
  const f = await setup(t); const p = await f.service.preview(f.request); const result = await f.service.execute(p.id);
  let backups = await f.service.listBackups();
  const file = path.join(f.profile, 'config.json'); await fs.writeFile(file, '{"new":"user content"}');
  await assert.rejects(f.service.previewRestore(backups[0].id), /conflict/);
  assert.equal(await fs.readFile(file, 'utf8'), '{"new":"user content"}');
  const journal = JSON.parse(await fs.readFile(path.join(result.backupDirectory, 'journal.json')));
  const entry = journal.entries.find(e => e.backup !== null);
  const payload = path.join(result.backupDirectory, 'payload', entry.backup);
  if ((await fs.stat(payload)).isFile()) await fs.writeFile(payload, 'corrupt');
  else await fs.writeFile(path.join(payload, 'corrupt'), 'corrupt');
  backups = await f.service.listBackups(); assert.equal(backups[0].valid, false);
  await assert.rejects(f.service.previewRestore(backups[0].id), /verification/);
});

test('desktop refuses unsupported platform and demo directory escapes', async t => {
  const f = await setup(t);
  const win = new DesktopService({ home: f.home, storage: f.storage, demo: true, platform: 'win32' });
  await assert.rejects(win.discover(), /只支持 macOS/);
  await assert.rejects(f.service.addDirectory(path.dirname(f.home), 'desktop'), /演示目录/);
  const link = path.join(f.home, 'Claude-link'); await fs.symlink(f.profile, link);
  await assert.rejects(f.service.addDirectory(link, 'desktop'), /Symlink/);
});

test('desktop review discloses retained credential sources without leaking values', async t => {
  const f = await setup(t);
  await fs.writeFile(path.join(f.home, '.claude/settings.json'), JSON.stringify({ apiKeyHelper: 'SYNTHETIC-PRIVATE-HELPER', env: { ANTHROPIC_API_KEY: 'SYNTHETIC-PRIVATE-KEY' } }));
  const original = f.service.context.bind(f.service);
  f.service.context = () => ({ ...original(), keychainState: service => service === 'Claude Code-credentials' ? 'present' : 'absent' });
  const p = await f.service.preview(f.request), text = JSON.stringify(p);
  assert(p.limitations.some(s => s.includes('外部凭据提供器')));
  assert(p.limitations.some(s => s.includes('ANTHROPIC_API_KEY')));
  assert(p.limitations.some(s => s.includes('Claude Code-credentials')));
  assert.equal(text.includes('SYNTHETIC-PRIVATE-HELPER'), false);
  assert.equal(text.includes('SYNTHETIC-PRIVATE-KEY'), false);
});
