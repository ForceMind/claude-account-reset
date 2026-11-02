import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
test('32 MiB and 160 MiB histories stream within a 128 MiB heap with bounded RSS growth',async t=>{
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'claude-resource-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const results=[];
 for(const size of [32,160]){const dir=path.join(root,String(size));await fs.mkdir(dir);const r=await run(process.execPath,['--max-old-space-size=128',new URL('../scripts/benchmark-worker.mjs',import.meta.url).pathname,dir,String(size)],{timeout:90000,maxBuffer:1024*1024});results.push(JSON.parse(r.stdout));}
 assert.ok(results.every(r=>r.semanticVerified&&r.removed>0));assert.ok(results[1].inputBytes>128*1024*1024);assert.ok(results[1].maxRSSKiB-results[0].maxRSSKiB<64*1024,'RSS must not grow with the entire input batch');
 console.log('Synthetic streaming evidence:',JSON.stringify(results));
});
