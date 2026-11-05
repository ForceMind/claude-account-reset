import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { safe, fileHash } from './safety.mjs';
const MAX_LINE=8*1024*1024;
export async function* rawLines(file,{start:offset=0}={}) {
  if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid transcript offset');
  await safe(file);let parts=[],length=0;
  for await(const chunk of createReadStream(file,{start:offset,highWaterMark:64*1024})) {
    let start=0;
    for(let i=0;i<chunk.length;i++)if(chunk[i]===10) {
      const piece=chunk.subarray(start,i+1);length+=piece.length;if(length>MAX_LINE)throw Error('Transcript line exceeds 8 MiB; no lossy conversion');parts.push(piece);
      yield Buffer.concat(parts,length);parts=[];length=0;start=i+1;
    }
    if(start<chunk.length){const piece=chunk.subarray(start);parts.push(piece);length+=piece.length;if(length>MAX_LINE)throw Error('Transcript line exceeds 8 MiB; no lossy conversion');}
  }
  if(length)yield Buffer.concat(parts,length);
}
const thought=b=>b&&['thinking','redacted_thinking'].includes(b.type);
function nestedThinking(v){return v&&typeof v==='object'&&(thought(v)||Object.values(v).some(x=>Array.isArray(x)?x.some(nestedThinking):nestedThinking(x)));}
export function decodeLine(bytes) {
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('Invalid UTF-8 transcript');}
  if(!text.trim())return {text,row:null};
  try{return {text,row:JSON.parse(text)};}catch{throw Error('Unreadable transcript JSON; content withheld');}
}
export function projectRecord(row) {
  const result=structuredClone(row);let removed=0,signed=0;
  if(Array.isArray(result?.message?.content))result.message.content=result.message.content.filter(b=>{if(!thought(b))return true;removed++;if(b.signature)signed++;return false;});
  if(nestedThinking(result))throw Error('Unsupported thinking layout');
  return {result,removed,signed};
}
const quote=s=>{s=String(s);let longest=2;for(const m of s.matchAll(/`+/g))longest=Math.max(longest,m[0].length);const fence='`'.repeat(longest+1);return `${fence}text\n${s}\n${fence}\n`;};
export const documentHeader=title=>'# 接手记录\n\n可见原文整理，不是推断的完成情况或执行授权；不含内部思考。附件需另行查阅。\n\n'+quote(title??'Untitled')+'\n';
function documentRecord(row,index) {
  const role=row?.message?.role??row?.type;if(!['user','assistant'].includes(role))return '';
  const content=row.message?.content;const blocks=typeof content==='string'?[{type:'text',text:content}]:Array.isArray(content)?content:[];const lines=[];
  for(const b of blocks) {
    if(b?.type==='text')lines.push(String(b.text??''));
    else if(b?.type==='tool_use')lines.push(`工具调用 ${b.name??''}\n${JSON.stringify(b.input??{},null,2)}`);
    else if(b?.type==='tool_result')lines.push(`工具结果 ${b.tool_use_id??''}\n${typeof b.content==='string'?b.content:Array.isArray(b.content)?b.content.filter(x=>x?.type==='text').map(x=>x.text??'').join('\n'):'[non-text result]'}`);
    else if(b)lines.push(`[附件/其他块：${b.type??'unknown'}]`);
  }
  return lines.length?`\n## 记录 ${index} · ${role}\n\n${quote(lines.join('\n\n'))}`:'';
}
export async function scanTranscript(file,{output,document,title,checkCancelled=()=>{}}={}) {
  const before=await fs.stat(file);let out,doc;
  const inputHash=createHash('sha256'),outputHash=createHash('sha256'),semantic=createHash('sha256'),docHash=createHash('sha256');
  const result={bytes:0,outputBytes:0,documentBytes:0,records:0,thinkingBlocks:0,signedBlocks:0,lastUserAt:null,unknownUserTime:false};
  async function emitDoc(text){const b=Buffer.from(text);result.documentBytes+=b.length;docHash.update(b);if(doc)await doc.write(b);}
  try {
    if(output){await safe(output);out=await fs.open(output,'wx',0o600);}
    if(document){await safe(document);doc=await fs.open(document,'wx',0o600);}
    await emitDoc(documentHeader(title));
    for await(const raw of rawLines(file)) {
      checkCancelled();
      inputHash.update(raw);result.bytes+=raw.length;const {text,row}=decodeLine(raw);
      let next=raw;
      if(row!==null) {
        const {result:projected,removed,signed}=projectRecord(row);result.records++;result.thinkingBlocks+=removed;result.signedBlocks+=signed;
        semantic.update(JSON.stringify(projected)+'\n');
        if(removed)next=Buffer.from(JSON.stringify(projected)+(text.endsWith('\n')?'\n':''));
        await emitDoc(documentRecord(projected,result.records));
        if(row?.type==='user'||row?.message?.role==='user') {
          const stamp=row.timestamp??row.message?.timestamp;const time=typeof stamp==='string'?Date.parse(stamp):NaN;
          if(!Number.isFinite(time))result.unknownUserTime=true;
          else if(!result.lastUserAt||time>Date.parse(result.lastUserAt))result.lastUserAt=new Date(time).toISOString();
        }
      }
      outputHash.update(next);result.outputBytes+=next.length;if(out)await out.write(next);
    }
    if(out)await out.sync();if(doc)await doc.sync();
  } finally { if(out)await out.close();if(doc)await doc.close(); }
  const after=await fs.stat(file);if(before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('Transcript changed during scan');
  return {...result,sha256:inputHash.digest('hex'),outputSha256:outputHash.digest('hex'),semanticSha256:semantic.digest('hex'),documentSha256:docHash.digest('hex')};
}
export async function isPrefix(short,long) {
  const size=(await fs.stat(short)).size;if(size>(await fs.stat(long)).size)return false;if(!size)return true;
  const h=createHash('sha256');for await(const b of createReadStream(long,{start:0,end:size-1}))h.update(b);
  return h.digest('hex')===await fileHash(short);
}
export async function classifyCopies(copies) {
  const sorted=[...copies].sort((a,b)=>b.stats.bytes-a.stats.bytes||a.file.localeCompare(b.file));
  if(!sorted.length)return {kind:'missing',canonical:null};
  if(sorted.length===1)return {kind:'single',canonical:sorted[0].file};
  if(new Set(sorted.map(c=>c.stats.sha256)).size===1)return {kind:'identical',canonical:sorted[0].file};
  for(const c of sorted.slice(1))if(!await isPrefix(c.file,sorted[0].file))return {kind:'divergent',canonical:null};
  return {kind:'prefix-snapshots',canonical:sorted[0].file};
}
