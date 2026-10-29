#!/usr/bin/env node
import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';
import { run, VERSION } from '../lib/core.mjs';
const help = `Claude Account Reset ${VERSION} (macOS, Node.js >=22)\n\nDefault: inspect known account state; no source data changes. Quit Claude first.\n\n  node bin/reset.mjs\n  node bin/reset.mjs --traces\n  node bin/reset.mjs --apply --yes --traces --include-keychain\n\n--apply             Apply cleanup (irreversible credentials removal)\n--yes               Explicitly authorize the displayed cleanup policy\n--traces            Also remove known analytics/account feature caches\n--include-keychain  With --apply: delete shared Claude Safe Storage / Claude Key\n--profile PATH      Inspect/reset an explicit Desktop data folder; repeatable\n--report FILE       Save a local JSON report (new file only; may contain local paths)\n--help              Show help\n\nProtected: known conversation directories, IndexedDB, Session Storage, and all\nLocal Storage records outside the deletion allowlist. This is not a complete\nforensic erasure or an account-transfer tool. No credential values are printed.\n`;
try {
  const { values: v } = parseArgs({ options: { apply: { type: 'boolean' }, yes: { type: 'boolean' }, traces: { type: 'boolean' }, 'include-keychain': { type: 'boolean' }, profile: { type: 'string', multiple: true }, report: { type: 'string' }, help: { type: 'boolean' } } });
  if (v.help) { console.log(help); process.exit(0); }
  if (process.platform !== 'darwin') throw new Error('This tool supports macOS only');
  if (process.getuid?.() === 0) throw new Error('Run as your own user, without sudo');
  if (v.apply && !v.yes) throw new Error('Read the audit first; cleanup requires --apply --yes');
  if (v['include-keychain'] && !v.apply) throw new Error('--include-keychain requires --apply');
  // Reserve output before mutation so an existing report never causes a late failure.
  let reportFile;
  if (v.report) reportFile = await fs.open(v.report, 'wx', 0o600);
  try {
    const report = await run({ profiles: v.profile, apply: !!v.apply, traces: !!v.traces, includeKeychain: !!v['include-keychain'] });
    const text = JSON.stringify(report, null, 2) + '\n';
    if (reportFile) await reportFile.writeFile(text);
    console.log(text);
  } finally { if (reportFile) await reportFile.close(); }
} catch (e) { console.error(`Stopped: ${e.message}`); process.exitCode = 1; }
