import fs from 'node:fs/promises';
import path from 'node:path';
import { ClassicLevel } from 'classic-level';

// Only synthetic data created under a new, private root. Never discover the real home.
export async function createDemo(root,{rich=false}={}) {
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
  await write(path.join(index, 'local_' + id + '.json'), { sessionId: 'local_' + id, cliSessionId: id, title: '演示会话 · 保留完整历史',cwd:home,lastActivityAt:'2026-11-05T01:00:00Z' });
  const user=JSON.stringify({type:'user',message:{role:'user',content:'请保留这份合成历史。'}})+'\n';
  const answer=JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'SYNTHETIC THINKING' }, { type: 'text', text: '这是一条合成记录。' },{type:'tool_use',name:'demo_tool',input:{text:'只展示，不执行'}},{type:'image',source:{type:'base64',data:'U1lOVEhFVElDLUFUVEFDSE1FTlQ='}}] } }) + '\n';
  await write(path.join(project, id + '.jsonl'), user+answer);
  await write(path.join(home, '.claude.json'), { oauthAccount: { accountUuid: 'synthetic-account' }, userID: 'synthetic-user', theme: 'dark' });
  await write(path.join(code, '.credentials.json'), { token: 'SYNTHETIC-NOT-A-CREDENTIAL' });
  const db = new ClassicLevel(path.join(profile, 'Local Storage/leveldb'), { keyEncoding: 'buffer', valueEncoding: 'buffer' });
  await db.open();
  try { for (const [key, value] of [['lastLoginMethod', 'synthetic'], ['editor-preferences', 'keep']]) await db.put(Buffer.concat([Buffer.from('_https://claude.ai\0'), Buffer.from([1]), Buffer.from(key)]), Buffer.from(value)); }
  finally { await db.close(); }
  if(rich){
    const workspace=path.join(home,'demo-project');await fs.mkdir(path.join(workspace,'.claude'),{recursive:true});
    await write(path.join(workspace,'.claude/settings.json'),{model:'claude-demo-project',env:{ANTHROPIC_BASE_URL:'https://project.example.test/v1'}});
    await write(path.join(workspace,'.mcp.json'),{mcpServers:{'demo-project-mcp':{command:'SYNTHETIC-DO-NOT-EXECUTE'}}});
    await write(path.join(code,'settings.json'),{model:'claude-demo-user',apiKeyHelper:'SYNTHETIC-DO-NOT-EXECUTE',env:{ANTHROPIC_BASE_URL:'https://demo-user:SYNTHETIC-PASSWORD@gateway.example.test/v1?key=SYNTHETIC-QUERY',ANTHROPIC_API_KEY:'SYNTHETIC-PRIVATE-API-KEY'},mcpServers:{'demo-server':{command:'SYNTHETIC-DO-NOT-EXECUTE',env:{TOKEN:'SYNTHETIC-MCP-SECRET'}}}});
    const copy=path.join(code,'projects/demo-snapshot');await fs.mkdir(copy,{recursive:true});await write(path.join(copy,id+'.jsonl'),user);
    const orphan='22222222-2222-4222-8222-222222222222',missing='33333333-3333-4333-8333-333333333333',fork='44444444-4444-4444-8444-444444444444';
    await write(path.join(project,orphan+'.jsonl'),user+answer);
    await write(path.join(index,'local_'+missing+'.json'),{sessionId:'local_'+missing,cliSessionId:missing,title:'只有索引的演示会话',cwd:workspace,isArchived:true});
    await write(path.join(index,'local_'+fork+'.json'),{sessionId:'local_'+fork,cliSessionId:fork,title:'存在分叉副本的演示会话',cwd:workspace});
    await write(path.join(project,fork+'.jsonl'),user+answer);await write(path.join(copy,fork+'.jsonl'),user+JSON.stringify({type:'assistant',message:{content:'另一条合成分叉。'}})+'\n');
    await write(path.join(index,'local_bad.json'),'{invalid synthetic index');
  }
  return { home, storage: path.join(home, 'desktop-app') };
}
