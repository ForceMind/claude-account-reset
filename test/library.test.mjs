import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createDemo} from '../desktop/demo.mjs';
import {DesktopService} from '../desktop/service.mjs';
import {fingerprint,sha} from '../lib/safety.mjs';

async function setup(t){
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'library-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const config=await createDemo(root,{rich:true}),service=new DesktopService({...config,demo:true});
  const found=await service.discover(),ids=found.directories.map(r=>r.id),profile=found.directories.find(d=>d.kind==='desktop').path;
  const source=[profile,path.join(config.home,'.claude'),path.join(config.home,'.claude.json'),path.join(config.home,'demo-project')];
  return {...config,root,service,ids,profile,source};
}

test('session catalogue tolerates damaged index and missing bodies, excludes subagents, and never mutates sources',async t=>{
  const f=await setup(t);const sub=path.join(f.home,'.claude/projects/demo-project/subagents');await fs.mkdir(sub);await fs.writeFile(path.join(sub,'66666666-6666-4666-8666-666666666666.jsonl'),'{}\n');const before=await fingerprint(f.source);
  await assert.rejects(f.service.libraryScan({directoryIds:['not-granted']}),/选择/);
  const result=await f.service.libraryScan({directoryIds:f.ids});assert.equal(result.count,4);assert.equal(result.issues.length,1);
  const page=await f.service.libraryPage({});assert.equal(page.rows.length,4);
  assert(page.rows.some(r=>r.classification==='missing'));assert(page.rows.some(r=>r.indexCount===0));assert(page.rows.some(r=>r.copies.length===2));
  const archived=await f.service.libraryPage({filter:'archived'});assert.equal(archived.total,1);
  const filtered=await f.service.libraryPage({query:'分叉'});assert.equal(filtered.total,1);
  assert.deepEqual(await fingerprint(f.source),before);
});

test('read-only preview and copy comparison distinguish prefix and divergent histories without exposing thinking',async t=>{
  const f=await setup(t);await f.service.libraryScan({directoryIds:f.ids});const rows=(await f.service.libraryPage({})).rows;
  const prefix=rows.find(r=>r.title.startsWith('演示会话')),fork=rows.find(r=>r.title.includes('分叉'));
  const result=await f.service.libraryAnalyze(prefix.id);assert.equal(result.classification,'prefix-snapshots');assert.equal(result.thinkingBlocks,1);
  assert.equal((await f.service.libraryAnalyze(fork.id)).classification,'divergent');
  const long=prefix.copies.sort((a,b)=>b.bytes-a.bytes)[0];const p=await f.service.libraryPreview({id:prefix.id,copyId:long.id});
  assert(JSON.stringify(p).includes('只展示，不执行'));assert(!JSON.stringify(p).includes('SYNTHETIC THINKING'));assert.equal(p.thinkingInPage,1);
  await assert.rejects(f.service.libraryPreview({id:prefix.id,copyId:fork.copies[0].id}),/副本/);
});

test('pagination is bounded, cursors are bound to a copy, and changed live files expire previews',async t=>{
  const f=await setup(t),id='55555555-5555-4555-8555-555555555555',file=path.join(f.home,'.claude/projects/demo-project',id+'.jsonl');
  const line=JSON.stringify({type:'user',message:{content:'分页合成文本 '.repeat(250)}})+'\n';await fs.writeFile(file,line.repeat(100));
  await f.service.libraryScan({directoryIds:f.ids});const row=(await f.service.libraryPage({})).rows.find(r=>r.copies.some(c=>c.path===file));
  const first=await f.service.libraryPreview({id:row.id,copyId:row.copies[0].id});assert.equal(first.messages.length,40);assert(first.next);assert(JSON.stringify(first).length<250000);
  const second=await f.service.libraryPreview({id:row.id,copyId:row.copies[0].id,cursor:first.next});assert.equal(second.messages.length,40);
  await assert.rejects(f.service.libraryPreview({id:row.id,copyId:row.copies[0].id,cursor:'forged'}),/失效/);
  await fs.appendFile(file,line);await assert.rejects(f.service.libraryPreview({id:row.id,copyId:row.copies[0].id,cursor:second.next}),/变化/);
});

test('favorite and note persist only in tool storage; unknown row and oversized note are refused',async t=>{
  const f=await setup(t),before=await fingerprint(f.source);await f.service.libraryScan({directoryIds:f.ids});const row=(await f.service.libraryPage({})).rows[0];
  await f.service.libraryMark({id:row.id,favorite:true,note:'本工具中的合成备注'});
  await f.service.libraryScan({directoryIds:f.ids});const page=await f.service.libraryPage({filter:'favorite'});assert.equal(page.total,1);assert.equal(page.rows[0].mark.note,'本工具中的合成备注');
  await assert.rejects(f.service.libraryMark({id:'unknown',favorite:true,note:''}),/失效/);
  await assert.rejects(f.service.libraryMark({id:row.id,favorite:true,note:'x'.repeat(2001)}),/2000/);
  assert.deepEqual(await fingerprint(f.source),before);
});

