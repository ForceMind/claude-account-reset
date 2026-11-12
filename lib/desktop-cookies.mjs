import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { privateDirectory, safe } from './safety.mjs';

export const desktopCookieFiles = ['Cookies', 'Network/Cookies'];
export const cookieSidecars = ['-wal', '-shm', '-journal'];

// Keep the predicate specific to Claude's web login cookie.
const predicate = "name COLLATE BINARY = 'sessionKey' AND host_key COLLATE BINARY IN ('claude.ai', '.claude.ai')";

async function inspect(file, apply) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: !apply, enableForeignKeyConstraints: false });
  try {
    db.exec('PRAGMA trusted_schema = OFF');
    const { sql } = db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'cookies'").get() ?? {};
    const columns = db.prepare('PRAGMA table_info(cookies)').all().map(column => column.name);
    if (!/^CREATE TABLE\b/i.test(sql ?? '') || !['host_key', 'name', 'encrypted_value'].every(column => columns.includes(column))
      || db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'trigger' LIMIT 1").get()) {
      throw Error('Unrecognized Desktop cookie database');
    }
    const targets = db.prepare(`SELECT count(*) AS count FROM cookies WHERE ${predicate}`);
    const count = targets.get().count;
    const total = db.prepare('SELECT count(*) AS count FROM cookies');
    const preserved = total.get().count - count;
    if (apply && count) {
      db.exec('PRAGMA journal_mode = DELETE; PRAGMA secure_delete = ON; BEGIN IMMEDIATE');
      const changed = db.prepare(`DELETE FROM cookies WHERE ${predicate}`).run().changes;
      if (changed !== count || targets.get().count !== 0 || total.get().count !== preserved) throw Error('Desktop cookie verification failed');
      db.exec('COMMIT');
      const check = db.prepare('PRAGMA quick_check').get();
      if (check.quick_check !== 'ok') throw Error('Desktop cookie database integrity check failed');
    }
    return { count, preserved };
  } finally { db.close(); }
}

export async function inspectDesktopCookies(file) {
  await safe(file);
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'claude-cookie-'));
  try {
    await privateDirectory(root, { recursive: true });
    const copy = path.join(root, 'Cookies');
    await fs.copyFile(file, copy, 1);
    return await inspect(copy, false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

export function clearStagedDesktopCookies(file) {
  return inspect(file, true);
}
