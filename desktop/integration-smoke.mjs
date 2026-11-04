// Native Electron/utility-process integration, without UI automation or real accounts.
import { app, utilityProcess } from 'electron';
import fs from 'node:fs/promises';
import sync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const bundle = process.argv[2];
if (!bundle?.endsWith('.app')) throw Error('Pass the built application bundle');
const root = sync.mkdtempSync(path.join(sync.realpathSync(os.tmpdir()), 'desktop-native-smoke-'));
app.setPath('userData', path.join(root, 'electron-user-data'));
app.whenReady().then(async () => {
const worker = utilityProcess.fork(path.resolve(bundle, 'Contents/Resources/app.asar/desktop/worker.mjs'), [], { stdio: 'pipe' });
worker.stdout?.resume(); worker.stderr?.resume();
const pending = new Map();
worker.on('message', message => { const p = pending.get(message.id); if (!p) return; pending.delete(message.id); if (message.error) p.reject(Error(message.error)); else p.resolve(message.result); });
worker.on('exit', () => { for (const p of pending.values()) p.reject(Error('Packaged worker exited')); pending.clear(); });
const timeout = setTimeout(() => { console.error('Native integration timed out'); worker.kill(); app.exit(1); }, 45000);
function request(method, ...args) { return new Promise((resolve, reject) => { const id = randomUUID(); pending.set(id, { resolve, reject }); worker.postMessage({ id, method, args }); }); }
try {
  await new Promise((resolve, reject) => { const id = randomUUID(); pending.set(id, { resolve, reject }); worker.postMessage({ id, method: 'init', demo: true, demoRoot: root }); });
  const found = await request('discover'); assert.equal(found.demo, true); assert.equal(found.directories.length, 2);
  assert(found.directories.every(d => d.path.startsWith(root + '/')));
  const p = await request('preview', { directoryIds: found.directories.map(d => d.id), traces: false, identityRecords: false, includeKeychain: false });
  assert.equal(p.desktopSessions, 1); assert.equal(p.codeSessions, 1);
  const result = await request('execute', p.id); assert.equal(result.status, 'complete'); assert.equal(result.protectedDataVerified, true); assert.equal(result.backupDiscarded, false);
  const backups = await request('listBackups'); assert.equal(backups[0].valid, true);
  const restore = await request('previewRestore', backups[0].id); const restored = await request('restore', restore.id); assert.equal(restored.status, 'complete');
  console.log(JSON.stringify({ packagedUtilityProcess: true, packagedNativeLevelDB: true, syntheticPreviewApplyRestore: true, noRealAccountData: true, uiVerified: false }));
  clearTimeout(timeout); worker.kill(); await fs.rm(root, { recursive: true, force: true }); app.exit(0);
} catch (error) { clearTimeout(timeout); console.error(error.message); worker.kill(); app.exit(1); }

}).catch(error => { console.error(error.message); app.exit(1); });
