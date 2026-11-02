import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { recoveredRecord } from '../lib/recovery.mjs';
import { inventory,readJSON,equal } from '../lib/safety.mjs';
import { executePlan } from '../lib/engine.mjs';
import { fixture,id,org,account,jsonl,thoughts } from './helpers/fixture.mjs';
test('recovery keeps local fields, removes remote authorization and uses manual permission',()=>{
 const r=recoveredRecord({sessionId:'local_'+id,cwd:'/fixture',title:'keep',remoteMcpServersConfig:{token:'secret'},bridgeSessionIds:['old'],permissionMode:'bypassPermissions'});assert.equal(r.permissionMode,'default');assert.equal(r.remoteControlUserEnabled,false);assert.equal(r.title,'keep');assert.ok(!('remoteMcpServersConfig'in r));assert.ok(!('bridgeSessionIds'in r));assert.throws(()=>recoveredRecord({sessionId:'../../escape',cwd:'/fixture'}));
});
test('preview is write-free, recovery verifies backups and reruns without duplicate indices',async t=>{
 const f=await fixture(t),s=await f.add(id,{isArchived:true}),before=await inventory(f.home);const audit=await f.plan('recover');assert.ok(equal(before,await inventory(f.home)));assert.equal(audit.actions.length,1);const r=await executePlan(audit,f.ctx);assert.equal(r.protectedDataVerified,true);assert.equal(r.selectedSessions,1);const target=path.join(f.dest,s.record.sessionId+'.json');assert.deepEqual(await readJSON(target),recoveredRecord(s.record));assert.equal((await fs.stat(target)).mode&0o777,0o600);assert.equal((await fs.stat(r.backupDirectory)).mode&0o777,0o700);assert.equal((await f.plan('recover')).actions.length,0);
});
test('missing, divergent, empty and malformed transcripts do not manufacture history',async t=>{
 const f=await fixture(t),s=await f.add();await fs.unlink(s.file);assert.equal((await f.plan('recover')).selection[0].reason,'missing-transcript');await fs.writeFile(s.file,'');assert.equal((await f.plan('recover')).selection[0].reason,'empty-transcript');await fs.writeFile(s.file,'{broken');assert.equal((await f.plan('recover')).selection[0].reason,'unreadable-or-unsupported-transcript');await fs.writeFile(s.file,jsonl('A'));const another=path.join(f.code,'projects/another');await fs.mkdir(another);await fs.writeFile(path.join(another,id+'.jsonl'),jsonl('B'));assert.equal((await f.plan('recover')).selection[0].reason,'divergent-copies');
});
test('missing work directory is explicit; archived flag retained; ambiguous org needs choice',async t=>{
 const f=await fixture(t);await f.add(id,{cwd:path.join(f.home,'missing'),isArchived:true});let p=await f.plan('recover');assert.equal(p.selection[0].cwdExists,false);assert.equal(p.selection[0].archived,true);await fs.mkdir(path.join(path.dirname(f.dest),'55555555-5555-4555-8555-555555555555'));await assert.rejects(f.plan('recover'),/ambiguous/);assert.equal((await f.plan('recover',{org})).actions.length,1);
});
test('concurrent index collision is preserved and failure journal records partial progress',async t=>{
 const f=await fixture(t),s=await f.add();const p=await f.plan('recover');const dest=path.join(f.dest,s.record.sessionId+'.json');await assert.rejects(executePlan(p,{...f.ctx,beforeAction:()=>fs.writeFile(dest,'competing')}),/stopped/);assert.equal(await fs.readFile(dest,'utf8'),'competing');const journal=await readJSON(path.join(f.options.backupParent,'run-'+p.id,'journal.json'));assert.equal(journal.status,'partial-or-stopped');assert.equal(journal.entries[0].status,'writing');
});
test('account change and unsafe backup destination stop recovery',async t=>{
 const f=await fixture(t);await f.add();await assert.rejects(f.plan('recover',{backupParent:path.join(f.profile,'backup')}),/outside Claude/);const p=await f.plan('recover');await assert.rejects(executePlan(p,{...f.ctx,beforeWrite:()=>fs.writeFile(path.join(f.profile,'config.json'),JSON.stringify({lastKnownAccountUuid:org}))}),/stopped/);assert.deepEqual(await fs.readdir(f.dest),[]);
});
test('thinking statistics expose counts, not content; index-only recovery never rewrites it',async t=>{
 const f=await fixture(t),s=await f.add(id,{body:thoughts});const p=await f.plan('recover');assert.equal(p.selection[0].copies[0].stats.thinkingBlocks,2);assert.ok(!JSON.stringify(p).includes('PRIVATE_'));await executePlan(p,f.ctx);assert.equal(await fs.readFile(s.file,'utf8'),thoughts);assert.equal((await f.plan('recover')).selection[0].copies[0].stats.thinkingBlocks,2);
});
test('late failure retains completed indices and backups instead of overwriting competing data',async t=>{
 const f=await fixture(t);await f.add();const second='66666666-6666-4666-8666-666666666666';await f.add(second);const p=await f.plan('recover');await assert.rejects(executePlan(p,{...f.ctx,beforeAction:async e=>{if(e.path.endsWith(second+'.json'))await fs.writeFile(e.path,'competing');}}),/stopped/);assert.equal((await fs.readdir(f.dest)).length,2);assert.equal(await fs.readFile(path.join(f.dest,'local_'+second+'.json'),'utf8'),'competing');const j=await readJSON(path.join(f.options.backupParent,'run-'+p.id,'journal.json'));assert.equal(j.entries[0].status,'complete');assert.equal(j.status,'partial-or-stopped');
});
