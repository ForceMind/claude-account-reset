import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPlan,savePlan,loadPlan,planDigest } from '../lib/planner.mjs';
import { executePlan,inspectBackup,buildRestorePlan,executeRestore } from '../lib/engine.mjs';
import { inventory,readJSON,equal } from '../lib/safety.mjs';
import { validateProcessTable,isClaudeCommand } from '../lib/platform.mjs';
import { parseCLI } from '../lib/cli.mjs';
import { fixture,id,jsonl,thoughts } from './helpers/fixture.mjs';

test('CLI requires saved plan and refuses execution flag overrides or old blind apply',()=>{
 assert.throws(()=>parseCLI('reset',['--apply','--yes']),/reviewed saved plan/);assert.throws(()=>parseCLI('reset',['--plan','p.json','--yes']),/requires --apply/);
 assert.throws(()=>parseCLI('reset',['--execute','p.json']),/--yes/);
 assert.throws(()=>parseCLI('handoff',['--execute','p.json','--yes','--session',id]),/frozen/);
 assert.deepEqual(parseCLI('reset',['--apply','--plan','p.json','--yes']),{execute:'p.json',report:undefined});
 assert.throws(()=>parseCLI('handoff',['--desktop-only']),/only to reset/);
});
test('saved plan is private, contains no credential values, and rehashed path injection fails',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.home,'.claude.json'),'{"oauthAccount":{"token":"PRIVATE_CREDENTIAL"},"projects":{"keep":true}}');
 const p=await f.plan('reset');assert.ok(!JSON.stringify(p).includes('PRIVATE_CREDENTIAL'));const out=path.join(f.home,'plan.json');await savePlan(p,out);assert.equal((await fs.stat(out)).mode&0o777,0o600);assert.equal((await loadPlan(out)).digest,p.digest);
 const unrelated=path.join(f.home,'KEEP');await fs.writeFile(unrelated,'keep');p.actions[0].path=unrelated;p.digest=planDigest(p);
 await assert.rejects(executePlan(p,f.ctx),/expired|modified/i);assert.equal(await fs.readFile(unrelated,'utf8'),'keep');
});
test('new or modified sessions expire an execution plan before permanent writes',async t=>{
 const f=await fixture(t),s=await f.add(),p=await f.plan('recover');await f.add('77777777-7777-4777-8777-777777777777');
 await assert.rejects(executePlan(p,f.ctx),/expired/);await assert.rejects(fs.stat(f.options.backupParent),{code:'ENOENT'});assert.equal(await fs.readFile(s.file,'utf8'),jsonl());
});
test('insufficient disk space and corrupt backup prevent every source mutation',async t=>{
 const f=await fixture(t);const p=await f.plan('reset');const before=await inventory(f.profile);
 await assert.rejects(executePlan(p,{...f.ctx,statfs:async()=>({bavail:0,bsize:4096})}),/Insufficient space/);assert.ok(equal(before,await inventory(f.profile)));
 await assert.rejects(executePlan(p,{...f.ctx,afterBackupCopy:({entry,batch})=>fs.writeFile(path.join(batch,'payload',entry.backup),'corrupt')}),/Backup verification/);assert.ok(equal(before,await inventory(f.profile)));
 const journal=await readJSON(path.join(f.options.backupParent,'run-'+p.id,'journal.json'));assert.equal(journal.status,'partial-or-stopped');assert.equal(journal.checks.backupsVerified,false);
});
test('explicit keychain choice is frozen, unavailable differs from absence, ordinary reset preserves it',async t=>{
 const f=await fixture(t);let calls=0;const ctx={...f.ctx,keychainState:()=> 'present',deleteKeychain:()=>{calls++;return 'deleted';}};
 const p=await buildPlan('reset',f.options,ctx);await executePlan(p,ctx);assert.equal(calls,0);
 const p2=await buildPlan('reset',{...f.options,includeKeychain:true},ctx);await executePlan(p2,ctx);assert.equal(calls,1);
 await assert.rejects(buildPlan('reset',{...f.options,includeKeychain:true},{...f.ctx,keychainState:()=> 'unavailable'}),/unavailable/);
 const audit=await buildPlan('reset',f.options,{...f.ctx,keychainState:()=> 'unavailable'});assert.equal(audit.identity.keychain.safeStorage,'unavailable');
});
test('custom Code directories are explicit; desktop-only does not touch default Code credentials',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.code,'.credentials.json'),'fixture');
 const p=await f.plan('reset',{codeDirs:[]});assert.ok(!p.actions.some(a=>a.path===path.join(f.code,'.credentials.json')));
 const custom=path.join(f.home,'.claude-work');await fs.mkdir(custom);await fs.writeFile(path.join(custom,'.credentials.json'),'custom');
 const p2=await buildPlan('reset',{...f.options,codeDirs:[custom]},{...f.ctx,environment:{CLAUDE_CONFIG_DIR:custom}});assert.ok(p2.actions.some(a=>a.path===path.join(custom,'.credentials.json')));assert.ok(!p2.actions.some(a=>a.path===path.join(f.code,'.credentials.json')));assert.ok(p2.warnings.some(w=>w.includes('CLAUDE_CONFIG_DIR')));
});
test('identity fields and device files require explicit choice; machineID always preserved',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.home,'.claude.json'),'{"userID":"id","machineID":"machine"}');await fs.writeFile(path.join(f.profile,'ant-did'),'device');await fs.writeFile(path.join(f.profile,'ant-device-registry.json'),'{"account":"mapping"}');
 const normal=await f.plan('reset');assert.ok(!normal.actions.some(a=>a.path===path.join(f.home,'.claude.json')));assert.ok(!normal.actions.some(a=>a.path?.endsWith('ant-did')));
 await f.run('reset',{identityRecords:true});assert.deepEqual(await readJSON(path.join(f.home,'.claude.json')),{machineID:'machine'});assert.deepEqual(await readJSON(path.join(f.profile,'ant-device-registry.json')),{});
});
test('process guard covers Desktop, CLI aliases, caller ancestors and unknown parent state',()=>{
 assert.ok(isClaudeCommand('/x/Claude.app/Contents/MacOS/Claude'));assert.ok(isClaudeCommand('/bin/claude-code'));assert.ok(isClaudeCommand('/x/claude'));assert.ok(isClaudeCommand('/Users/example/.local/share/claude/versions/2.1.309'));assert.ok(!isClaudeCommand('/x/claude-account-reset'));
 assert.throws(()=>validateProcessTable('10 1 /bin/claude-code\n11 10 /bin/node',10),/running/);
 assert.throws(()=>validateProcessTable('11 10 /bin/node',10),/ancestry/);
 assert.doesNotThrow(()=>validateProcessTable('10 1 /bin/zsh\n11 10 /bin/node',10));
});
test('backup inspection and reviewed restore recover credentials only when current state matches',async t=>{
 const f=await fixture(t);const file=path.join(f.profile,'config.json'),original=await fs.readFile(file,'utf8');const result=await f.run('reset');const audit=await inspectBackup(result.backupDirectory,f.ctx);assert.equal(audit.entries[0].state,'restorable');
 const p=await buildRestorePlan(result.backupDirectory,[],f.ctx);const restored=await executeRestore(p,f.ctx);assert.equal(restored.restored,1);assert.equal(await fs.readFile(file,'utf8'),original);assert.ok(restored.currentStateBackup);
});
test('restore refuses newer data, corrupted backup and path traversal without overwriting anything',async t=>{
 const f=await fixture(t);const r=await f.run('reset');const p=await buildRestorePlan(r.backupDirectory,[],f.ctx);const file=path.join(f.profile,'config.json');await fs.writeFile(file,'{"new":"data"}');await assert.rejects(executeRestore(p,f.ctx),/conflicts/);assert.equal(await fs.readFile(file,'utf8'),'{"new":"data"}');
 const j=await readJSON(path.join(r.backupDirectory,'journal.json'));const entry=j.entries[0];await fs.writeFile(path.join(r.backupDirectory,'payload',entry.backup),'corrupt');await assert.rejects(inspectBackup(r.backupDirectory,f.ctx),/verification/);
});
test('restore of a created index removes only that unchanged generated index',async t=>{
 const f=await fixture(t);const s=await f.add();const r=await f.run('recover');const p=await buildRestorePlan(r.backupDirectory,[],f.ctx);await executeRestore(p,f.ctx);assert.deepEqual(await fs.readdir(f.dest),[]);assert.equal(await fs.readFile(s.file,'utf8'),jsonl());
});
test('restore of a LevelDB directory verifies original records and permissions',async t=>{
 const {ClassicLevel}=await import('classic-level');const f=await fixture(t),dir=path.join(f.profile,'Local Storage/leveldb');
 const db=new ClassicLevel(dir);await db.open();await db.put('_https://claude.ai\0\x01lastLoginMethod','fixture');await db.put('_https://claude.ai\0\x01draft','keep');await db.close();const original=await inventory(dir);
 const result=await f.run('reset');const inspection=await inspectBackup(result.backupDirectory,f.ctx);const entry=inspection.entries.find(e=>e.kind==='leveldb');const p=await buildRestorePlan(result.backupDirectory,[entry.id],f.ctx);await executeRestore(p,f.ctx);assert.ok(equal(await inventory(dir),original));
});
test('backup payload path tampering is refused even if current target is untouched',async t=>{
 const f=await fixture(t);const r=await f.run('reset');const journalPath=path.join(r.backupDirectory,'journal.json');const j=await readJSON(journalPath);j.entries[0].backup='../../outside';await fs.writeFile(journalPath,JSON.stringify(j));await assert.rejects(inspectBackup(r.backupDirectory,f.ctx),/Invalid backup payload/);
});
test('credential source audit includes helper and env names but never their values',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.code,'settings.json'),JSON.stringify({apiKeyHelper:'PRIVATE_HELPER',env:{ANTHROPIC_AUTH_TOKEN:'PRIVATE_TOKEN',ANTHROPIC_BASE_URL:'PRIVATE_URL'}}));
 const p=await f.plan('reset');assert.ok(!JSON.stringify(p).includes('PRIVATE_'));assert.equal(p.identity.credentialSources[0].apiKeyHelperConfigured,true);assert.ok(p.identity.credentialSources[0].environmentVariableNames.includes('ANTHROPIC_AUTH_TOKEN'));assert.ok(!p.actions.some(a=>a.path?.endsWith('settings.json')));
});
