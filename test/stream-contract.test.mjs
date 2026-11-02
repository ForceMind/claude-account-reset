import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanTranscript } from '../lib/transcripts.mjs';
test('production streaming output preserves an independently specified visible transcript exactly',async t=>{
 const dir=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'stream-contract-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const user={type:'user',uuid:'u',timestamp:'2026-10-20T00:00:00Z',custom:{keep:['x',1]},message:{role:'user',content:'Original visible request'}};
 const assistant={type:'assistant',uuid:'a',parentUuid:'u',model:'fixture',extra:{keep:true},message:{role:'assistant',content:[{type:'thinking',thinking:'PRIVATE',signature:'SIGNATURE'},{type:'text',text:'Original answer'},{type:'tool_use',id:'tool1',name:'read',input:{keep:[1,2]}}]}};
 const result={type:'user',uuid:'r',parentUuid:'a',timestamp:'2026-10-20T00:01:00Z',message:{content:[{type:'tool_result',tool_use_id:'tool1',is_error:false,content:'Original tool output'}]}};
 const input=path.join(dir,'in.jsonl'),output=path.join(dir,'out.jsonl');await fs.writeFile(input,[user,assistant,result].map(x=>JSON.stringify(x)).join('\n')+'\n');await scanTranscript(input,{output});
 const rows=(await fs.readFile(output,'utf8')).trim().split('\n').map(JSON.parse);
 assert.deepEqual(rows,[user,{type:'assistant',uuid:'a',parentUuid:'u',model:'fixture',extra:{keep:true},message:{role:'assistant',content:[{type:'text',text:'Original answer'},{type:'tool_use',id:'tool1',name:'read',input:{keep:[1,2]}}]}},result]);
 const untouched='  {"type":"system","unknown":"preserve spacing"}  \r\n';await fs.writeFile(input,untouched);await fs.unlink(output);await scanTranscript(input,{output});assert.equal(await fs.readFile(output,'utf8'),untouched);
});
test('production streaming parser rejects invalid UTF-8 without silently substituting visible text',async t=>{
 const dir=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'stream-invalid-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const input=path.join(dir,'input.jsonl');const invalid=Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xff,0x22,0x7d]);await fs.writeFile(input,invalid);await assert.rejects(scanTranscript(input),/Invalid UTF-8/);assert.deepEqual(await fs.readFile(input),invalid);
});
