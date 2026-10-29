#!/usr/bin/env node
import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';
import { recover } from '../lib/recovery.mjs';
import { VERSION } from '../lib/core.mjs';
const help = `Claude Local Conversation Recovery ${VERSION}\n\nQuit Claude first. Default: preview only. Local Code records, not cloud/Cowork.\n\nnode bin/recover.mjs\nnode bin/recover.mjs --apply --yes --report recovery.report.json\n\n--source PATH       Desktop source directory, repeatable (default: Claude*)\n--target PATH       Signed-in destination Desktop directory (default: Claude)\n--org UUID          Existing target organization, required if ambiguous\n--backup-dir PATH   Private local backup parent (default: ./recovery-backups)\n--apply --yes       Back up destination and add missing indices; never overwrite\n--report FILE       New local JSON report, mode 0600; may contain private paths\n--help              Show help\n\nPreserves original indices and transcript files. Restored permissions are manual\nand Remote Control is off. Does not send prompts, grant folder trust, transfer\ncloud ownership or restore old credentials. Thinking blocks are counted and
kept intact; cross-organization reuse may fail and require new reasoning.
Backups must stay private.\n`;
try {
  const { values: v } = parseArgs({ options: { apply: { type: 'boolean' }, yes: { type: 'boolean' }, source: { type: 'string', multiple: true }, target: { type: 'string' }, org: { type: 'string' }, 'backup-dir': { type: 'string' }, report: { type: 'string' }, help: { type: 'boolean' } } });
  if (v.help) { console.log(help); process.exit(0); }
  if (process.platform !== 'darwin') throw new Error('macOS only');
  if (process.getuid?.() === 0) throw new Error('Run without sudo');
  if (v.apply && !v.yes) throw new Error('Read the preview first; execution requires --apply --yes');
  const handle = v.report ? await fs.open(v.report, 'wx', 0o600) : null;
  try {
    const report = await recover({ sources: v.source, target: v.target, org: v.org, backupParent: v['backup-dir'], apply: !!v.apply });
    const output = JSON.stringify(report, null, 2) + '\n';
    if (handle) await handle.writeFile(output); console.log(output);
  } finally { if (handle) await handle.close(); }
} catch (e) { console.error(`Stopped: ${e.message}`); process.exitCode = 1; }
