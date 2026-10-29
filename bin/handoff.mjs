#!/usr/bin/env node
import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';
import { handoff } from '../lib/handoff.mjs';
import { VERSION } from '../lib/core.mjs';
const help = `Claude Thinking Cleanup & Handoff ${VERSION}\nDefault: preview only. Quit Claude first.\n\nnode bin/handoff.mjs\nnode bin/handoff.mjs --apply --yes --discard-backup --report handoff.report.json\n\n--source PATH          Desktop source, repeatable\n--target PATH          Target Desktop profile (default Claude)\n--org UUID             Explicit existing target organization\n--output-dir PATH      New private documents subdirectory (default ./handoff-documents)\n--backup-dir PATH      New private backup subdirectory (default ./handoff-backups)\n--discard-backup       With --apply: remove this run's backups ONLY after all checks pass\n--apply --yes          Modify shared transcripts, export visible history, recover indices\n--report FILE          New private JSON report\n--help                Show help\n\nRemoves known thinking/redacted_thinking blocks; preserves visible messages and\ntool records. Does not convert thinking into prose or disguise account identity.\nOther profiles using the same transcript are affected. No cloud/model validation.\n`;
try {
  const { values: v } = parseArgs({ options: { source: { type: 'string', multiple: true }, target: { type: 'string' }, org: { type: 'string' }, 'output-dir': { type: 'string' }, 'backup-dir': { type: 'string' }, 'discard-backup': { type: 'boolean' }, apply: { type: 'boolean' }, yes: { type: 'boolean' }, report: { type: 'string' }, help: { type: 'boolean' } } });
  if (v.help) { console.log(help); process.exit(0); }
  if (process.platform !== 'darwin' || process.getuid?.() === 0) throw new Error('Use macOS, without sudo');
  if (v.apply && !v.yes) throw new Error('Execution requires --apply --yes');
  if (v['discard-backup'] && !v.apply) throw new Error('--discard-backup requires --apply');
  const h = v.report ? await fs.open(v.report, 'wx', 0o600) : null;
  try { const r = await handoff({ sources: v.source, target: v.target, org: v.org, outputParent: v['output-dir'], backupParent: v['backup-dir'], discardBackup: !!v['discard-backup'], apply: !!v.apply }); const text = JSON.stringify(r, null, 2) + '\n'; if (h) await h.writeFile(text); console.log(text); }
  finally { if (h) await h.close(); }
} catch (e) { console.error(`Stopped: ${e.message}`); process.exitCode = 1; }
