import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {rawLines,decodeLine,projectRecord,scanTranscript,classifyCopies} from '../lib/transcripts.mjs';
import {safe,exists,sha,writeNew,atomicJSON,within,checkSpace,privateDirectory} from '../lib/safety.mjs';
import {stamp,unchanged,jsonFile,digest,shortText} from './readonly.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const cleanIndex=d=>Object.fromEntries(['sessionId','cliSessionId','cwd','title','createdAt','lastActivityAt','isArchived'].filter(k=>typeof d[k]==='string'||typeof d[k]==='number'||typeof d[k]==='boolean').map(k=>[k,typeof d[k]==='string'?d[k].slice(0,k==='cwd'?4096:k==='title'?500:120):d[k]]));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function validTime(t){const n=typeof t==='number'?t:typeof t==='string'?Date.parse(t):NaN;const d=new Date(n);return Number.isFinite(n)&&n>0&&Number.isFinite(d.getTime())?d.toISOString():null;}
function visible(row){
  const {result,removed}=projectRecord(row),role=result?.message?.role??result?.type;
  if(!['user','assistant'].includes(role))return {removed,text:''};
  const content=result.message?.content;
  const blocks=typeof content==='string'?[{type:'text',text:content}]:Array.isArray(content)?content:[];
  const text=blocks.map(b=>b?.type==='text'?String(b.text??''):b?.type==='tool_use'?`工具调用 ${shortText(b.name)}\n${JSON.stringify(b.input??{})}`:b?.type==='tool_result'?`工具结果\n${typeof b.content==='string'?b.content:Array.isArray(b.content)?b.content.filter(x=>x?.type==='text').map(x=>x.text??'').join('\n'):'[非文本结果]'}`:`[附件或其他内容：${shortText(b?.type)||'unknown'}]`).join('\n\n');
  return {role,removed,text:text.slice(0,12000),truncated:text.length>12000};
}
export class SessionLibrary{
  constructor({storage,check=()=>{},guard=()=>{},emit=()=>{},beforePublish=()=>{}}){this.storage=storage;this.check=check;this.guard=guard;this.emit=emit;this.beforePublish=beforePublish;this.rows=new Map();this.cursors=new Map();this.tickets=new Map();this.outputsMap=new Map();this.roots=[];}
  async scan(directories){
    this.rows.clear();this.cursors.clear();this.tickets.clear();this.roots=directories.map(d=>d.path);const groups=new Map(),issues=[];let seen=0;
    if(this.roots.some(r=>within(this.storage,r)||within(r,this.storage)))throw Error('资料范围与本工具数据目录重叠，请选择具体目录。');
    const group=key=>{if(!groups.has(key))groups.set(key,{id:sha(key),cliId:key.startsWith('cli:')?key.slice(4):null,indexes:[],copies:[],issues:[]});return groups.get(key);};
    const visit=async(root,kind,depth=0)=>{
      this.check();if(!await exists(root))return;await safe(root);
      if(depth>8)throw Error('资料层级超出本版范围，未将结果标记为完整。');
      for(const e of (await fs.readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
        this.check();if(++seen>50000)throw Error('资料数量超出本版范围，请缩小目录后重试。');
        const file=path.join(root,e.name);
        if(e.isSymbolicLink()){issues.push({path:file,message:'符号链接未读取'});continue;}
        if(e.isDirectory()){if(kind==='index'||depth===0)await visit(file,kind,depth+1);continue;}
        if(!e.isFile())continue;
        if(kind==='index'&&/^local_.*\.json$/.test(e.name)){
          try{
            const {data,before}=await jsonFile(file);if(typeof data.sessionId!=='string'||!data.sessionId.startsWith('local_')||!UUID.test(data.sessionId.slice(6))||e.name!==data.sessionId+'.json')throw Error('索引标识与文件名不一致');
            const cli=UUID.test(data.cliSessionId??'')?data.cliSessionId.toLowerCase():null;
            const row=group(cli?'cli:'+cli:'index:'+file);row.indexes.push({file,before,data:cleanIndex(data)});
            if(!cli)row.issues.push('索引缺少明确 CLI 关联，未猜测正文');
          }catch{issues.push({path:file,message:'索引损坏、正在变化或格式不支持，原件保留'});}
        }
        if(kind==='body'&&depth===1&&e.name.endsWith('.jsonl')&&UUID.test(e.name.slice(0,-6))){
          try{const before=await stamp(file),row=group('cli:'+e.name.slice(0,-6).toLowerCase());row.copies.push({id:sha(file),file,before});}
          catch{issues.push({path:file,message:'正文无法读取或正在变化'});}
        }
        if(seen%50===0){this.emit({phase:'catalogue',completed:seen,message:`已检查 ${seen} 个目录条目`});await tick();}
      }
    };
    for(const d of directories){if(d.kind==='desktop')await visit(path.join(d.path,'claude-code-sessions'),'index');if(d.kind==='code')await visit(path.join(d.path,'projects'),'body');}
    const links=new Map();for(const row of groups.values())for(const i of row.indexes){const s=links.get(i.data.sessionId)??new Set();s.add(row.cliId);links.set(i.data.sessionId,s);}
    const marks=await this.readMarks();
    for(const row of groups.values()){
      const preferred=[...row.indexes].sort((a,b)=>(Date.parse(validTime(b.data.lastActivityAt)??'')||0)-(Date.parse(validTime(a.data.lastActivityAt)??'')||0))[0]?.data;
      row.title=shortText(preferred?.title)||'未命名本地会话';row.project=shortText(preferred?.cwd,1000)||path.basename(path.dirname(row.copies[0]?.file??''))||'未记录';
      row.lastActivity=validTime(preferred?.lastActivityAt);row.fileUpdated=row.copies.length?new Date(Math.max(...row.copies.map(c=>c.before.mtimeMs))).toISOString():null;
      row.archived=row.indexes.length&&row.indexes.every(i=>i.data.isArchived)?'archived':row.indexes.some(i=>i.data.isArchived)?'mixed':'active';
      if(!row.copies.length)row.issues.push('正文缺失');if(!row.indexes.length)row.issues.push('没有 Desktop 索引，仅发现 Code 正文');
      if(path.isAbsolute(row.project)&&!await exists(row.project))row.issues.push('工作目录不存在');
      if(row.indexes.some(i=>links.get(i.data.sessionId)?.size>1))row.issues.push('同一 Desktop 标识关联多个 CLI 记录，已分别列出');
      row.classification=row.copies.length>1?'unchecked':row.copies.length?'single':'missing';row.mark=marks[row.id]??{favorite:false,note:''};this.rows.set(row.id,row);
    }
    this.check();return {count:this.rows.size,issues,scope:'仅选定的本地 Code 主会话；不包含云端聊天、Cowork 未知格式或独立子代理记录'};
  }
  get(id){const row=this.rows.get(id);if(!row)throw Error('会话列表已失效，请重新读取。');return row;}
  async page({query='',project='',filter='all',offset=0}={}){
    if(typeof query!=='string'||query.length>300||typeof project!=='string'||project.length>1000||!['all','favorite','issues','archived'].includes(filter)||!Number.isSafeInteger(offset)||offset<0)throw Error('筛选条件无效。');
    const q=query.toLowerCase();let rows=[...this.rows.values()].filter(r=>(!q||(r.title+' '+r.project).toLowerCase().includes(q))&&(!project||r.project===project)&&(filter!=='favorite'||r.mark.favorite)&&(filter!=='issues'||r.issues.length||r.copies.length>1)&&(filter!=='archived'||r.archived!=='active'));
    rows.sort((a,b)=>(Date.parse(b.lastActivity??b.fileUpdated??'')||0)-(Date.parse(a.lastActivity??a.fileUpdated??'')||0)||a.id.localeCompare(b.id));
    return {total:rows.length,offset,next:offset+40<rows.length?offset+40:null,projects:[...new Set([...this.rows.values()].map(r=>r.project))].sort(),rows:rows.slice(offset,offset+40).map(r=>({id:r.id,title:r.title,project:r.project,lastActivity:r.lastActivity,fileUpdated:r.fileUpdated,archived:r.archived,issues:r.issues,classification:r.classification,mark:r.mark,indexCount:r.indexes.length,copies:r.copies.map(c=>({id:c.id,path:c.file,bytes:c.before.size}))}))};
  }
  async preview({id,copyId,cursor=null}){
    const row=this.get(id),copy=row.copies.find(c=>c.id===copyId);if(!copy)throw Error('请选择明确的正文副本。');
    await unchanged(copy.file,copy.before);let offset=0;
    if(cursor){const c=this.cursors.get(cursor);if(!c||c.id!==id||c.copyId!==copyId)throw Error('预览位置失效，请从头读取。');offset=c.offset;this.cursors.delete(cursor);}
    const messages=[];let consumed=0,thinking=0,characters=0,lines=0;
    for await(const bytes of rawLines(copy.file,{start:offset})){
      this.check();consumed+=bytes.length;lines++;const {row:record}=decodeLine(bytes);
      if(record){const m=visible(record);thinking+=m.removed;if(m.text){messages.push(m);characters+=m.text.length;}}
      if(messages.length>=40||characters>=120000||lines>=300)break;
    }
    await unchanged(copy.file,copy.before);const nextOffset=offset+consumed;let next=null;
    if(nextOffset<copy.before.size){next=randomUUID();if(this.cursors.size>=256)this.cursors.delete(this.cursors.keys().next().value);this.cursors.set(next,{id,copyId,offset:nextOffset});}
    return {messages,next,thinkingInPage:thinking,scope:'当前页可见记录；thinking 未显示，原文未改写。长记录在预览中截短，Markdown 导出不使用此截短内容。'};
  }
  async analyze(id){
    const row=this.get(id),copies=[];for(const c of row.copies){this.check();await unchanged(c.file,c.before);const stats=await scanTranscript(c.file,{checkCancelled:this.check});copies.push({...c,stats});}
    const result=await classifyCopies(copies);row.classification=result.kind;
    for(const c of row.copies)await unchanged(c.file,c.before);
    return {classification:result.kind,thinkingBlocks:copies.reduce((n,c)=>n+c.stats.thinkingBlocks,0),copies:copies.map(c=>({id:c.id,bytes:c.stats.bytes,records:c.stats.records,thinkingBlocks:c.stats.thinkingBlocks,sha256:c.stats.sha256})),note:'思考块数量按文件副本统计，不合并分叉，不自动挑选或删除正文。'};
  }
  async readMarks(){const file=path.join(this.storage,'library-marks.json');if(!await exists(file))return {};return (await jsonFile(file)).data;}
  async mark({id,favorite,note}){
    const row=this.get(id);if(typeof favorite!=='boolean'||typeof note!=='string'||note.length>2000)throw Error('备注最多 2000 字，请明确选择收藏状态。');
    await privateDirectory(this.storage,{recursive:true});const marks=await this.readMarks();marks[id]={favorite,note};await atomicJSON(path.join(this.storage,'library-marks.json'),marks);row.mark=marks[id];return row.mark;
  }
  async prepare({ids,kind}){
    this.tickets.clear();if(!['markdown','backup'].includes(kind)||!Array.isArray(ids)||!ids.length||ids.length>200||new Set(ids).size!==ids.length)throw Error('请选择 1 至 200 条明确会话。');
    const rows=ids.map(id=>this.get(id)),files=new Map();
    for(const row of rows){if(kind==='markdown'&&!row.copies.length)throw Error('选择包含缺失正文的会话，请先取消该项。');for(const c of row.copies){await unchanged(c.file,c.before);files.set(c.file,{...c,rowId:row.id,title:row.title});}for(const i of row.indexes)await unchanged(i.file,i.before);}
    const snapshots=[];for(const f of files.values()){this.check();snapshots.push({...f,...await digest(f.file,this.check)});await tick();}
    const indexes=rows.flatMap(r=>r.indexes.map(i=>({...i,rowId:r.id})));
    const ticket={id:randomUUID(),kind,rows:rows.map(r=>({id:r.id,title:r.title,issues:[...r.issues]})),files:snapshots,indexes};this.tickets.set(ticket.id,ticket);
    return {id:ticket.id,kind,sessions:rows.length,copies:snapshots.length,bytes:snapshots.reduce((n,f)=>n+f.bytes,0),warnings:['每个正文副本分别保存，不会合并。','项目文件、外部附件和云端资产不包含在内。',kind==='backup'?'备份保留正文原字节及 thinking；关联信息只保留必要字段，不包含登录配置。':'文档仅包含可见历史与工具记录，不包含 thinking 或二进制附件。']};
  }
  async save(ticketId,parent){
    const ticket=this.tickets.get(ticketId);this.tickets.clear();if(!ticket)throw Error('保存计划已失效，请重新准备。');
    parent=path.resolve(parent);await safe(parent);
    if(this.roots.some(r=>within(parent,r)||within(r,parent)))throw Error('保存位置必须与选定资料分开，不能放进源目录或其上级。');
    if(ticket.kind==='backup')this.guard();
    for(const f of ticket.files){this.check();await unchanged(f.file,f.before);if((await digest(f.file,this.check)).sha256!==f.sha256)throw Error('正文已变化，请重新读取会话。');}
    for(const i of ticket.indexes)await unchanged(i.file,i.before);
    await fs.mkdir(parent,{recursive:true,mode:0o700});await checkSpace([{directory:parent,requiredBytes:ticket.files.reduce((n,f)=>n+f.bytes*3,0)+4*1024*1024}]);
    const id=randomUUID(),stage=path.join(parent,'.claude-session-stage-'+id),destination=path.join(parent,'claude-sessions-'+ticket.kind+'-'+id);
    await privateDirectory(stage);let published=false;
    try{
      const manifest={schema:1,kind:ticket.kind,createdAt:new Date().toISOString(),sessions:ticket.rows,files:[],limitations:['不包含项目、外部附件或云端资产','本备份不是账号恢复包，不包含配置凭据，也不自动导入 Claude']};
      for(const [n,f] of ticket.files.entries()){
        this.check();this.emit({phase:'saving',completed:n,total:ticket.files.length});const name=`${n+1}-${f.rowId.slice(0,12)}.${ticket.kind==='backup'?'jsonl':'md'}`,target=path.join(stage,name);
        if(ticket.kind==='backup'){await fs.copyFile(f.file,target,1);await fs.chmod(target,0o600);if((await digest(target,this.check)).sha256!==f.sha256)throw Error('会话备份校验失败，未发布不完整结果。');}
        else {const stats=await scanTranscript(f.file,{document:target,title:f.title,checkCancelled:this.check});if(stats.sha256!==f.sha256||stats.documentSha256!==(await digest(target,this.check)).sha256)throw Error('导出期间正文变化，未发布不完整结果。');}
        manifest.files.push({name,source:f.file,sourceSha256:f.sha256,outputSha256:(await digest(target,this.check)).sha256,rowId:f.rowId});
      }
      if(ticket.kind==='backup'){
        await writeNew(path.join(stage,'session-indexes.json'),JSON.stringify(ticket.indexes.map(i=>({rowId:i.rowId,source:i.file,record:i.data})),null,2)+'\n');
        manifest.indexFile={name:'session-indexes.json',sha256:(await digest(path.join(stage,'session-indexes.json'),this.check)).sha256};
      }
      for(const f of ticket.files)await unchanged(f.file,f.before);for(const i of ticket.indexes)await unchanged(i.file,i.before);
      await this.beforePublish();this.check();for(const f of ticket.files)await unchanged(f.file,f.before);for(const i of ticket.indexes)await unchanged(i.file,i.before);
      await safe(parent);await writeNew(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
      await fs.rename(stage,destination);published=true;
      this.outputsMap.set(id,destination);let registered=true;
      try{await privateDirectory(this.storage,{recursive:true});const registryFile=path.join(this.storage,'library-outputs.json');
        const registry=await exists(registryFile)?(await jsonFile(registryFile)).data:{};registry[id]={path:destination,kind:ticket.kind,createdAt:manifest.createdAt,files:ticket.files.length};
        await atomicJSON(registryFile,registry);
      }catch{registered=false;}
      return {id,path:destination,kind:ticket.kind,files:ticket.files.length,sourceUnchanged:true,registered};
    }catch(error){if(!published)await fs.rm(stage,{recursive:true,force:true});throw error;}
  }
  async outputs(){
    const file=path.join(this.storage,'library-outputs.json');this.outputsMap.clear();if(!await exists(file))return [];
    const registry=(await jsonFile(file)).data;return Object.entries(registry).map(([id,r])=>{this.outputsMap.set(id,r.path);return {id,...r};});
  }
  reveal(id){const row=this.rows.get(id);if(row)return row.copies[0]?.file??row.indexes[0]?.file;return this.outputsMap.get(id);}
}
