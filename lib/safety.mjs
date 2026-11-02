import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';

export const VERSION = '0.4.1';
export const sha = x => createHash('sha256').update(x).digest('hex');
export const canonical = x => JSON.stringify(order(x));
function order(x) { return Array.isArray(x) ? x.map(order) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, order(x[k])])) : x; }
export const equal = (a,b) => canonical(a) === canonical(b);
export async function exists(p) { try { await fs.lstat(p); return true; } catch(e) { if(e.code==='ENOENT')return false; throw e; } }
export function within(p, root) { const rel=path.relative(path.resolve(root),path.resolve(p)); return rel===''||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep)); }
export async function safe(p) {
  let cur=path.parse(path.resolve(p)).root;
  for(const part of path.resolve(p).split(path.sep).filter(Boolean)) {
    cur=path.join(cur,part);
    if(await exists(cur)) {
      const s=await fs.lstat(cur);
      if(s.isSymbolicLink())throw Error('Symlink path refused');
      if(!s.isFile()&&!s.isDirectory())throw Error('Unsupported file type');
    }
  }
}
export async function readJSON(p) { await safe(p); if((await fs.stat(p)).size>16*1024*1024)throw Error('JSON file too large'); try{return JSON.parse(await fs.readFile(p,'utf8'));}catch{throw Error('Unreadable JSON; content withheld');} }
export async function fileHash(p) {
  await safe(p); const before=await fs.stat(p); const h=createHash('sha256');
  for await(const b of createReadStream(p))h.update(b);
  const after=await fs.stat(p);
  if(before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('File changed while reading');
  return h.digest('hex');
}
export async function inventory(root) {
  await safe(root); if(!await exists(root))return {'.':{type:'absent'}};
  const tree={};
  async function walk(p,relative) {
    const s=await fs.lstat(p);
    if(s.isSymbolicLink()||(!s.isDirectory()&&!s.isFile()))throw Error('Unsupported entry in data tree');
    tree[relative]=s.isDirectory()?{type:'directory',mode:s.mode&0o777}:{type:'file',mode:s.mode&0o777,size:s.size,sha256:await fileHash(p)};
    if(s.isDirectory())for(const n of (await fs.readdir(p)).sort())await walk(path.join(p,n),relative==='.'?n:path.join(relative,n));
  }
  await walk(root,'.'); return tree;
}
export function contentTree(tree) { return Object.fromEntries(Object.entries(tree).map(([k,{mode,...v}])=>[k,v])); }
export async function fingerprint(roots) {
  const result={};
  for(const p of [...new Set(roots.map(p=>path.resolve(p)))].sort())result[p]=await inventory(p);
  return result;
}
export function bytes(tree) { return Object.values(tree).reduce((n,e)=>n+(e.size??0),0); }
export async function privateCopy(source,destination) {
  await safe(source); await safe(destination);
  const stat=await fs.lstat(source);
  if(stat.isDirectory()) { await fs.mkdir(destination,{mode:0o700}); for(const n of (await fs.readdir(source)).sort())await privateCopy(path.join(source,n),path.join(destination,n)); }
  else if(stat.isFile()) { await fs.copyFile(source,destination,1); await fs.chmod(destination,0o600); }
  else throw Error('Unsupported backup source');
}
export async function writeNew(p,bytes,mode=0o600) {
  await safe(p); const h=await fs.open(p,'wx',mode); try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
}
export async function atomicJSON(p,value) {
  await safe(p); const temp=path.join(path.dirname(p),'.reset-'+randomUUID());
  try { await writeNew(temp,JSON.stringify(value,null,2)+'\n'); await fs.rename(temp,p); } finally { await fs.rm(temp,{force:true}); }
}
export async function installFile(source,target,mode=0o600,{create=false}={}) {
  await safe(source); await safe(target);
  const temp=path.join(path.dirname(target),'.reset-'+randomUUID());
  try {
    await fs.copyFile(source,temp,1); await fs.chmod(temp,mode);
    const h=await fs.open(temp,'r+');try{await h.sync();}finally{await h.close();}
    if(create) { await fs.link(temp,target); await fs.unlink(temp); } else await fs.rename(temp,target);
  } finally { await fs.rm(temp,{force:true}); }
}
export async function nearestExisting(p) { let cur=path.resolve(p); while(!await exists(cur)){const parent=path.dirname(cur);if(parent===cur)throw Error('Missing filesystem root');cur=parent;}await safe(cur);return cur; }
export async function checkSpace(allocations,{statfs=fs.statfs,reserve=64*1024*1024}={}) {
  const devices=new Map();
  for(const {directory,requiredBytes}of allocations) {
    const p=await nearestExisting(directory),stat=await fs.stat(p);const old=devices.get(stat.dev)??{path:p,required:reserve};old.required+=requiredBytes;devices.set(stat.dev,old);
  }
  const result=[];
  for(const d of devices.values()) { const s=await statfs(d.path); const free=Number(s.bavail)*Number(s.bsize);if(free<d.required)throw Error('Insufficient space for verified backup, staging and documents');result.push({requiredBytes:d.required,availableBytes:free}); }
  return result;
}
export async function assertFingerprint(expected) { const fresh=await fingerprint(Object.keys(expected));if(!equal(expected,fresh))throw Error('Plan expired: source file, structure or permissions changed'); }
