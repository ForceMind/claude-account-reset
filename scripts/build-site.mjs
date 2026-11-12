import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
const sourceOnly = process.argv.includes('--source-only');
const release = sourceOnly ? null : JSON.parse(await fs.readFile(path.join(root, 'release', `v${pkg.version}.json`)));
if(release&&(release.version!==pkg.version||release.repository!=='ForceMind/claude-account-reset'||release.tag!==`v${pkg.version}`||release.artifacts.some(a=>!/^[A-Za-z0-9.-]+$/.test(a.name)||!Number.isSafeInteger(a.bytes)||a.bytes<=0||!/^[a-f0-9]{64}$/.test(a.sha256))))throw Error('Invalid public release manifest');
const out = path.join(root, sourceOnly ? 'out/source' : 'site/downloads'); await fs.mkdir(out, { recursive: true });
const name = `claude-account-reset-${pkg.version}.tar.gz`;
for (const stale of await fs.readdir(out)) {
  if (/^claude-account-reset-[0-9]+\.[0-9]+\.[0-9]+\.tar\.gz$/.test(stale) && stale !== name) await fs.unlink(path.join(out, stale));
}
execFileSync('tar', ['--uid','0','--gid','0','--uname','root','--gname','root','--exclude=desktop/dist', '--exclude=.DS_Store', '-czf', path.join(out, name), 'package.json', 'package-lock.json', 'forge.config.cjs', 'SKILL.md', 'agents', 'bin', 'lib', 'desktop', 'scripts', 'test', 'release', 'README.md', 'LICENSE', 'docs/LESSONS.md', 'docs/RECOVERY.md', 'docs/HANDOFF.md', 'docs/SAFETY.md','docs/DESKTOP.md'], { cwd: root,env:{...process.env,COPYFILE_DISABLE:'1'} });
const sha = createHash('sha256').update(await fs.readFile(path.join(out, name))).digest('hex');
if (sourceOnly) {
  console.log(`Built candidate source archive ${name} SHA256 ${sha}`);
  process.exit(0);
}
const artifacts=[...release.artifacts,{name,bytes:(await fs.stat(path.join(out,name))).size,sha256:sha}];
await fs.writeFile(path.join(out, 'SHA256SUMS'), artifacts.map(a=>`${a.sha256}  ${a.name}`).join('\n')+'\n');
await fs.writeFile(path.join(out,`release-v${pkg.version}.json`),JSON.stringify({...release,artifacts},null,2)+'\n');
const base=`https://github.com/${release.repository}/releases/download/${release.tag}/`;
await fs.writeFile(path.join(root,'site/_redirects'),release.artifacts.map(a=>`/downloads/${a.name} ${base}${a.name} 302`).join('\n')+'\n');
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
printf 'cd "%s"\\nnode bin/reset.mjs --plan-out reset.plan.json\\nnode bin/recover.mjs --plan-out recover.plan.json\\nnode bin/handoff.mjs --plan-out handoff.plan.json\\n' "$DEST"
printf '\\nYou can also ask a local AI agent to read SKILL.md in this folder and start with a preview.\\n'
printf '\\nNo Claude data has been inspected or changed by this installer.\\n'
`);
console.log(`Built ${name} SHA256 ${sha}`);
