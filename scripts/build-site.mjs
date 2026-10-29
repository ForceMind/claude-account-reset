import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
const out = path.join(root, 'site/downloads'); await fs.mkdir(out, { recursive: true });
const name = `claude-account-reset-${pkg.version}.tar.gz`;
for (const stale of await fs.readdir(out)) {
  if (/^claude-account-reset-[0-9]+\.[0-9]+\.[0-9]+\.tar\.gz$/.test(stale) && stale !== name) await fs.unlink(path.join(out, stale));
}
execFileSync('tar', ['-czf', path.join(out, name), 'package.json', 'package-lock.json', 'bin', 'lib', 'README.md', 'LICENSE', 'docs/LESSONS.md', 'docs/RECOVERY.md'], { cwd: root });
const sha = createHash('sha256').update(await fs.readFile(path.join(out, name))).digest('hex');
await fs.writeFile(path.join(out, 'SHA256SUMS'), `${sha}  ${name}\n`);
await fs.writeFile(path.join(out, 'install.sh'), `#!/bin/bash
set -euo pipefail
# Download first, inspect this script, then run: bash install.sh
# Requires macOS + Node.js 22+. No sudo; this never performs cleanup or recovery automatically.
[[ "$(uname -s)" == "Darwin" ]] || { echo 'This tool supports macOS only.' >&2; exit 1; }
command -v node >/dev/null && command -v npm >/dev/null || { echo 'Install Node.js 22+ first.' >&2; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' || { echo 'Node.js 22+ required.' >&2; exit 1; }
[[ "$(id -u)" != "0" ]] || { echo 'Run without sudo.' >&2; exit 1; }
DEST="$PWD/claude-account-reset-${pkg.version}"
mkdir "$DEST" || { echo 'Destination exists; nothing overwritten.' >&2; exit 1; }
ARCHIVE="$DEST/tool.tar.gz"
curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 'https://claude-account-reset.pages.dev/downloads/${name}' --output "$ARCHIVE"
printf '%s  %s\\n' '${sha}' "$ARCHIVE" | shasum -a 256 -c -
tar -xzf "$ARCHIVE" -C "$DEST"
rm "$ARCHIVE"
cd "$DEST"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
printf '\\nInstalled %s. Quit Claude, then run the inspection:\\n' "$DEST"
printf 'cd "%s"\\nnode bin/reset.mjs --traces\\nnode bin/recover.mjs\\n' "$DEST"
printf '\\nNo Claude data has been inspected or changed by this installer.\\n'
`);
console.log(`Built ${name} SHA256 ${sha}`);
