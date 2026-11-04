import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const { version } = JSON.parse(await fs.readFile('package.json'));
const arch = process.arch;
const app = path.resolve(`out/Claude Account Reset-darwin-${arch}/Claude Account Reset.app`);
await fs.access(app);
const root = await fs.mkdtemp(path.resolve('out/dmg-source-'));
const target = path.resolve(`out/make/Claude-Account-Reset-${version}-macOS-${arch}.dmg`);
try {
  // ditto preserves the bundle's native symlinks. No custom image parser or mounting step.
  execFileSync('/usr/bin/ditto', [app, path.join(root, 'Claude Account Reset.app')]);
  await fs.symlink('/Applications', path.join(root, 'Applications'));
  await fs.mkdir(path.dirname(target), { recursive: true });
  execFileSync('/usr/bin/hdiutil', ['create', '-volname', 'Claude Account Reset', '-srcfolder', root, '-format', 'UDZO', '-ov', target], { stdio: 'inherit' });
} finally { await fs.rm(root, { recursive: true, force: true }); }
