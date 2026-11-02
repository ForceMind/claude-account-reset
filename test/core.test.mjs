import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ClassicLevel } from 'classic-level';
import { stripConfig, localStorage, shouldDeleteLocal } from '../lib/core.mjs';
import { snapshot, assertSame } from '../lib/core.mjs';
import { safe,inventory,readJSON } from '../lib/safety.mjs';
import { fixture } from './helpers/fixture.mjs';
const key=(name,origin='https://claude.ai')=>Buffer.from(`_${origin}\0\x01${name}`);
test('account rules preserve installation IDs, projects, MCP and unknown keys by default',()=>{
 const d={oauthAccount:{token:'fixture'},accountUuid:'account',userID:'installation',machineID:'machine',projects:{keep:true},mcpServers:{keep:{}},unknown:1,cachedGrowthBookFeatures:{}};
 const clean=stripConfig(d,false).result;assert.ok(!('oauthAccount'in clean));assert.ok(!('accountUuid'in clean));assert.equal(clean.userID,'installation');assert.equal(clean.machineID,'machine');assert.deepEqual(clean.projects,d.projects);assert.deepEqual(clean.mcpServers,d.mcpServers);assert.equal(clean.unknown,1);assert.ok('cachedGrowthBookFeatures'in clean);
 assert.ok(!('userID'in stripConfig(d,true,true).result));assert.equal(stripConfig(d,true,true).result.machineID,'machine');
});
test('Local Storage allowlist is origin-specific and preserves sessions/drafts/unknown keys',()=>{
 assert.ok(shouldDeleteLocal(key('ccd-sync-owner'),false));for(const k of ['ccd-session-store','chat-draft-123','unknown-token-format'])assert.ok(!shouldDeleteLocal(key(k),true));assert.ok(!shouldDeleteLocal(key('lastLoginMethod','https://example.com'),true));assert.ok(!shouldDeleteLocal(key('antalytics_queue_v1'),false));
 const utf=Buffer.concat([Buffer.from('_app://localhost\0\0'),Buffer.from('__qk_hint_account_uuid','utf16le')]);assert.ok(shouldDeleteLocal(utf,false));
});
test('read-only database audit leaves bytes unchanged; executed plan verifies backup and retained values',async t=>{
 const f=await fixture(t),dir=path.join(f.profile,'Local Storage/leveldb');const db=new ClassicLevel(dir,{keyEncoding:'buffer',valueEncoding:'buffer'});await db.open();const draft=Buffer.from([0,1,255,7]);await db.put(key('chat-draft-123'),draft);await db.put(key('ccd-session-store'),Buffer.from('keep'));await db.put(key('rq-cache-confirmed-account'),Buffer.from('account'));await db.close();
 const before=await snapshot([dir]);await localStorage(dir);assertSame(before,await snapshot([dir]));
 const result=await f.run('reset');assert.equal(result.protectedDataVerified,true);const j=await readJSON(path.join(result.backupDirectory,'journal.json'));assert.equal(j.checks.backupsVerified,true);
 const check=new ClassicLevel(dir,{keyEncoding:'buffer',valueEncoding:'buffer'});await check.open();assert.deepEqual(await check.get(key('chat-draft-123')),draft);assert.equal((await check.get(key('ccd-session-store'))).toString(),'keep');assert.equal(await check.get(key('rq-cache-confirmed-account')),undefined);await check.close();
});
test('reset sanitizes configuration backups and journal while retaining real history and mode',async t=>{
 const f=await fixture(t),s=await f.add();await fs.writeFile(path.join(f.profile,'config.json.journal'),'fixture');const backup=path.join(f.code,'backups/.claude.json.backup.1');await fs.mkdir(path.dirname(backup));await fs.writeFile(backup,'{"oauthAccount":{},"projects":{"keep":true}}',{mode:0o600});
 const before=await fs.readFile(s.file);const audit=await f.plan('reset');assert.equal(JSON.parse(await fs.readFile(path.join(f.profile,'config.json'))).lastKnownAccountUuid.length,36);
 const r=await f.run('reset');assert.equal(r.protectedDataVerified,true);assert.deepEqual(await fs.readFile(s.file),before);assert.deepEqual(await readJSON(backup),{projects:{keep:true}});assert.equal((await fs.stat(backup)).mode&0o777,0o600);assert.equal((await f.plan('reset')).actions.length,0);assert.ok(audit.actions.length>0);
});
test('malformed config, process failure and symlinks stop before source writes',async t=>{
 const f=await fixture(t);const config=path.join(f.profile,'config.json');await fs.writeFile(config,'{PRIVATE_BROKEN');await assert.rejects(f.plan('reset'),/Unreadable JSON/);assert.equal(await fs.readFile(config,'utf8'),'{PRIVATE_BROKEN');await fs.symlink(f.profile,path.join(f.home,'link'));await assert.rejects(safe(path.join(f.home,'link')),/Symlink/);
});
test('inspection temp database is removed on open failure',async t=>{
 const f=await fixture(t),dir=path.join(f.profile,'Local Storage/leveldb');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'CURRENT'),'missing-manifest\n');const tempRoot=path.join(f.home,'temp');await fs.mkdir(tempRoot);const before=await fs.readdir(tempRoot);await assert.rejects(localStorage(dir,{tempRoot}));assert.deepEqual(await fs.readdir(tempRoot),before);
});
