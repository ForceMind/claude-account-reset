import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ClassicLevel } from 'classic-level';

export const VERSION = '0.2.0';
const LOGIN = new Set(['oauthAccount', 'userID', 'lastKnownAccountUuid', 'oauth:tokenCache', 'oauth:tokenCacheV2']);
const TRACES = new Set(['cachedGrowthBookFeatures', 'cachedExperimentFeatures', 'cachedExperimentData', 'cachedGrowthBookFeaturesAt', 'clientDataCacheSlots', 'additionalModelOptionsCache', 'additionalModelCostsCache', 'modelAccessCache', 'orgModelDefaultCache', 'groveConfigCache', 'passesEligibilityCache', 'cachedExtraUsageDisabledReason', 'cachedArtifactRoster', 'additionalModelOptionsAnsweredAt']);
const LOCAL_LOGIN = new Set(['__qk_hint_account_uuid', 'rq-cache-confirmed-account', 'ccd-sync-owner', 'ccd-sync-org', 'ccd-sync-active', 'lastLoginMethod', 'has_completed_desktop_first_login']);
const LOCAL_TRACES = new Set(['antalytics_anonymous_id', 'antalytics_queue_v1', '_dd_s_v2', 'auth:last-signout', 'signed-out-at', 'signed-out-done-at']);
const HISTORY = ['claude-code-sessions', 'local-agent-mode-sessions', 'side-session-notes', 'scratch-workspaces', 'git-shadow', 'IndexedDB', 'Session Storage'];
export const redact = s => String(s).replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, '<UUID>');
export async function exists(p) { try { await fs.lstat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
export async function safe(p) {
  // Reject links in every existing path component, rather than following data outside the selected profile.
  const parts = path.resolve(p).split(path.sep); let cur = path.parse(path.resolve(p)).root;
  for (const part of parts.filter(Boolean)) { cur = path.join(cur, part); if (await exists(cur) && (await fs.lstat(cur)).isSymbolicLink()) throw new Error('Symlink path refused'); }
}
export async function files(root) {
  if (!await exists(root)) return [];
  await safe(root); const stat = await fs.lstat(root);
  if (stat.isFile()) return [root];
  if (!stat.isDirectory()) throw new Error('Unsupported file type');
  const out = [];
  for (const name of (await fs.readdir(root)).sort()) out.push(...await files(path.join(root, name)));
  return out;
}
const hash = b => createHash('sha256').update(b).digest('hex');
async function fileHash(p) { const h = createHash('sha256'); for await (const c of createReadStream(p)) h.update(c); return h.digest('hex'); }
export async function snapshot(roots) {
  const out = {};
  for (const root of roots) for (const p of await files(root)) out[p] = await fileHash(p);
  return out;
}
export function assertSame(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Preservation verification failed; stop and retain the local report'); }
export function stripConfig(d, traces) {
  if (!d || Array.isArray(d) || typeof d !== 'object') throw new Error('Config must be a JSON object');
  const result = { ...d }; const removed = [];
  for (const k of Object.keys(d)) if (LOGIN.has(k) || k.startsWith('coworkTrustedDeviceToken') || (traces && (TRACES.has(k) || k.startsWith('dxt:allowlist')))) { delete result[k]; removed.push(redact(k)); }
  return { result, removed };
}
export function shouldDeleteLocal(k, traces) {
  const text = k.toString(); const sep = text.indexOf('\0');
  if (sep < 0 || !['_https://claude.ai', '_app://localhost'].includes(text.slice(0, sep))) return false;
  const raw = k.subarray(sep + 1); let name;
  if (raw[0] === 1) name = raw.subarray(1).toString('latin1');
  else if (raw[0] === 0) name = raw.subarray(1).toString('utf16le');
  else return false;
  return LOCAL_LOGIN.has(name) || (traces && (LOCAL_TRACES.has(name) || name.startsWith('persisted.elevated-auth.')));
}
export async function localStorage(dir, { apply = false, traces = false } = {}) {
  if (!await exists(dir)) return { removedKeys: [], preserved: 0, verified: true };
  await files(dir); // Validate the whole tree before copying/opening it.
  let scratch, target = dir;
  if (!apply) { scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-reset-')); await fs.chmod(scratch, 0o700); target = path.join(scratch, 'db'); }
  let db;
  try {
    if (scratch) await fs.cp(dir, target, { recursive: true });
    db = new ClassicLevel(target, { keyEncoding: 'buffer', valueEncoding: 'buffer', createIfMissing: false });
    await db.open(); const keep = []; const drop = [];
    for await (const [k, v] of db.iterator()) {
      if (shouldDeleteLocal(k, traces)) drop.push(k); else keep.push([k, hash(v)]);
    }
    if (apply) {
      await db.batch(drop.map(key => ({ type: 'del', key })), { sync: true });
      // Compact even if only obsolete historical versions remain. This is not secure disk erasure.
      await db.compactRange(Buffer.from([0]), Buffer.alloc(1024, 255));
      for (const [key, digest] of keep) { const v = await db.get(key); if (!v || hash(v) !== digest) throw new Error('Retained Local Storage value changed'); }
      for (const key of drop) if (await db.get(key) !== undefined) throw new Error('Local Storage deletion failed');
    }
    return { removedKeys: drop.map(k => redact(k.toString().split('\0').pop().replace(/^[\x00\x01]/, ''))), preserved: keep.length, verified: true };
  } finally {
    if (db) await db.close();
    if (scratch) await fs.rm(scratch, { recursive: true, force: true });
  }
}
export async function writeJSON(p, value) {
  await safe(p); const stat = await fs.stat(p); const temp = `${p}.reset-${process.pid}`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: stat.mode & 0o777 });
    const h = await fs.open(temp, 'r+'); try { await h.sync(); } finally { await h.close(); }
    await fs.rename(temp, p);
  } finally { await fs.rm(temp, { force: true }); }
}
export function ensureStopped() {
  const r = spawnSync('/bin/ps', ['-axo', 'comm='], { encoding: 'utf8', timeout: 10000 });
  if (r.status !== 0) throw new Error('Cannot inspect processes; close Claude and retry outside a restricted sandbox');
  if (/Claude\.app\/Contents\//i.test(r.stdout) || /(?:^|\/)claude(?:\s|$)/im.test(r.stdout)) throw new Error('Claude Desktop/Code is running; quit it before inspection or cleanup');
}
export function keychain(apply) {
  const args = apply ? ['delete-generic-password', '-s', 'Claude Safe Storage', '-a', 'Claude Key'] : ['find-generic-password', '-s', 'Claude Safe Storage', '-a', 'Claude Key'];
  const r = spawnSync('/usr/bin/security', args, { encoding: 'utf8', timeout: 15000 });
  if (![0, 44].includes(r.status)) throw new Error('Keychain operation failed or access denied');
  if (apply && r.status === 0) { const check = keychain(false); if (check !== 'absent') throw new Error('Keychain deletion verification failed'); }
  return r.status === 44 ? 'absent' : apply ? 'deleted' : 'present';
}
export async function discover(home) {
  const support = path.join(home, 'Library/Application Support');
  const names = await exists(support) ? await fs.readdir(support) : [];
  return names.filter(n => n === 'Claude' || n.startsWith('Claude-')).sort().map(n => path.join(support, n));
}
export async function run({ home = os.homedir(), profiles, apply = false, traces = false, includeKeychain = false, guard = ensureStopped, keychainOp = keychain }) {
  guard(); // Also refuse live databases during audit: copying an active DB is not a consistent snapshot.
  profiles ??= await discover(home);
  if (!profiles.length) throw new Error('No Claude profile found');
  const code = path.join(home, '.claude');
  const roots = profiles.flatMap(p => HISTORY.map(n => path.join(p, n))).concat(['projects', 'sessions', 'file-history', 'uploads'].map(n => path.join(code, n)));
  const configs = [path.join(home, '.claude.json'), path.join(code, '.claude.json')];
  const backups = path.join(code, 'backups');
  if (await exists(backups)) for (const n of await fs.readdir(backups)) if (n.startsWith('.claude.json.backup.')) configs.push(path.join(backups, n));
  for (const p of profiles) { await safe(p); if (!(await fs.stat(p)).isDirectory()) throw new Error('Profile is not a directory'); configs.push(path.join(p, 'config.json')); }
  // Preflight JSON and storage before the first mutation. Audit works on disposable private copies.
  const tasks = []; const storage = [];
  const fallback = path.join(code, '.credentials.json');
  if (await exists(fallback)) { await safe(fallback); if (!(await fs.stat(fallback)).isFile()) throw new Error('Unexpected credential target type'); tasks.push({ kind: 'unlink', p: fallback }); }
  for (const p of configs) if (await exists(p)) {
    await safe(p); const { result, removed } = stripConfig(JSON.parse(await fs.readFile(p, 'utf8')), traces);
    if (removed.length) tasks.push({ kind: 'json', p, result, fields: removed });
  }
  for (const p of profiles) {
    const dir = path.join(p, 'Local Storage/leveldb'); storage.push({ p, audit: await localStorage(dir, { traces }) });
    for (const n of ['Cookies', 'Cookies-journal', 'Cookies-wal', 'Cookies-shm', 'config.json.journal', ...(traces ? ['plan-usage-history.json'] : [])]) {
      const f = path.join(p, n); if (await exists(f)) { await safe(f); if (!(await fs.stat(f)).isFile()) throw new Error('Unexpected target type'); tasks.push({ kind: 'unlink', p: f }); }
    }
    for (const [n, field] of [['remote-control-state.json', 'identities'], ...(traces ? [['ant-device-registry.json', null]] : [])]) {
      const f = path.join(p, n); if (await exists(f)) { await safe(f); const value = JSON.parse(await fs.readFile(f, 'utf8')); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Unexpected mapping format'); const result = field ? { ...value, [field]: {} } : {}; if (JSON.stringify(result) !== JSON.stringify(value)) tasks.push({ kind: 'json', p: f, result, fields: [field ?? 'account-device mappings'] }); }
    }
  }
  const before = await snapshot(roots);
  const report = { version: VERSION, mode: apply ? 'apply' : 'audit', traces, keychain: keychainOp(false), profiles: profiles.map((_, i) => `profile-${i + 1}`), changes: tasks.map(t => ({ kind: t.kind, file: redact(path.relative(home, t.p)), ...(t.fields ? { fields: t.fields } : {}) })), localStorage: storage.map((s, i) => ({ profile: `profile-${i + 1}`, ...s.audit })), protectedFiles: Object.keys(before).length, historyUnchanged: null, limits: ['Known fields only; IndexedDB and Session Storage preserved without decoding', 'No account transfer, cloud deletion, secure erasure, or proof that no other authentication mechanism exists', 'Only the default Claude Code configuration is processed; custom CLAUDE_CONFIG_DIR paths are not reset'] };
  if (apply) {
    guard();
    try {
      for (const t of tasks) { if (t.kind === 'json') await writeJSON(t.p, t.result); else await fs.unlink(t.p); }
      for (const s of storage) await localStorage(path.join(s.p, 'Local Storage/leveldb'), { apply: true, traces });
      if (includeKeychain) report.keychain = keychainOp(true);
      for (const t of tasks) {
        if (t.kind === 'unlink' && await exists(t.p)) throw new Error('Deleted file reappeared');
        if (t.kind === 'json') assertSame(t.result, JSON.parse(await fs.readFile(t.p, 'utf8')));
      }
    } catch (e) {
      try { assertSame(before, await snapshot(roots)); } catch { throw new Error('Cleanup failed AND protected files changed. Stop using Claude and investigate locally.'); }
      throw e; // No automatic rollback: restoring a token backup would restore the login we were asked to remove.
    }
  }
  assertSame(before, await snapshot(roots)); report.historyUnchanged = true;
  return report;
}
