// Native Electron/utility-process integration, without UI automation or real accounts.
import { app, utilityProcess } from 'electron';
import fs from 'node:fs/promises';
import sync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { windowsDesktopRoaming } from '../lib/windows.mjs';

const bundle = process.argv[2];
const windows = process.platform === 'win32';
if (!bundle || (!windows && !bundle.endsWith('.app'))) throw Error('Pass the built application bundle');
const root = sync.mkdtempSync(path.join(sync.realpathSync(os.tmpdir()), 'desktop-native-smoke-'));
app.setPath('userData', path.join(root, 'electron-user-data'));
app.whenReady().then(async () => {
const worker = utilityProcess.fork(path.resolve(bundle, windows ? 'resources/app.asar/desktop/worker.mjs' : 'Contents/Resources/app.asar/desktop/worker.mjs'), [], { stdio: 'pipe' });
worker.stdout?.resume(); worker.stderr?.resume();
const pending = new Map();
worker.on('message', message => { const p = pending.get(message.id); if (!p) return; pending.delete(message.id); if (message.error) p.reject(Error(message.error)); else p.resolve(message.result); });
worker.on('exit', () => { for (const p of pending.values()) p.reject(Error('Packaged worker exited')); pending.clear(); });
const timeout = setTimeout(() => { console.error('Native integration timed out'); worker.kill(); app.exit(1); }, 180000);
function request(method, ...args) { return new Promise((resolve, reject) => { const id = randomUUID(); pending.set(id, { resolve, reject }); worker.postMessage({ id, method, args }); }); }
try {
  await new Promise((resolve, reject) => { const id = randomUUID(); pending.set(id, { resolve, reject }); worker.postMessage({ id, method: 'init', demo: true, richDemo:false, demoRoot: root }); });
  let found = await request('discover'); assert.equal(found.demo, true); assert.equal(found.directories.length, 2);
  assert(found.directories.every(d => d.path.startsWith(root + path.sep)));
  const p = await request('preview', { directoryIds: found.directories.filter(d => !windows || d.kind === 'code').map(d => d.id), traces: false, identityRecords: false, includeKeychain: false });
  assert.equal(p.desktopSessions, windows ? 0 : 1); assert.equal(p.codeSessions, 1);
  const result = await request('execute', p.id); assert.equal(result.status, 'complete'); assert.equal(result.protectedDataVerified, true); assert.equal(result.backupDiscarded, false);
  const backups = await request('listBackups'); assert.equal(backups[0].valid, true);
  const restore = await request('previewRestore', backups[0].id); const restored = await request('restore', restore.id); assert.equal(restored.status, 'complete');
  if (windows) {
    const home = path.dirname(found.directories.find(d => d.kind === 'code').path);
    const profile = path.join(windowsDesktopRoaming(home), 'Claude');
    await fs.mkdir(path.dirname(profile), { recursive: true });
    await fs.rename(found.directories.find(d => d.kind === 'desktop').path, profile);
    const cookie = path.join(profile, 'Cookies');
    await fs.unlink(cookie);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(cookie);
    try {
      db.exec("CREATE TABLE cookies(host_key TEXT, name TEXT, encrypted_value BLOB); INSERT INTO cookies VALUES ('.claude.ai', 'sessionKey', x'01'), ('.claude.ai', 'theme', x'02')");
    } finally { db.close(); }
    const original = await fs.readFile(cookie);
    found = await request('discover');
    const source = found.directories.find(d => d.path === profile);
    assert(source?.writable);
    const plan = await request('preview', { directoryIds: [source.id], traces: false, identityRecords: false, includeKeychain: false });
    assert.equal(plan.actions.find(a => a.kind === 'desktop-cookies')?.preservedValues, 1);
    const applied = await request('execute', plan.id);
    assert.equal(applied.protectedDataVerified, true);
    const after = new DatabaseSync(cookie, { readOnly: true });
    try { assert.deepEqual(after.prepare('SELECT name FROM cookies').all().map(row => row.name), ['theme']); }
    finally { after.close(); }
    const backup = (await request('listBackups')).find(row => row.path === applied.backupDirectory);
    assert(backup?.valid);
    const restore = await request('previewRestore', backup.id);
    assert.equal((await request('restore', restore.id)).status, 'complete');
    assert.deepEqual(await fs.readFile(cookie), original);
  }
  const directoryIds=found.directories.map(d=>d.id);await request('libraryScan',{directoryIds});const page=await request('libraryPage',{});assert.equal(page.total,1);
  const row=page.rows[0];const preview=await request('libraryPreview',{id:row.id,copyId:row.copies[0].id});assert(!JSON.stringify(preview).includes('SYNTHETIC THINKING'));
  await request('libraryMark',{id:row.id,favorite:true,note:'Synthetic integration note'});
  const environment=await request('environment',{directoryIds});assert.equal(environment.cards.length,2);
  for(const kind of ['markdown','backup']){const ticket=await request('libraryPrepare',{ids:[row.id],kind});const saved=await request('librarySave',ticket.id);assert.equal(saved.sourceUnchanged,true);assert.equal(saved.files,1);}
  console.log(JSON.stringify({ packagedUtilityProcess: true, packagedNativeLevelDB: true, packagedDesktopCookieResetRestore: windows, syntheticPreviewApplyRestore: true,sessionPreviewMarkExportBackup:true,environmentOverview:true,noRealAccountData: true, uiVerified: false }));
  clearTimeout(timeout); worker.kill(); await fs.rm(root, { recursive: true, force: true }); app.exit(0);
} catch (error) { clearTimeout(timeout); console.error(error.message); worker.kill(); app.exit(1); }

}).catch(error => { console.error(error.message); app.exit(1); });
