import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { recover, recoveredRecord } from '../lib/recovery.mjs';
import { snapshot, assertSame } from '../lib/core.mjs';
const account = '11111111-1111-4111-8111-111111111111', org = '22222222-2222-4222-8222-222222222222', cli = '33333333-3333-4333-8333-333333333333';
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'recovery-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const target = path.join(home, 'Library/Application Support/Claude');
  const dest = path.join(target, 'claude-code-sessions', account, org);
  const old = path.join(target, 'claude-code-sessions', '44444444-4444-4444-8444-444444444444', org);
  const project = path.join(home, '.claude/projects/fixture');
  await fs.mkdir(dest, { recursive: true }); await fs.mkdir(old, { recursive: true }); await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(target, 'config.json'), JSON.stringify({ lastKnownAccountUuid: account }));
  const record = { sessionId: `local_${cli}`, cliSessionId: cli, cwd: home, title: 'Synthetic conversation', isArchived: true, createdAt: 1, lastActivityAt: 2, permissionMode: 'bypassPermissions', remoteMcpServersConfig: { secret: 'fixture' }, bridgeSessionIds: ['old-bridge'], remoteControlUserEnabled: true, pendingAction: 'do-not-replay' };
  await fs.writeFile(path.join(old, `${record.sessionId}.json`), JSON.stringify(record));
  await fs.writeFile(path.join(project, `${cli}.jsonl`), '{"type":"user","message":"synthetic"}\n');
  return { home, target, dest, old, project, record, opts: { home, target, guard() {}, backupParent: path.join(home, 'backups') } };
}
test('recovery preserves only local fields and resets execution permissions', () => {
  const r = recoveredRecord({ sessionId: `local_${cli}`, cwd: '/fixture', title: 'keep', remoteMcpServersConfig: { token: 'secret' }, bridgeSessionIds: ['old'], permissionMode: 'bypassPermissions' });
  assert.equal(r.permissionMode, 'default'); assert.equal(r.remoteControlUserEnabled, false); assert.equal(r.title, 'keep'); assert.ok(!('remoteMcpServersConfig' in r)); assert.ok(!('bridgeSessionIds' in r));
  assert.throws(() => recoveredRecord({ sessionId: '../../escape', cwd: '/fixture' }));
});
test('preview makes no changes; apply backs up, preserves originals and reruns idempotently', async t => {
  const f = await fixture(t), before = await snapshot([f.home]);
  const audit = await recover(f.opts); assert.equal(audit.planned, 1); assert.equal(audit.created, 0); assert.equal(audit.backupDirectory, null); assertSame(before, await snapshot([f.home]));
  const result = await recover({ ...f.opts, apply: true }); assert.equal(result.created, 1); assert.equal(result.archived, 1); assert.equal(result.originalsUnchanged, true);
  const dest = path.join(f.dest, `${f.record.sessionId}.json`); assert.equal((await fs.stat(dest)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(result.backupDirectory)).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(await fs.readFile(dest)), recoveredRecord(f.record));
  const again = await recover({ ...f.opts, apply: true }); assert.equal(again.created, 0); assert.equal(again.backupDirectory, null); assert.equal(again.skipped[0].reason, 'already-present');
});
test('missing and differing duplicate transcripts are skipped without manufacturing history', async t => {
  const f = await fixture(t); const file = path.join(f.project, `${cli}.jsonl`); await fs.unlink(file);
  assert.equal((await recover(f.opts)).skipped[0].reason, 'missing-transcript');
  await fs.writeFile(file, 'original'); const another = path.join(f.home, '.claude/projects/another'); await fs.mkdir(another); await fs.writeFile(path.join(another, `${cli}.jsonl`), 'different');
  assert.equal((await recover(f.opts)).skipped[0].reason, 'ambiguous-transcript');
});
test('missing working directory is reported; archived state survives', async t => {
  const f = await fixture(t); f.record.cwd = path.join(f.home, 'missing'); await fs.writeFile(path.join(f.old, `${f.record.sessionId}.json`), JSON.stringify(f.record));
  const r = await recover(f.opts); assert.equal(r.planned, 1); assert.equal(r.missingWorkingDirectories.length, 1); assert.equal(r.archived, 1);
});
test('ambiguous target organization, invalid index and symlinks fail before mutation', async t => {
  const f = await fixture(t); await fs.mkdir(path.join(path.dirname(f.dest), '55555555-5555-4555-8555-555555555555'));
  await assert.rejects(recover(f.opts), /ambiguous/);
  assert.equal((await recover({ ...f.opts, org })).planned, 1);
  await fs.symlink(f.target, path.join(f.home, 'link')); await assert.rejects(recover({ ...f.opts, target: path.join(f.home, 'link') }), /Symlink/);
  await fs.writeFile(path.join(f.old, `${f.record.sessionId}.json`), '{broken'); await assert.rejects(recover({ ...f.opts, org }), /Unreadable JSON/);
});
test('collision during write never overwrites a competing file', async t => {
  const f = await fixture(t); const dest = path.join(f.dest, `${f.record.sessionId}.json`);
  await assert.rejects(recover({ ...f.opts, apply: true, beforeWrite: () => fs.writeFile(dest, 'concurrent content') }), /rolled-back/);
  assert.equal(await fs.readFile(dest, 'utf8'), 'concurrent content');
});
test('account change and backups inside source fail safely', async t => {
  const f = await fixture(t);
  await assert.rejects(recover({ ...f.opts, apply: true, backupParent: path.join(f.target, 'backups') }), /outside Claude/);
  await assert.rejects(recover({ ...f.opts, apply: true, beforeWrite: () => fs.writeFile(path.join(f.target, 'config.json'), JSON.stringify({ lastKnownAccountUuid: org })) }), /rolled-back/);
  assert.equal((await fs.readdir(f.dest)).length, 0);
});
test('thinking inspection reports counts without exposing content or modifying history', async t => {
  const { inspectThinking } = await import('../lib/recovery.mjs');
  const f = await fixture(t), p = path.join(f.project, `${cli}.jsonl`);
  const body = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'PRIVATE_REASONING', signature: 'PRIVATE_SIGNATURE' }, { type: 'redacted_thinking', data: 'PRIVATE_DATA' }, { type: 'text', text: 'visible answer' }] } }) + '\n';
  await fs.writeFile(p, body);
  assert.deepEqual(await inspectThinking(p), { thinkingBlocks: 1, redactedThinkingBlocks: 1, signedBlocks: 1 });
  const result = await recover({ ...f.opts, apply: true });
  assert.equal(result.thinking.policy, 'preserve'); assert.equal(result.thinking.sessionsWithThinking.length, 1);
  assert.equal(result.thinking.organizationCompatibility, 'not-verified');
  assert.ok(!JSON.stringify(result).includes('PRIVATE_')); assert.equal(await fs.readFile(p, 'utf8'), body);
  const again = await recover(f.opts); assert.equal(again.planned, 0); assert.equal(again.thinking.sessionsWithThinking.length, 1);
});
test('unreadable transcript is reported and never imported', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.project, `${cli}.jsonl`), '{private malformed');
  const r = await recover({ ...f.opts, apply: true }); assert.equal(r.created, 0); assert.equal(r.skipped[0].reason, 'unreadable-transcript');
});
test('partial failure rolls back only newly created records and preserves competing data', async t => {
  const f = await fixture(t); const second = '66666666-6666-4666-8666-666666666666';
  const record = { ...f.record, sessionId: `local_${second}`, cliSessionId: second };
  await fs.writeFile(path.join(f.old, `${record.sessionId}.json`), JSON.stringify(record));
  await fs.writeFile(path.join(f.project, `${second}.jsonl`), '{"type":"user","message":"second fixture"}\n');
  const collision = path.join(f.dest, `${record.sessionId}.json`);
  await assert.rejects(recover({ ...f.opts, apply: true, beforeWrite: () => fs.writeFile(collision, 'competing') }), /rolled-back/);
  assert.deepEqual(await fs.readdir(f.dest), [`${record.sessionId}.json`]);
  assert.equal(await fs.readFile(collision, 'utf8'), 'competing');
  assert.equal((await fs.readdir(f.old)).length, 2);
});
