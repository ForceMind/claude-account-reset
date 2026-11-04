import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await fs.mkdir('desktop/dist', { recursive: true });
execFileSync(process.execPath, ['node_modules/typescript/lib/tsc.js', '-p', 'desktop/tsconfig.json'], { stdio: 'inherit' });
for (const f of ['index.html', 'styles.css']) await fs.copyFile('desktop/ui/' + f, 'desktop/dist/' + f);
