// Synthetic data only; called by resource.test.mjs. Never opens real Claude data.
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanTranscript } from '../lib/transcripts.mjs';
const dir=process.argv[2],mib=Number(process.argv[3]);
if(!dir||!Number.isFinite(mib)||mib>256)throw Error('Explicit fixture directory and size required');
const line=Buffer.from(JSON.stringify({type:'assistant',uuid:'fixture',message:{content:[{type:'thinking',thinking:'t'.repeat(16*1024),signature:'synthetic'},{type:'text',text:'v'.repeat(16*1024)}]}})+'\n');
const file=path.join(dir,'input.jsonl');const h=await fs.open(file,'wx',0o600);const count=Math.ceil(mib*1024*1024/line.length);
try{for(let i=0;i<count;i++)await h.write(line);await h.sync();}finally{await h.close();}
const started=performance.now();const result=await scanTranscript(file,{output:path.join(dir,'output.jsonl'),document:path.join(dir,'handoff.md')});const verify=await scanTranscript(path.join(dir,'output.jsonl'));
if(verify.thinkingBlocks!==0||verify.semanticSha256!==result.semanticSha256)throw Error('Resource test semantic mismatch');
console.log(JSON.stringify({inputBytes:result.bytes,outputBytes:result.outputBytes,documentsBytes:result.documentBytes,removed:result.thinkingBlocks,maxRSSKiB:process.resourceUsage().maxRSS,elapsedMs:Math.round(performance.now()-started),semanticVerified:true}));
