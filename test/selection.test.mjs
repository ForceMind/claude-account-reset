import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { savePlan,validateDate,protectedByDate } from '../lib/planner.mjs';
import { executePlan } from '../lib/engine.mjs';
import { fixture,id,jsonl,thoughts } from './helpers/fixture.mjs';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('date protection uses explicit timezone, includes unknown dates, and rejects invalid dates',()=>{
 assert.throws(()=>validateDate('2026-02-30','Asia/Shanghai'),/Invalid/);assert.throws(()=>validateDate('2026-11-02',null),/time-zone/);
 assert.equal(protectedByDate({lastUserAt:'2026-11-01T16:01:00Z',unknownUserTime:false},'2026-11-02','Asia/Shanghai'),true);
 assert.equal(protectedByDate({lastUserAt:'2026-11-01T15:59:00Z',unknownUserTime:false},'2026-11-02','Asia/Shanghai'),false);
 assert.equal(protectedByDate({lastUserAt:null,unknownUserTime:true},'2026-11-02','Asia/Shanghai'),true);
});
test('prefix snapshots are classified, independently sanitized, and longest history produces the document',async t=>{
 const f=await fixture(t),s=await f.add(id,{body:thoughts});const extra=path.join(f.code,'projects/snapshot');await fs.mkdir(extra);const shorter=jsonl();await fs.writeFile(path.join(extra,id+'.jsonl'),shorter);
 const p=await f.plan('handoff');assert.equal(p.selection[0].classification,'prefix-snapshots');assert.equal(p.selection[0].canonical,s.file);await executePlan(p,f.ctx);assert.equal(await fs.readFile(path.join(extra,id+'.jsonl'),'utf8'),shorter);assert.ok(!(await fs.readFile(s.file,'utf8')).includes('PRIVATE_'));
});
test('identical copies are distinct files but one logical selection; divergence never gets merged',async t=>{
 const f=await fixture(t);await f.add();const extra=path.join(f.code,'projects/copy');await fs.mkdir(extra);const file=path.join(extra,id+'.jsonl');await fs.writeFile(file,jsonl());assert.equal((await f.plan('recover')).selection[0].classification,'identical');await fs.writeFile(file,jsonl('different'));const p=await f.plan('handoff');assert.equal(p.selection[0].reason,'divergent-copies');assert.equal(p.actions.length,0);
});
test('Desktop-to-new-CLI continuation is protected until an explicit CLI ID is selected',async t=>{
 const f=await fixture(t);await f.add();const next=uuid(999);await f.add(next,{desktop:id,source:f.dest,body:jsonl('new continuation')});
 const p=await f.plan('handoff');assert.match(p.selection[0].reason,/cli-id-changed/);assert.equal(p.actions.length,0);
 const chosen=await f.plan('handoff',{include:[next]});assert.equal(chosen.selection[0].selectedCli,next);assert.equal(chosen.selection[0].status,'selected');assert.ok(!chosen.actions.some(a=>a.path?.endsWith('/'+id+'.jsonl')));
});
test('50-session baseline protects recent, changed, explicitly excluded and newly created sessions',async t=>{
 const f=await fixture(t);const old=[];
 for(let n=1;n<=50;n++)old.push(await f.add(uuid(n),{body:thoughts}));
 const baseline=await f.plan('handoff');const baseFile=path.join(f.home,'baseline.plan.json');await savePlan(baseline,baseFile);
 const recent=thoughts+jsonl('today','2026-11-02T00:00:00Z');await fs.writeFile(old[0].file,recent);
 const changed=thoughts+jsonl('changed earlier','2026-10-25T00:00:00Z');await fs.writeFile(old[1].file,changed);
 const added=await f.add(uuid(51),{body:thoughts});
 const p=await f.plan('handoff',{baseline:baseFile,protectSince:'2026-11-02',timeZone:'Asia/Shanghai',exclude:[old[2].record.sessionId]});
 assert.equal(p.selection.filter(r=>r.status==='selected').length,47);
 assert.equal(p.selection.find(r=>r.sessionId===old[0].record.sessionId).reason,'recent-or-unknown-user-activity');
 assert.equal(p.selection.find(r=>r.sessionId===old[1].record.sessionId).reason,'transcript-changed-since-baseline');
 assert.equal(p.selection.find(r=>r.sessionId===added.record.sessionId).reason,'new-since-baseline');
 await executePlan(p,f.ctx);
 assert.equal(await fs.readFile(old[0].file,'utf8'),recent);assert.equal(await fs.readFile(old[1].file,'utf8'),changed);assert.equal(await fs.readFile(old[2].file,'utf8'),thoughts);assert.equal(await fs.readFile(added.file,'utf8'),thoughts);
 assert.equal((await fs.readdir(f.dest)).length,47);
});
test('baseline protects index-only changes even when transcript bytes did not change',async t=>{
 const f=await fixture(t),s=await f.add();const p=await f.plan('recover');const file=path.join(f.home,'baseline.plan.json');await savePlan(p,file);await fs.writeFile(s.index,JSON.stringify({...s.record,title:'changed title'}));const next=await f.plan('recover',{baseline:file});assert.equal(next.selection[0].reason,'index-changed-since-baseline');assert.equal(next.actions.length,0);
});
