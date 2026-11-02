import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildPlan } from '../../lib/planner.mjs';
import { executePlan } from '../../lib/engine.mjs';
export const account='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
export const jsonl=(text='Visible request',timestamp='2026-10-20T00:00:00Z')=>JSON.stringify({type:'user',uuid:'u',timestamp,message:{role:'user',content:text}})+'\n';
export const thoughts=jsonl()+JSON.stringify({type:'assistant',uuid:'a',parentUuid:'u',message:{role:'assistant',content:[{type:'thinking',thinking:'PRIVATE_THOUGHT',signature:'PRIVATE_SIGNATURE'},{type:'redacted_thinking',data:'PRIVATE_CIPHER'},{type:'text',text:'Visible answer'},{type:'tool_use',id:'tool1',name:'read',input:{file:'fixture'}}]}})+'\n'+JSON.stringify({type:'user',uuid:'result',parentUuid:'a',timestamp:'2026-10-20T00:01:00Z',message:{content:[{type:'tool_result',tool_use_id:'tool1',content:'Visible tool result'}]}})+'\n';
export async function fixture(t) {
 const home=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'claude-v4-test-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const profile=path.join(home,'Library/Application Support/Claude'),dest=path.join(profile,'claude-code-sessions',account,org),old=path.join(profile,'claude-code-sessions','44444444-4444-4444-8444-444444444444',org),code=path.join(home,'.claude'),project=path.join(code,'projects/fixture');
 for(const p of [dest,old,project])await fs.mkdir(p,{recursive:true});
 await fs.writeFile(path.join(profile,'config.json'),JSON.stringify({lastKnownAccountUuid:account,theme:'dark'}));
 const ctx={home,guard(){},keychainState:()=> 'absent',environment:{}};
 const options={backupParent:path.join(home,'operation-backups'),outputParent:path.join(home,'documents')};
 async function add(cli=id,{desktop=cli,folder=project,source=old,body=jsonl(),...extra}={}) {
  await fs.mkdir(folder,{recursive:true});await fs.mkdir(source,{recursive:true});const file=path.join(folder,cli+'.jsonl'),index=path.join(source,'local_'+desktop+'.json');
  const record={sessionId:'local_'+desktop,cliSessionId:cli,cwd:home,title:'Synthetic conversation',createdAt:1,lastActivityAt:2,isArchived:false,...extra};
  await fs.writeFile(file,body);await fs.writeFile(index,JSON.stringify(record));return {file,index,record};
 }
 async function plan(mode,opts={}){return buildPlan(mode,{...options,...opts},ctx);}
 async function run(mode,opts={},hooks={}){return executePlan(await plan(mode,opts),{...ctx,...hooks});}
 return{home,profile,dest,old,code,project,ctx,options,add,plan,run};
}