test('environment overview redacts all credentials and URL secrets, marks uncertainty and precedence conflicts, runs nothing',async t=>{
  const f=await setup(t),before=await fingerprint(f.source);const result=await f.service.environment({directoryIds:f.ids});const text=JSON.stringify(result);
  for(const secret of ['SYNTHETIC-PASSWORD','SYNTHETIC-QUERY','SYNTHETIC-PRIVATE-API-KEY','SYNTHETIC-MCP-SECRET','SYNTHETIC-DO-NOT-EXECUTE'])assert.equal(text.includes(secret),false,secret);
  assert(text.includes('https://gateway.example.test'));assert(text.includes('https://project.example.test'));
  const code=result.cards.find(c=>c.kind==='code');assert(code.conflicts.length>=2);assert(code.model.includes('claude-demo-project'));assert(code.runtime.includes('未验证'));
  assert(code.credentials.some(s=>s.name==='ANTHROPIC_API_KEY'&&s.configured));assert(code.mcp.includes('demo-server'));assert(result.limits.some(s=>s.includes('托管策略')));
  assert.deepEqual(await fingerprint(f.source),before);
});

test('Markdown export keeps all copies, full visible content, safe fences and source bytes; no thinking or attachment payload leaks',async t=>{
  const f=await setup(t);const bodyFile=path.join(f.home,'.claude/projects/demo-project/11111111-1111-4111-8111-111111111111.jsonl');await fs.appendFile(bodyFile,JSON.stringify({type:'assistant',message:{content:'VISIBLE-FULL-'.repeat(2000)+'END-OF-FULL-VISIBLE\n```untrusted'}})+'\n');const before=await fingerprint(f.source);await f.service.libraryScan({directoryIds:f.ids});const rows=(await f.service.libraryPage({query:'演示会话'})).rows.filter(r=>r.title.startsWith('演示会话'));
  const p=await f.service.libraryPrepare({ids:rows.map(r=>r.id),kind:'markdown'});const result=await f.service.librarySave(p.id);
  const manifest=JSON.parse(await fs.readFile(path.join(result.path,'manifest.json')));assert.equal(manifest.files.length,2);
  let full=false;for(const entry of manifest.files){const body=await fs.readFile(path.join(result.path,entry.name));assert.equal(sha(body),entry.outputSha256);assert(!body.toString().includes('SYNTHETIC THINKING'));assert(!body.toString().includes('U1lOVEhFVElDLUFUVEFDSE1FTlQ='));full ||= body.toString().includes('END-OF-FULL-VISIBLE');}assert(full);
  assert((await f.service.libraryOutputs()).some(o=>o.id===result.id));assert.equal(f.service.libraryReveal(result.id),result.path);
  await assert.rejects(f.service.librarySave(p.id),/失效/);assert.deepEqual(await fingerprint(f.source),before);
});

test('backup preserves original thinking and every divergent copy, removes login-only index fields, and hashes metadata',async t=>{
  const f=await setup(t),index=path.join(f.profile,'claude-code-sessions/demo-account/demo-org/local_44444444-4444-4444-8444-444444444444.json');
  const data=JSON.parse(await fs.readFile(index));data.pendingAction='SYNTHETIC-INDEX-SECRET';data.oauthAccount={token:'SYNTHETIC-INDEX-TOKEN'};await fs.writeFile(index,JSON.stringify(data));
  const before=await fingerprint(f.source);await f.service.libraryScan({directoryIds:f.ids});const row=(await f.service.libraryPage({query:'分叉'})).rows[0];
  const p=await f.service.libraryPrepare({ids:[row.id],kind:'backup'}),result=await f.service.librarySave(p.id);
  const manifest=JSON.parse(await fs.readFile(path.join(result.path,'manifest.json')));assert.equal(manifest.files.length,2);
  let thinking=false;for(const entry of manifest.files){const body=await fs.readFile(path.join(result.path,entry.name));assert.equal(sha(body),entry.sourceSha256);thinking ||= body.toString().includes('SYNTHETIC THINKING');}assert(thinking);
  const meta=await fs.readFile(path.join(result.path,'session-indexes.json'));assert.equal(sha(meta),manifest.indexFile.sha256);assert(!meta.toString().includes('SYNTHETIC-INDEX-'));
  assert.deepEqual(await fingerprint(f.source),before);
});

