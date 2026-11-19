#!/usr/bin/env node
import os from 'node:os';
import { auditWindows } from '../lib/windows-audit.mjs';
import { readJSON } from '../lib/safety.mjs';
import { applyWindowsWorkflow, listWindowsHistory, previewWindowsWorkflow, rollbackWindowsWorkflow,
  verifyWindowsArchive } from '../lib/windows-workflow.mjs';

const usage = `Windows activity and archive workflow (Node.js 22.13+)
  node bin/windows.mjs audit
  node bin/windows.mjs history ACTIVITY_PATH
  node bin/windows.mjs archive-plan SPEC.json
  node bin/windows.mjs fresh-plan SPEC.json
  node bin/windows.mjs apply PLAN_ID --yes
  node bin/windows.mjs verify ARCHIVE_ID
  node bin/windows.mjs rollback ISOLATION_ID --yes

See docs/WINDOWS.md for input formats and the three separate acceptance checks.
Quit Claude Desktop and Code before use. Keep all local output private.`;

try {
  const [command, input, flag, ...extra] = process.argv.slice(2);
  if (command === '--help' || !command) {
    console.log(usage);
  } else {
    if (process.platform !== 'win32') throw Error('Windows is required');
    let result;
    if (command === 'audit' && !input) result = await auditWindows(os.homedir());
    else if (command === 'history' && input && !flag) result = await listWindowsHistory(input);
    else if (input && !flag && ['archive-plan', 'fresh-plan'].includes(command)) {
      result = await previewWindowsWorkflow(command === 'archive-plan' ? 'archive' : 'fresh', await readJSON(input));
    } else if (command === 'verify' && input && !flag) result = await verifyWindowsArchive(input);
    else if (input && flag === '--yes' && !extra.length && ['apply', 'rollback'].includes(command)) {
      result = await (command === 'apply' ? applyWindowsWorkflow : rollbackWindowsWorkflow)(input);
    } else throw Error(usage);
    console.log(JSON.stringify(result, null, 2));
    if (result.rootStatus === 'unverified') process.exitCode = 1;
  }
} catch (error) {
  // JSON or encoding errors can mention original content. Print only fixed diagnostics.
  const sanitized = error instanceof SyntaxError || error instanceof TypeError
    ? 'Unreadable workflow data; content withheld' : error.message;
  console.error('Stopped: ' + sanitized);
  process.exitCode = 1;
}
