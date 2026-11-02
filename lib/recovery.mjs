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
