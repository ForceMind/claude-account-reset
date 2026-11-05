import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {safe} from '../lib/safety.mjs';

export async function stamp(file) {
  await safe(file); const s=await fs.stat(file);
  if(!s.isFile())throw Error('Expected regular source file');
  return {size:s.size,ino:s.ino,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs};
}
export function sameStamp(a,b){return JSON.stringify(a)===JSON.stringify(b);}
export async function unchanged(file,before){if(!sameStamp(before,await stamp(file)))throw Error('资料读取期间发生变化，请刷新后重试。');}
export async function jsonFile(file,max=2*1024*1024){
  const before=await stamp(file);if(before.size>max)throw Error('配置或索引过大，未读取内容。');
  let d;try{d=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(file)));}catch{throw Error('配置或索引格式无法识别，原件保留。');}
  await unchanged(file,before);
  if(!d||typeof d!=='object'||Array.isArray(d))throw Error('配置或索引格式无法识别，原件保留。');
  return {data:d,before};
}
export async function digest(file,check=()=>{}){
  const before=await stamp(file),h=createHash('sha256');
  for await(const chunk of createReadStream(file)){check();h.update(chunk);}
  await unchanged(file,before);return {before,sha256:h.digest('hex'),bytes:before.size};
}
export const shortText=(value,limit=160)=>typeof value==='string'?value.slice(0,limit):'';
