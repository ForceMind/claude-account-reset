import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { VERSION, exists, safe, files, snapshot, assertSame, discover, ensureStopped } from './core.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LOCAL_ID = /^local_([a-f0-9-]{36})$/i;
// Only local conversation presentation/location fields. Credentials, hooks, pending
// actions, remote connector configuration and cloud bridge identifiers are excluded.
const FIELDS = new Set(`sessionId cliSessionId cwd originCwd worktreePath worktreeName
  gitAnchors gitAnchorsFolderRealpath lastFocusedAt sourceBranch branch createdAt
  lastActivityAt model effort isArchived title titleSource completedTurns titleTurn
  postTurnSummary postTurnSummaryFor lastAssistantUuid writtenBranches`.split(/\s+/));
const digest = async p => { const h = createHash('sha256'); for await (const b of createReadStream(p)) h.update(b); return h.digest('hex'); };
const sameObject = (a, b) => assertSame(a, b);

export function recoveredRecord(record) {
  const match = typeof record?.sessionId === 'string' && LOCAL_ID.exec(record.sessionId);
  const cli = record.cliSessionId ?? match?.[1];
  if (!match || !UUID.test(match[1]) || !UUID.test(cli ?? '') || typeof record.cwd !== 'string' || !path.isAbsolute(record.cwd)) throw new Error('Unsupported local session record');
  const result = Object.fromEntries(Object.entries(record).filter(([key]) => FIELDS.has(key)));
  return { ...result, cliSessionId: cli, permissionMode: 'default', remoteControlAutoEligible: false, remoteControlUserEnabled: false, remoteControlUserToggled: true };
}
async function readConfig(p) {
  await safe(p);
  try { return JSON.parse(await fs.readFile(p, 'utf8')); }
  catch { throw new Error('Unreadable JSON in recovery scope; no configuration content is printed'); }
}
export async function records(profile) {
  const root = path.join(profile, 'claude-code-sessions');
  const result = [];
  for (const p of await files(root)) {
    if (!/^local_.*\.json$/.test(path.basename(p))) continue;
    if ((await fs.stat(p)).size > 10 * 1024 * 1024) throw new Error('Unexpectedly large session index');
    const data = await readConfig(p);
    const record = recoveredRecord(data);
    if (path.basename(p) !== `${record.sessionId}.json`) throw new Error('Index filename and session ID disagree');
    result.push({ file: p, record });
  }
  return result;
}
export async function transcriptCandidates(home) {
  const root = path.join(home, '.claude/projects'); const result = new Map();
  if (!await exists(root)) return result;
  await safe(root);
  // Main CLI transcripts are immediate files inside a project. Subagent transcripts
  // do not become standalone Desktop sessions and are never imported here.
  for (const project of (await fs.readdir(root)).sort()) {
    const dir = path.join(root, project); await safe(dir);
    if (!(await fs.stat(dir)).isDirectory()) continue;
    for (const name of (await fs.readdir(dir)).sort()) {
      if (!name.endsWith('.jsonl') || !UUID.test(name.slice(0, -6))) continue;
      const p = path.join(dir, name); await safe(p);
      if (!(await fs.stat(p)).isFile()) continue;
      const id = name.slice(0, -6);
      result.set(id, [...(result.get(id) ?? []), p]);
    }
  }
  return result;
}

export async function inspectThinking(file) {
  const result = { thinkingBlocks: 0, redactedThinkingBlocks: 0, signedBlocks: 0 };
  const input = createReadStream(file);
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      if (line.length > 32 * 1024 * 1024) throw new Error('Unsupported transcript line size');
      let row;
      try { row = JSON.parse(line); } catch { throw new Error('Unreadable transcript JSON; no message content is printed'); }
      if (!row || (row.type !== 'assistant' && row.message?.role !== 'assistant')) continue;
      const blocks = row.message?.content;
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {
        if (!block || !['thinking', 'redacted_thinking'].includes(block.type)) continue;
        if (block.type === 'thinking') result.thinkingBlocks += 1;
        else result.redactedThinkingBlocks += 1;
        if (typeof block.signature === 'string' && block.signature.length) result.signedBlocks += 1;
      }
    }
  } finally { lines.close(); input.destroy(); }
  return result;
}

