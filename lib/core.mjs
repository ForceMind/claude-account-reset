import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { windowsDesktopRoaming } from './windows.mjs';
import { ClassicLevel } from 'classic-level';

export const VERSION = '0.7.0';
const LOGIN = new Set(['oauthAccount', 'accountUuid', 'lastKnownAccountUuid', 'oauth:tokenCache', 'oauth:tokenCacheV2']);
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
export function stripConfig(d, traces, identityRecords = false) {
  if (!d || Array.isArray(d) || typeof d !== 'object') throw new Error('Config must be a JSON object');
  const result = { ...d }; const removed = [];
  for (const k of Object.keys(d)) if ((identityRecords && k === 'userID') || LOGIN.has(k) || k.startsWith('coworkTrustedDeviceToken') || (traces && (TRACES.has(k) || k.startsWith('dxt:allowlist')))) { delete result[k]; removed.push(redact(k)); }
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
export async function localStorage(dir, { apply = false, traces = false, tempRoot = os.tmpdir() } = {}) {
  if (!await exists(dir)) return { removedKeys: [], preserved: 0, verified: true };
  await files(dir); // Validate the whole tree before copying/opening it.
  let scratch, target = dir;
  if (!apply) { scratch = await fs.mkdtemp(path.join(tempRoot, 'claude-reset-')); await fs.chmod(scratch, 0o700); target = path.join(scratch, 'db'); }
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
    try { if (db) await db.close(); } finally { if (scratch) await fs.rm(scratch, { recursive: true, force: true }); }
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
export { ensureStopped } from './platform.mjs';
export function defaultDesktopProfile(home) {
  return process.platform==='win32'?path.join(home,'AppData','Roaming','Claude'):path.join(home,'Library/Application Support/Claude');
}
export async function discover(home, environment = {}) {
  if(process.platform==='win32') {
    const roaming=environment.APPDATA||path.join(home,'AppData','Roaming');
    const profiles=new Set();
    for(const base of [roaming,windowsDesktopRoaming(home,environment)]) {
      try {
        await safe(base);
        if(!await exists(base))continue;
        for(const entry of await fs.readdir(base,{withFileTypes:true})) {
          if(entry.isDirectory()&&(entry.name==='Claude'||entry.name.startsWith('Claude-')))profiles.add(path.join(base,entry.name));
        }
      } catch { /* The user can select an accessible profile manually. */ }
    }
    return [...profiles].sort();
  }
  const support = path.join(home, 'Library/Application Support');
  const names = await exists(support) ? await fs.readdir(support) : [];
  return names.filter(n => n === 'Claude' || n.startsWith('Claude-')).sort().map(n => path.join(support, n));
}
