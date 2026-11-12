import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DesktopService } from '../desktop/service.mjs';
import { createDemo } from '../desktop/demo.mjs';
import { ensureStopped, isClaudeCommand } from '../lib/platform.mjs';
import { safe, fingerprint, within } from '../lib/safety.mjs';
import { windowsDesktopRoaming, windowsFileAcl } from '../lib/windows.mjs';

const windows = process.platform === 'win32';

test('Windows process names recognize Claude without matching this maintenance app', () => {
  assert(isClaudeCommand('C:\\Users\\fixture\\bin\\claude.exe'));
  assert(isClaudeCommand('C:\\Program Files\\WindowsApps\\Claude_1.0_x64__pzs8sxrjxfjjc\\helper.exe'));
  assert(!isClaudeCommand('C:\\Apps\\Claude Account Reset.exe'));
});

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'claude-windows-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const config = await createDemo(temp);
  const service = new DesktopService({ ...config, demo: true });
  const { directories } = await service.discover();
  assert(directories.every(directory => within(directory.path, temp)));
  const code = directories.find(directory => directory.kind === 'code');
  const desktop = directories.find(directory => directory.kind === 'desktop');
  const request = { directoryIds: [code.id], traces: false, identityRecords: false, includeKeychain: false };
  return { service, code, desktop, request, ...config };
}

test('Windows uses the Code scope, verifies session bytes and backs up and restores login with original ACLs', { skip: !windows, timeout: 180000 }, async t => {
  const f = await fixture(t);
  const credential = path.join(f.code.path, '.credentials.json');
  const config = path.join(f.home, '.claude.json');
  const before = await fingerprint([credential, config, path.join(f.code.path, 'projects'), f.desktop.path]);
  const credentialsAcl = windowsFileAcl(credential);
  const configAcl = windowsFileAcl(config);
  await assert.rejects(f.service.preview({ ...f.request, directoryIds: [f.desktop.id] }), /已识别的 Windows MSIX/);
  const plan = await f.service.preview(f.request);
  assert.equal(plan.codeSessions, 1);
  assert.equal(plan.desktopSessions, 0);
  assert.equal(plan.actions.length, 2);
  const executed = await f.service.execute(plan.id);
  assert.equal(executed.protectedDataVerified, true);
  assert.match(windowsFileAcl(executed.backupDirectory), /^D:P/);
  await assert.rejects(fs.stat(credential), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await fs.readFile(config)), { userID: 'synthetic-user', theme: 'dark' });
  assert.equal(windowsFileAcl(config), configAcl);
  let [backup] = await f.service.listBackups();
  assert(backup.valid);
  const resetConfig = await fs.readFile(config);
  await fs.writeFile(config, '{}');
  await assert.rejects(f.service.previewRestore(backup.id), /conflict/i);
  await fs.writeFile(config, resetConfig);
  [backup] = await f.service.listBackups();
  const restore = await f.service.previewRestore(backup.id);
  assert.equal((await f.service.restore(restore.id)).status, 'complete');
  assert.equal(windowsFileAcl(credential), credentialsAcl);
  assert.deepEqual(await fingerprint(Object.keys(before)), before);
});

test('MSIX Desktop removes only the verified cookie and login fields, then restores exact bytes and ACLs', { skip: !windows, timeout: 180000 }, async t => {
  const f = await fixture(t);
  const profile = path.join(windowsDesktopRoaming(f.home), 'Claude');
  await fs.mkdir(path.dirname(profile), { recursive: true });
  await fs.rename(f.desktop.path, profile);
  const cookie = path.join(profile, 'Network', 'Cookies');
  await fs.mkdir(path.dirname(cookie));
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(cookie);
  db.exec("CREATE TABLE cookies(host_key TEXT, name TEXT, encrypted_value BLOB); INSERT INTO cookies VALUES ('.claude.ai', 'sessionKey', x'0102'), ('.claude.ai', 'theme', x'0304'), ('.example.test', 'sessionKey', x'0506')");
  db.close();
  const before = await fingerprint([profile]);
  const acl = windowsFileAcl(cookie);
  const { directories } = await f.service.discover();
  const source = directories.find(directory => directory.path === profile);
  assert(source?.writable);
  const request = { ...f.request, directoryIds: [source.id] };
  const plan = await f.service.preview(request);
  assert.equal(plan.actions.find(action => action.kind === 'desktop-cookies')?.preservedValues, 2);
  assert.equal((await f.service.execute(plan.id)).protectedDataVerified, true);
  const after = new DatabaseSync(cookie, { readOnly: true });
  try {
    const records = after.prepare('SELECT host_key, name, hex(encrypted_value) AS value FROM cookies ORDER BY rowid').all();
    assert.deepEqual(records.map(row => ({ ...row })), [{ host_key: '.claude.ai', name: 'theme', value: '0304' }, { host_key: '.example.test', name: 'sessionKey', value: '0506' }]);
  } finally { after.close(); }
  assert.equal(windowsFileAcl(cookie), acl);
  const [backup] = await f.service.listBackups();
  const restore = await f.service.previewRestore(backup.id);
  assert.equal((await f.service.restore(restore.id)).status, 'complete');
  assert.deepEqual(await fingerprint([profile]), before);
  const wal = cookie + '-wal';
  await fs.writeFile(wal, 'synthetic pending transaction');
  const busy = await f.service.preview(request);
  assert(!busy.actions.some(action => action.kind === 'desktop-cookies'));
  assert(busy.limitations.some(line => line.includes('事务状态')));
});

test('Windows guard detects a running synthetic Claude executable and rejects unsafe path forms', { skip: !windows, timeout: 60000 }, async t => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'claude-process-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  ensureStopped();
  const executable = path.join(root, 'claude.exe');
  await fs.copyFile(path.join(process.env.SystemRoot, 'System32', 'ping.exe'), executable);
  const processHandle = spawn(executable, ['-t', '127.0.0.1'], { stdio: 'ignore', windowsHide: true });
  try {
    await once(processHandle, 'spawn');
    assert.throws(() => ensureStopped(), /Claude Desktop\/Code is running/);
  } finally {
    const exited = once(processHandle, 'exit');
    processHandle.kill();
    await exited;
  }
  await assert.rejects(safe(path.join(root, 'file:stream')), /Unsupported Windows path/);
  const junction = path.join(root, 'junction');
  await fs.symlink(path.join(root, '..'), junction, 'junction');
  await assert.rejects(safe(junction), /Symlink path refused/);
});

test('Windows locked file stops execution and retains the verified session and original credential', { skip: !windows, timeout: 180000 }, async t => {
  const f = await fixture(t);
  const file = path.join(f.code.path, '.credentials.json');
  const roots = [file, path.join(f.code.path, 'projects')];
  const before = await fingerprint(roots);
  const script = '$f=[IO.File]::Open($env:CAR_LOCK,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); [Console]::WriteLine("LOCKED"); try { Start-Sleep -Seconds 150 } finally { $f.Dispose() }';
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const lock = spawn(powershell, ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')], { env: { ...process.env, CAR_LOCK: file }, windowsHide: true });
  try {
    const [ready] = await once(lock.stdout, 'data');
    assert.match(ready.toString(), /LOCKED/);
    const plan = await f.service.preview(f.request);
    await assert.rejects(f.service.execute(plan.id), /backup retained/i);
    assert.deepEqual(await fingerprint(roots), before);
    const [backup] = await f.service.listBackups();
    assert.equal(backup.status, 'partial-or-stopped');
  } finally {
    if (lock.exitCode === null) {
      const exited = once(lock, 'exit');
      lock.kill();
      await exited;
    }
  }
});