async function privateCopy(source, target) {
  await fs.mkdir(target, { mode: 0o700 });
  for (const name of await fs.readdir(source)) {
    const from = path.join(source, name), to = path.join(target, name);
    await safe(from);
    const stat = await fs.stat(from);
    if (stat.isDirectory()) await privateCopy(from, to);
    else if (stat.isFile()) { await fs.copyFile(from, to, 1); await fs.chmod(to, 0o600); }
    else throw new Error('Unsupported backup file type');
  }
}

export async function recover({ home = os.homedir(), sources, target = path.join(home, 'Library/Application Support/Claude'), org, apply = false, backupParent = path.resolve('recovery-backups'), guard = ensureStopped, beforeWrite } = {}) {
  guard(); target = path.resolve(target); await safe(target);
  const configPath = path.join(target, 'config.json');
  const account = (await readConfig(configPath)).lastKnownAccountUuid;
  if (!UUID.test(account ?? '')) throw new Error('Target has no valid account identifier. Sign in to the intended account, then quit Claude');
  const accountRoot = path.join(target, 'claude-code-sessions', account); await safe(accountRoot);
  if (!await exists(accountRoot)) throw new Error('Target account has no initialized Code storage directory; open Code once, then quit Claude');
  const orgs = [];
  for (const name of await fs.readdir(accountRoot)) {
    const p = path.join(accountRoot, name); await safe(p);
    if (UUID.test(name) && (await fs.stat(p)).isDirectory()) orgs.push(name);
  }
  if (org !== undefined && (!UUID.test(org) || !orgs.includes(org))) throw new Error('--org must name an existing organization directory under the target account');
  if (org === undefined && orgs.length !== 1) throw new Error('Target organization is ambiguous; choose an existing directory using --org UUID');
  const targetDir = path.join(accountRoot, org ?? orgs[0]);
  sources = [...new Set((sources ?? await discover(home)).map(p => path.resolve(p)))].sort();
  if (!sources.length) throw new Error('No source profiles found');
  const all = (await Promise.all(sources.map(records))).flat();
  // Existing target entries always win, including entries restored during a previous run.
  const existing = (await records(target)).filter(r => path.dirname(r.file) === targetDir);
  const existingIds = new Set(existing.map(r => r.record.sessionId));
  const existingCli = new Set(existing.map(r => r.record.cliSessionId));
  const unique = new Map();
  for (const row of all) {
    const id = row.record.cliSessionId; const previous = unique.get(id);
    if (!previous || Number(row.record.lastActivityAt ?? 0) > Number(previous.record.lastActivityAt ?? 0)) unique.set(id, row);
  }
  const transcripts = await transcriptCandidates(home);
  const planned = [], skipped = [], thinkingChecks = []; const hashes = new Map(); const plannedNames = new Set();
  for (const [cli, row] of unique) {
    const { record } = row;
    const alreadyPresent = existingIds.has(record.sessionId) || existingCli.has(cli);
    const candidates = transcripts.get(cli) ?? [];
    if (!candidates.length) { skipped.push({ sessionId: record.sessionId, reason: alreadyPresent ? 'already-present-transcript-not-found' : 'missing-transcript' }); continue; }
    const candidateHashes = [];
    for (const p of candidates) { const h = await digest(p); hashes.set(p, h); candidateHashes.push(h); }
    if (new Set(candidateHashes).size > 1) { skipped.push({ sessionId: record.sessionId, reason: 'ambiguous-transcript' }); continue; }
    if ((await fs.stat(candidates[0])).size === 0) { skipped.push({ sessionId: record.sessionId, reason: 'empty-transcript' }); continue; }
    let thinking;
    try { thinking = await inspectThinking(candidates[0]); }
    catch { skipped.push({ sessionId: record.sessionId, reason: 'unreadable-transcript' }); continue; }
    thinkingChecks.push({ sessionId: record.sessionId, ...thinking });
    if (alreadyPresent) { skipped.push({ sessionId: record.sessionId, reason: 'already-present' }); continue; }
    const dest = path.join(targetDir, `${record.sessionId}.json`);
    if (plannedNames.has(dest) || await exists(dest)) throw new Error('Recovery index collision; no files written');
    plannedNames.add(dest);
    planned.push({ ...row, dest, workingDirectoryExists: await exists(record.cwd) });
  }
  const protectedRoots = sources.map(p => path.join(p, 'claude-code-sessions'));
  if (!sources.includes(target)) protectedRoots.push(path.join(target, 'claude-code-sessions'));
  const indexBefore = await snapshot(protectedRoots);
  const report = { version: VERSION, mode: apply ? 'apply' : 'audit', targetDirectory: targetDir, sourceProfiles: sources, sourceRecords: all.length, uniqueSessions: unique.size, planned: planned.length, created: 0, archived: planned.filter(r => r.record.isArchived).length, skipped, missingWorkingDirectories: planned.filter(r => !r.workingDirectoryExists).map(r => ({ sessionId: r.record.sessionId, cwd: r.record.cwd })), originalsUnchanged: null, backupDirectory: null, uiVerified: false, thinking: { policy: 'preserve', inspectedSessions: thinkingChecks.length, sessionsWithThinking: thinkingChecks.filter(r => r.thinkingBlocks + r.redactedThinkingBlocks > 0), organizationCompatibility: 'not-verified', warning: 'Historical thinking may be bound to its originating organization. A restored index does not make that thinking reusable by another organization. Claude may drop these blocks and generate new reasoning, increasing latency and token usage. No thinking, signatures or message content are changed.', reference: 'https://platform.claude.com/docs/en/build-with-claude/preserved-thinking' }, limits: ['Local Code indices only; no Cowork or cloud chat recovery', 'No login restoration, trust grants, cloud transfer, transcript rewriting or thinking re-signing', 'Account and organization come from existing local directories; verify the intended destination', 'UI display and ability to continue work are not verified by this command'] };
  async function verifyOriginals() {
    for (const [p, h] of Object.entries(indexBefore)) if (!await exists(p) || await digest(p) !== h) throw new Error('An original index changed during recovery');
    for (const [p, h] of hashes) if (!await exists(p) || await digest(p) !== h) throw new Error('A source transcript changed during recovery');
  }
  if (apply && planned.length) {
    guard();
    if ((await readConfig(configPath)).lastKnownAccountUuid !== account) throw new Error('Target account changed during planning');
    await verifyOriginals();
    await safe(backupParent);
    // Backups must not be placed inside any Claude data directory or transcript tree.
    for (const root of [...sources, target, path.join(home, '.claude')]) {
      const rel = path.relative(root, path.resolve(backupParent));
      if (!rel || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))) throw new Error('Backup directory must be outside Claude data');
    }
    await fs.mkdir(backupParent, { recursive: true, mode: 0o700 });
    const backup = await fs.mkdtemp(path.join(backupParent, 'recovery-')); await fs.chmod(backup, 0o700); report.backupDirectory = backup;
    await privateCopy(targetDir, path.join(backup, 'target-before'));
    const manifestPath = path.join(backup, 'manifest.json');
    const manifest = { version: VERSION, targetDirectory: targetDir, planned: planned.map(r => r.dest), created: [], originalIndexHashes: indexBefore, transcriptHashes: Object.fromEntries(hashes), status: 'prepared' };
    const save = () => fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    await save(); const written = [];
    try {
      if (beforeWrite) await beforeWrite(); // Injectable test failure/concurrency boundary.
      guard();
      if ((await readConfig(configPath)).lastKnownAccountUuid !== account) throw new Error('Target account changed before write');
      await verifyOriginals();
      for (const row of planned) {
        await safe(row.dest);
        const handle = await fs.open(row.dest, 'wx', 0o600);
        written.push(row.dest);
        try { await handle.writeFile(JSON.stringify(row.record, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
        manifest.created.push(row.dest); await save();
      }
      for (const row of planned) sameObject(row.record, await readConfig(row.dest));
      await verifyOriginals();
      manifest.status = 'complete'; await save(); report.created = written.length;
    } catch (error) {
      // Keep originals and backup. Remove only files successfully created by this run.
      const rollbackFailures = [];
      for (const p of written) {
        try {
          const row = planned.find(r => r.dest === p);
          const expected = JSON.stringify(row.record, null, 2) + '\n';
          if (await fs.readFile(p, 'utf8') !== expected) throw new Error('New record changed; preserve it for manual review');
          await fs.unlink(p);
        } catch { rollbackFailures.push(p); }
      }
      manifest.status = rollbackFailures.length ? 'rollback-incomplete' : 'rolled-back'; manifest.rollbackFailures = rollbackFailures; await save();
      throw new Error(`Recovery stopped; ${manifest.status}. Inspect local manifest: ${manifestPath}`);
    }
  }
  await verifyOriginals(); report.originalsUnchanged = true;
  return report;
}