test('changed source, cancellation, bad UTF-8 and unsupported nested thinking publish no successful partial output',async t=>{
  const f=await setup(t);await f.service.libraryScan({directoryIds:f.ids});let row=(await f.service.libraryPage({query:'分叉'})).rows[0];
  let p=await f.service.libraryPrepare({ids:[row.id],kind:'backup'});await fs.appendFile(row.copies[0].path,'\n');await assert.rejects(f.service.librarySave(p.id),/变化/);
  await f.service.libraryScan({directoryIds:f.ids});row=(await f.service.libraryPage({query:'分叉'})).rows[0];
  p=await f.service.libraryPrepare({ids:[row.id],kind:'backup'});f.service.library.beforePublish=()=>{f.service.cancelled=true;};await assert.rejects(f.service.librarySave(p.id),/stopped/);f.service.cancelled=false;
  const dir=path.join(f.storage,'exports');assert.deepEqual(await fs.readdir(dir),[]);f.service.library.beforePublish=()=>{};
  await fs.writeFile(row.copies[0].path,Buffer.from([0xff,0x0a]));await f.service.libraryScan({directoryIds:f.ids});row=(await f.service.libraryPage({query:'分叉'})).rows[0];
  p=await f.service.libraryPrepare({ids:[row.id],kind:'markdown'});await assert.rejects(f.service.librarySave(p.id),/UTF-8/);assert.deepEqual(await fs.readdir(dir),[]);
  await fs.writeFile(row.copies[0].path,JSON.stringify({type:'user',message:{content:[{type:'tool_result',content:[{type:'thinking',thinking:'SYNTHETIC-HIDDEN'}]}]}})+'\n');
  await f.service.libraryScan({directoryIds:f.ids});row=(await f.service.libraryPage({query:'分叉'})).rows[0];const copy=row.copies.find(c=>c.path.endsWith('/demo-project/44444444-4444-4444-8444-444444444444.jsonl'));
  await assert.rejects(f.service.libraryPreview({id:row.id,copyId:copy.id}),/thinking/);
});

test('source directory destinations and ungranted project directories are refused',async t=>{
  const f=await setup(t);await f.service.libraryScan({directoryIds:f.ids});const row=(await f.service.libraryPage({query:'分叉'})).rows[0];
  const p=await f.service.libraryPrepare({ids:[row.id],kind:'backup'});await assert.rejects(f.service.library.save(p.id,path.join(f.home,'.claude/exports')),/分开/);
  await assert.rejects(f.service.environment({directoryIds:['unknown']}),/选择/);
  const onlyProjects=f.ids.filter(id=>f.service.directories.get(id).kind==='project');await assert.rejects(f.service.environment({directoryIds:onlyProjects}),/至少选择/);
});

test('separate project contexts never merge unrelated model, gateway or MCP configuration',async t=>{
  const f=await setup(t),other=path.join(f.home,'other-project');await fs.mkdir(path.join(other,'.claude'),{recursive:true});await fs.writeFile(path.join(other,'.claude/settings.json'),JSON.stringify({model:'claude-other-project',env:{ANTHROPIC_BASE_URL:'https://other.example.test/v1'}}));
  const grant=await f.service.addDirectory(other,'project');const result=await f.service.environment({directoryIds:[...f.ids,grant.id]});const cards=result.cards.filter(c=>c.kind==='code');assert.equal(cards.length,2);
  const first=cards.find(c=>c.projectPath.endsWith('/demo-project')),second=cards.find(c=>c.projectPath===other);
  assert(first.model.includes('claude-demo-project'));assert(!JSON.stringify(first).includes('claude-other-project'));
  assert(second.model.includes('claude-other-project'));assert(!second.mcp.includes('demo-project-mcp'));assert(first.mcp.includes('demo-project-mcp'));
});

test('invalid dates and invalid UTF-8 configuration stay unknown without breaking healthy sessions',async t=>{
  const f=await setup(t),file=path.join(f.profile,'claude-code-sessions/demo-account/demo-org/local_33333333-3333-4333-8333-333333333333.json');
  const data=JSON.parse(await fs.readFile(file));data.lastActivityAt=1e100;await fs.writeFile(file,JSON.stringify(data));
  await f.service.libraryScan({directoryIds:f.ids});const rows=(await f.service.libraryPage({})).rows;assert.equal(rows.length,4);assert.equal(rows.find(r=>r.title.startsWith('只有索引')).lastActivity,null);
  await fs.writeFile(path.join(f.home,'.claude/settings.json'),Buffer.from([0xff,0x0a]));const overview=await f.service.environment({directoryIds:f.ids});assert(overview.issues.length);assert(overview.cards.some(c=>c.kind==='desktop'));
});

test('native save destination contract supports external Unicode paths without modifying source or overwriting existing output',async t=>{
  const f=await setup(t),before=await fingerprint(f.source);await f.service.libraryScan({directoryIds:f.ids});const row=(await f.service.libraryPage({query:'分叉'})).rows[0];
  const parent=path.join(f.root,'独立保存位置 with spaces');await fs.mkdir(parent);await fs.writeFile(path.join(parent,'existing.txt'),'KEEP');
  const ticket=await f.service.libraryPrepare({ids:[row.id],kind:'backup'}),saved=await f.service.library.save(ticket.id,parent);
  assert.equal(path.dirname(saved.path),parent);assert.equal(await fs.readFile(path.join(parent,'existing.txt'),'utf8'),'KEEP');assert.equal((await fs.stat(saved.path)).mode&0o777,0o700);assert.deepEqual(await fingerprint(f.source),before);
});
