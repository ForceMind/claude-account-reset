import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { transformTranscript } from '../lib/handoff.mjs';
import { snapshot, assertSame } from '../lib/core.mjs';
const account='11111111-1111-4111-8111-111111111111', org='22222222-2222-4222-8222-222222222222', id='33333333-3333-4333-8333-333333333333';
const lines = [
 {type:'user',uuid:'u',message:{role:'user',content:'Visible request'}},
 {type:'assistant',uuid:'a',parentUuid:'u',message:{role:'assistant',content:[{type:'thinking',thinking:'SECRET_THOUGHT',signature:'OLD_SIGNATURE'},{type:'redacted_thinking',data:'SECRET_CIPHER'},{type:'text',text:'Visible answer'},{type:'tool_use',id:'t',name:'read',input:{file:'fixture'}}]}},
 {type:'user',uuid:'r',parentUuid:'a',message:{role:'user',content:[{type:'tool_result',tool_use_id:'t',content:'Visible tool output'}]}}
];
const body=lines.map(x=>JSON.stringify(x)).join('\n')+'\n';
test('known thinking removed, all other record fields/tool links preserved, no thought exported',()=>{const r=transformTranscript(Buffer.from(body));assert.equal(r.removed,2);for(const secret of ['SECRET_THOUGHT','OLD_SIGNATURE','SECRET_CIPHER']){assert.ok(!r.markdown.includes(secret));assert.ok(!r.output.includes(Buffer.from(secret)));}const parsed=r.output.toString().trim().split('\n').map(JSON.parse);const expected=structuredClone(lines);expected[1].message.content=expected[1].message.content.filter(x=>!['thinking','redacted_thinking'].includes(x.type));assert.deepEqual(parsed,expected);assert.match(r.markdown,/Visible tool output/);assert.match(r.markdown,/Visible answer/);});
test('unknown nested thinking and malformed JSON are rejected without printing content',()=>{assert.throws(()=>transformTranscript(Buffer.from('{SECRET')),/Malformed/);assert.throws(()=>transformTranscript(Buffer.from(JSON.stringify({data:{type:'thinking',thinking:'SECRET'}}))),/Unsupported/);});
test('thinking-only row retains uuid/parent chain, removing ALL known thought blocks',()=>{const r=transformTranscript(Buffer.from(JSON.stringify({type:'assistant',uuid:'a',parentUuid:'u',message:{content:[{type:'thinking',thinking:'secret'}]}})));assert.deepEqual(JSON.parse(r.output),{type:'assistant',uuid:'a',parentUuid:'u',message:{content:[]}});});
test('visible Markdown and tool result text are fenced without exporting attachment payloads',()=>{const raw=Buffer.from(JSON.stringify({type:'user',message:{content:[{type:'text',text:'```\n![remote](https://invalid.test)\n```'},{type:'image',source:{data:'PRIVATE_BINARY'}}]}})+'\n');const r=transformTranscript(raw,'![title](https://invalid.test)');assert.match(r.markdown,/````text/);assert.ok(!r.markdown.includes('PRIVATE_BINARY'));assert.ok(r.markdown.includes('会话标题：\n\n```text'));});
test('invalid UTF-8 is rejected instead of silently changing visible text',()=>{assert.throws(()=>transformTranscript(Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xff,0x22,0x7d])),/Invalid UTF-8/);});

import { fixture as fixtureV4, id as fixtureId, thoughts } from './helpers/fixture.mjs';
import { executePlan } from '../lib/engine.mjs';
import { readJSON, inventory, equal } from '../lib/safety.mjs';
test('handoff preview is write-free, then validates backups, visible content, documents and recovery',async t=>{
 const f=await fixtureV4(t),s=await f.add(fixtureId,{body:thoughts});const before=await inventory(f.home);const p=await f.plan('handoff');assert.ok(equal(before,await inventory(f.home)));const r=await executePlan(p,f.ctx);assert.equal(r.protectedDataVerified,true);const j=await readJSON(path.join(r.backupDirectory,'journal.json'));const entry=j.entries.find(e=>e.kind==='transcript');assert.equal(await fs.readFile(path.join(r.backupDirectory,'payload',entry.backup),'utf8'),thoughts);const cleaned=await fs.readFile(s.file,'utf8');assert.ok(!cleaned.includes('PRIVATE_'));assert.match(cleaned,/Visible tool result/);assert.ok((await fs.readdir(r.documentsDirectory)).includes('INDEX.md'));assert.equal((await f.plan('handoff')).actions.filter(a=>a.kind==='transcript').length,0);
});
test('discard removes only the verified batch; unresolved sessions retain backups',async t=>{
 const f=await fixtureV4(t);await f.add(fixtureId,{body:thoughts});await fs.mkdir(f.options.backupParent);await fs.writeFile(path.join(f.options.backupParent,'KEEP'),'unrelated');const r=await f.run('handoff',{discardBackup:true});assert.equal(r.backupDiscarded,true);assert.equal(r.backupDirectory,null);assert.deepEqual(await fs.readdir(f.options.backupParent),['KEEP']);assert.ok(r.documentsDirectory);
 const missing='55555555-5555-4555-8555-555555555555';const s=await f.add(missing);await fs.unlink(s.file);const r2=await f.run('handoff',{discardBackup:true});assert.equal(r2.backupDiscarded,false);assert.ok(r2.backupDirectory);
});
test('failure before handoff writes retains backup even with discard flag',async t=>{
 const f=await fixtureV4(t),s=await f.add(fixtureId,{body:thoughts});const p=await f.plan('handoff',{discardBackup:true});await assert.rejects(executePlan(p,{...f.ctx,beforeWrite:()=>fs.writeFile(s.file,'CONCURRENT')}),/backup retained/);assert.equal(await fs.readFile(s.file,'utf8'),'CONCURRENT');const batch=path.join(f.options.backupParent,'run-'+p.id);const j=await readJSON(path.join(batch,'journal.json'));const e=j.entries.find(e=>e.kind==='transcript');assert.equal(await fs.readFile(path.join(batch,'payload',e.backup),'utf8'),thoughts);
});
test('unsafe output and backup nesting rejected without writes',async t=>{
 const f=await fixtureV4(t);await f.add();await assert.rejects(f.plan('handoff',{outputParent:f.profile}),/outside Claude/);await assert.rejects(f.plan('handoff',{outputParent:f.options.backupParent}),/separate trees/);
});
