import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { auditWindows, demoWindowsState } from '../lib/windows-audit.mjs';
import { applyWindowsWorkflow, listWindowsHistory, previewWindowsWorkflow, rollbackWindowsWorkflow,
  verifyWindowsArchive } from '../lib/windows-workflow.mjs';
import { exists, inventory } from '../lib/safety.mjs';

const windows = process.platform === 'win32';
const old = '12345678-0000-4000-8000-123456789abc';

async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir());
  const home = await fs.mkdtemp(path.join(parent, 'car-workflow-test-'));
  t.after(async () => {
    const resolved = await fs.realpath(home);
    assert.equal(path.dirname(resolved), parent);
    assert.match(path.basename(resolved), /^car-workflow-test-/);
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const state = demoWindowsState(home);
  const context = { home, state, guard() {}, environment: {} };
  return { home, state, context };
}

async function put(file, contents) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
  return file;
}

test('Windows audit distinguishes registered and third-party layouts, and refuses redirected roots', { skip: !windows }, async t => {
  const f = await fixture(t);
  const family = 'Claude_pzs8sxrjxfjjc';
  await put(path.join(f.state.local, 'Claude-Data', family, 'ccd-session-presets.json'), '{}');
  await put(path.join(f.state.local, 'Packages', family, 'LocalState', 'Local Storage', 'data'), '');
  await put(path.join(f.state.roaming, 'Claude-3p', 'config.json'), '{}');
  await put(path.join(f.state.roaming, 'Claude', 'config.json'), '{}');
  const report = await auditWindows(f.home, f.context);
  assert.equal(report.rootStatus, 'verified');
  assert(report.roots.some(root => root.kind === 'official-claude-data' && root.canMove));
  assert(report.roots.some(root => root.kind === 'msix-LocalState' && root.present.includes('Local Storage')));
  assert(report.roots.some(root => root.kind === 'other-desktop-layout' && root.canMove));
  assert(report.roots.some(root => root.kind === 'third-party-profile' && !root.canMove));
  const redirected = { ...f.context, environment: { LOCALAPPDATA: path.join(f.home, 'redirected') } };
  assert.equal((await auditWindows(f.home, redirected)).rootStatus, 'unverified');
  await assert.rejects(previewWindowsWorkflow('archive', {}, redirected), /roots unverified/);
  assert(!await exists(path.join(f.home, '.claude-account-reset')));
});

test('Windows archives reviewed history, refuses stale or damaged archives, and isolates with rollback', { skip: !windows, timeout: 180000 }, async t => {
  const f = await fixture(t);
  const code = path.join(f.home, '.claude');
  const transcript = await put(path.join(code, 'projects', old, old + '.jsonl'), JSON.stringify({
    message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'unique-synthetic-thinking', signature: 'synthetic-signature' },
      { type: 'tool_use', name: 'fixture-tool', input: { [old.toUpperCase()]: old } },
      { type: 'text', text: 'public synthetic text ' + old }
    ] }
  }) + '\n');
  const attachmentBytes = Buffer.from([0, 0xff, 0xee, 1, 2]);
  const attachment = await put(path.join(code, 'attachments', old, 'capture.png'), attachmentBytes);
  const snapshot = await put(path.join(code, 'file-history', old, 'edit.txt'), 'synthetic diff ' + old);
  const credential = await put(path.join(code, '.credentials.json'), '{}');
  const config = await put(path.join(f.home, '.claude.json'), '{}');
  const project = await put(path.join(f.home, 'project', 'notes.txt'), 'leave unchanged');
  assert.equal((await listWindowsHistory(code, f.context)).length, 3);
  await assert.rejects(previewWindowsWorkflow('archive', {
    ids: [old], files: [{ path: credential, format: 'json' }]
  }, f.context), /history tree/);
  const entries = [
    { path: transcript, format: 'transcript' }, { path: attachment, format: 'binary' },
    { path: snapshot, format: 'text' }
  ];
  const plan = await previewWindowsWorkflow('archive', { ids: [old], files: entries }, f.context);
  const archive = await applyWindowsWorkflow(plan.id, f.context);
  assert.equal((await verifyWindowsArchive(plan.id, f.context)).files, 3);
  const archived = (file, index = 0) => path.join(archive.directory, 'files', plan.files[file].outputs[index].name);
  assert.deepEqual(await fs.readFile(archived(1)), attachmentBytes);
  for (const [file, index] of [[0, 0], [0, 1], [2, 0]]) {
    const output = await fs.readFile(archived(file, index), 'utf8');
    assert(output.includes('redacted-id-1'));
    assert(!output.includes(old));
    assert(!output.includes('unique-synthetic-thinking'));
  }
  assert.match(await fs.readFile(archived(0), 'utf8'), /fixture-tool/);
  const fresh = { paths: [code, config], archiveId: plan.id };
  const oldSnapshot = await fs.readFile(snapshot);
  await fs.appendFile(snapshot, ' changed since archive');
  await assert.rejects(previewWindowsWorkflow('fresh', fresh, f.context), /missing a current history file/);
  await fs.writeFile(snapshot, oldSnapshot);
  await assert.rejects(previewWindowsWorkflow('fresh', { ...fresh, paths: [path.dirname(project)] }, f.context), /excluded Windows activity/);
  const before = await inventory(code);
  const attempt = await previewWindowsWorkflow('fresh', fresh, f.context);
  await assert.rejects(applyWindowsWorkflow(attempt.id, { ...f.context, beforeMove(entry) {
    if (entry.index === 1) throw Error('synthetic failure after first move');
  } }), /rolled back/);
  assert.deepEqual(await inventory(code), before);
  assert(await exists(config));
  const ready = await previewWindowsWorkflow('fresh', fresh, f.context);
  await fs.appendFile(archived(2), 'tampered');
  await assert.rejects(applyWindowsWorkflow(ready.id, f.context), /Archive integrity/);
  assert.deepEqual(await inventory(code), before);
  await fs.writeFile(archived(2), 'synthetic diff redacted-id-1');
  const result = await applyWindowsWorkflow(ready.id, f.context);
  assert(result.physicalPathsVerified);
  assert.equal(result.identityVerified, false);
  assert(!await exists(code));
  assert(!await exists(config));
  assert.deepEqual(await inventory(path.join(result.directory, 'original-0')), before);
  assert.equal(await fs.readFile(project, 'utf8'), 'leave unchanged');
  await put(path.join(code, 'new-session.txt'), 'new data');
  await assert.rejects(rollbackWindowsWorkflow(ready.id, f.context), /rollback conflict/);
  assert.equal(await fs.readFile(path.join(code, 'new-session.txt'), 'utf8'), 'new data');
  await fs.rename(code, code + '-new');
  assert.equal((await rollbackWindowsWorkflow(ready.id, f.context)).status, 'rolled-back');
  assert.deepEqual(await inventory(code), before);
});
