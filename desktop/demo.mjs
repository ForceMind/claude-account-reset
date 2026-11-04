import fs from 'node:fs/promises';
import path from 'node:path';
import { ClassicLevel } from 'classic-level';

// Only synthetic data created under a new, private root. Never discover the real home.
export async function createDemo(root) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const home = await fs.mkdtemp(path.join(root, 'sample-'));
  const profile = path.join(home, 'Library/Application Support/Claude');
  const code = path.join(home, '.claude');
  const id = '11111111-1111-4111-8111-111111111111';
  const index = path.join(profile, 'claude-code-sessions/demo-account/demo-org');
  const project = path.join(code, 'projects/demo-project');
  await fs.mkdir(index, { recursive: true }); await fs.mkdir(project, { recursive: true });
  const write = (p, d) => fs.writeFile(p, typeof d === 'string' ? d : JSON.stringify(d), { mode: 0o600 });
  await write(path.join(profile, 'config.json'), { lastKnownAccountUuid: 'synthetic-account', userID: 'synthetic-user', machineID: 'synthetic-machine', theme: 'system' });
  await write(path.join(profile, 'Cookies'), 'SYNTHETIC COOKIE FILE\n');
  await write(path.join(index, 'local_' + id + '.json'), { sessionId: 'local_' + id, cliSessionId: id, title: '演示会话 · 保留完整历史' });
  await write(path.join(project, id + '.jsonl'), JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'SYNTHETIC THINKING' }, { type: 'text', text: '这是一条合成记录。' }] } }) + '\n');
  await write(path.join(home, '.claude.json'), { oauthAccount: { accountUuid: 'synthetic-account' }, userID: 'synthetic-user', theme: 'dark' });
  await write(path.join(code, '.credentials.json'), { token: 'SYNTHETIC-NOT-A-CREDENTIAL' });
  const db = new ClassicLevel(path.join(profile, 'Local Storage/leveldb'), { keyEncoding: 'buffer', valueEncoding: 'buffer' });
  await db.open();
  try { for (const [key, value] of [['lastLoginMethod', 'synthetic'], ['editor-preferences', 'keep']]) await db.put(Buffer.concat([Buffer.from('_https://claude.ai\0'), Buffer.from([1]), Buffer.from(key)]), Buffer.from(value)); }
  finally { await db.close(); }
  return { home, storage: path.join(home, 'desktop-app') };
}
