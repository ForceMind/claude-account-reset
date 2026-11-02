import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { VERSION, equal, canonical, sha, safe, exists, inventory, contentTree, fingerprint, bytes, privateCopy, atomicJSON, writeNew, installFile, checkSpace, readJSON, assertFingerprint, within } from './safety.mjs';
import { buildPlan, revalidatePlan, planDigest } from './planner.mjs';
import { stripConfig, localStorage } from './core.mjs';
import { recoveredRecord } from './recovery.mjs';
import { scanTranscript } from './transcripts.mjs';
import { ensureStopped, deleteSharedKeychain } from './platform.mjs';

export async function stagedJson(action,options) {
  const value=await readJSON(action.kind==='index'?action.source:action.path);
  if(action.kind==='index')return recoveredRecord(value);
  if(action.recipe==='strip')return stripConfig(value,options.traces,options.identityRecords).result;
  if(action.recipe==='identities')return {...value,identities:{}};
  if(action.recipe==='device-map')return {};
  throw Error('Unsupported JSON recipe');
}
async function applyDirectory(stage,target,entry,save) {
  const temp=target+'.reset-stage-'+path.basename(path.dirname(stage));
  const old=target+'.reset-old-'+path.basename(path.dirname(stage));
  await safe(temp);await safe(old);if(await exists(temp)||await exists(old))throw Error('Directory staging conflict');
  await privateCopy(stage,temp);
  if(!equal(contentTree(await inventory(stage)),contentTree(await inventory(temp))))throw Error('Directory staging verification failed');
  entry.temporaryOld=old;entry.temporaryStage=temp;await save();
  if(await exists(target))await fs.rename(target,old);
  try{await fs.rename(temp,target);}catch(error){if(await exists(old)&&!await exists(target))await fs.rename(old,target);throw error;}
  if(await exists(old))await fs.rm(old,{recursive:true});
  entry.temporaryOld=null;entry.temporaryStage=null;
}
function expectedProtected(inputs,entries) {
  const result=structuredClone(inputs);
  for(const entry of entries)if(entry.path&&entry.after) {
    for(const root of Object.keys(result)) {
      if(root===entry.path)result[root]=entry.after;
      else if(within(entry.path,root)) {
        const rel=path.relative(root,entry.path);
        for(const k of Object.keys(result[root]))if(k===rel||k.startsWith(rel+path.sep))delete result[root][k];
        if(entry.after['.'].type!=='absent')for(const[k,v]of Object.entries(entry.after))result[root][k==='.'?rel:path.join(rel,k)]=v;
      }
    }
  }
  return result;
}
export async function executePlan(saved,context={}) {
  await revalidatePlan(saved,context);
  const guard=context.guard??ensureStopped;guard();
  const options=saved.options;
  await checkSpace(saved.space.allocations,{statfs:context.statfs});
  const batch=path.join(options.backupParent,'run-'+saved.id);
  const documents=path.join(options.outputParent,'run-'+saved.id);
  if(await exists(batch)||await exists(documents))throw Error('This plan has an existing run directory; inspect its journal instead of rerunning');
  await safe(batch);await fs.mkdir(options.backupParent,{recursive:true,mode:0o700});await fs.mkdir(batch,{mode:0o700});
  const payload=path.join(batch,'payload'),stage=path.join(batch,'stage');await fs.mkdir(payload,{mode:0o700});await fs.mkdir(stage,{mode:0o700});
  const journal={schema:1,version:VERSION,home:saved.home,plan:saved,status:'backing-up',entries:[],documentsDirectory:null,checks:{backupsVerified:false,protectedDataVerified:false},error:null};
  const journalPath=path.join(batch,'journal.json');const save=()=>atomicJSON(journalPath,journal);await save();
  let verified=false;
  try {
    for(const [i,action]of saved.actions.entries()) {
      const entry={...action,id:i,status:'pending',before:action.path?await inventory(action.path):null,backup:null,after:null};journal.entries.push(entry);await save();
      if(action.path&&entry.before['.'].type!=='absent') {
        entry.backup=String(i);await privateCopy(action.path,path.join(payload,entry.backup));
        if(context.afterBackupCopy)await context.afterBackupCopy({entry,batch});
        if(!equal(contentTree(entry.before),contentTree(await inventory(path.join(payload,entry.backup)))))throw Error('Backup verification failed');
        entry.backupVerified=true;await save();
      }
    }
    journal.checks.backupsVerified=true;journal.status='staging';await save();
    for(const entry of journal.entries) {
      const dest=path.join(stage,String(entry.id));
      if(entry.kind==='json'||entry.kind==='index') {
        await writeNew(dest,JSON.stringify(await stagedJson(entry,options),null,2)+'\n');
        if((await inventory(dest))['.'].sha256!==entry.sha256)throw Error('Staged JSON differs from reviewed plan');
      }else if(entry.kind==='transcript') {
        const result=await scanTranscript(entry.path,{output:dest});
        if(result.sha256!==entry.expected.sha256||result.outputSha256!==entry.expected.outputSha256||result.semanticSha256!==entry.expected.semanticSha256)throw Error('Transcript staging differs from plan');
        const verify=await scanTranscript(dest);if(verify.thinkingBlocks||verify.semanticSha256!==result.semanticSha256)throw Error('Visible-record verification failed');
      }else if(entry.kind==='document') {
        const result=await scanTranscript(entry.source,{document:dest,title:entry.title});if(result.documentSha256!==entry.sha256)throw Error('Document differs from plan');
      }else if(entry.kind==='leveldb') {
        await privateCopy(entry.path,dest);const r=await localStorage(dest,{apply:true,traces:options.traces});
        if(!equal(r.removedKeys,entry.removedKeys)||r.preserved!==entry.preserved)throw Error('Database rules differ from plan');
      }else if(entry.kind==='delete')entry.after={'.':{type:'absent'}};
      else if(entry.kind!=='keychain')throw Error('Unsupported action');
      if(['json','index','transcript'].includes(entry.kind)) {
        const tree=await inventory(dest);tree['.'].mode=entry.before?.['.'].mode??0o600;entry.after=tree;
      }else if(entry.kind==='leveldb'){ const tree=await inventory(dest);for(const[rel,meta]of Object.entries(tree))await fs.chmod(rel==='.'?dest:path.join(dest,rel),meta.type==='directory'?0o700:0o600);entry.after=await inventory(dest); }
      entry.status='staged';await save();
    }
    if(context.beforeWrite)await context.beforeWrite({batch,journal});
    guard();await revalidatePlan(saved,context);await assertFingerprint(saved.inputs);
    journal.status='applying';await save();
    if(saved.actions.some(a=>a.kind==='document')) {
      await fs.mkdir(options.outputParent,{recursive:true,mode:0o700});await fs.mkdir(documents,{mode:0o700});journal.documentsDirectory=documents;await save();
    }
    // Keychain deletion is last and cannot be restored from a file backup.
    const sequence=[...journal.entries.filter(e=>e.kind!=='keychain'),...journal.entries.filter(e=>e.kind==='keychain')];
    for(const entry of sequence) {
      guard();
      if(entry.path&&!equal(await inventory(entry.path),entry.before))throw Error('Target changed immediately before write');
      entry.status='writing';await save();
      if(context.beforeAction)await context.beforeAction(entry);
      // Hooks/tests may simulate another process; recheck after the boundary as well.
      if(entry.path&&!equal(await inventory(entry.path),entry.before))throw Error('Concurrent target change');
      const staged=path.join(stage,String(entry.id));
      if(entry.kind==='delete')await fs.unlink(entry.path);
      else if(['json','index','transcript'].includes(entry.kind))await installFile(staged,entry.path,entry.after['.'].mode,{create:entry.before['.'].type==='absent'});
      else if(entry.kind==='leveldb')await applyDirectory(staged,entry.path,entry,save);
      else if(entry.kind==='document')await installFile(staged,path.join(documents,entry.name),0o600,{create:true});
      else if(entry.kind==='keychain'){entry.result=(context.deleteKeychain??deleteSharedKeychain)();}
      if(entry.path&&!equal(await inventory(entry.path),entry.after))throw Error('Applied content or permissions differ from staged result');
      if(entry.kind==='document'&&(await inventory(path.join(documents,entry.name)))['.'].sha256!==entry.sha256)throw Error('Document verification failed');
      entry.status='complete';await save();
    }
    if(journal.documentsDirectory) {
      const links=journal.entries.filter(e=>e.kind==='document').map(e=>`- [${e.sessionId}](${e.name})`);
      await writeNew(path.join(documents,'INDEX.md'),'# 本地接手文档\n\n仅可见历史，不是推断的任务摘要或新的执行授权。请勿公开上传。\n\n'+links.join('\n')+'\n');
    }
    const expected=expectedProtected(saved.inputs,journal.entries);const actual=await fingerprint(Object.keys(saved.inputs));
    if(!equal(expected,actual))throw Error('Protected file set, data or permissions changed');
    journal.checks.protectedDataVerified=true;journal.status='complete';await save();verified=true;
  }catch(error) {
    journal.status='partial-or-stopped';journal.error={message:'Operation stopped; inspect entry statuses and re-preview recovery. Sensitive exception content withheld.',type:error.constructor.name};
    await save();throw Error(`Operation stopped; backup retained; journal: ${journalPath}; ${safeError(error.message)}`);
  }
  const report={version:VERSION,mode:'apply',operation:saved.operation,planId:saved.id,status:'complete',changes:journal.entries.map(({before,after,...e})=>({kind:e.kind,path:e.path??e.name??e.service,status:e.status})),backupDirectory:batch,documentsDirectory:journal.documentsDirectory,backupDiscarded:false,protectedDataVerified:journal.checks.protectedDataVerified,selectedSessions:saved.selection.filter(s=>s.status==='selected').length,skipped:saved.selection.filter(s=>s.status!=='selected').map(({sessionId,reason})=>({sessionId,reason})),keychainIrreversible:journal.entries.some(e=>e.kind==='keychain'),uiVerified:false,modelVerified:false};
  // Intentional exclusions are complete scope decisions; unresolved/skipped candidates retain backups.
  const unresolved=report.skipped.some(s=>!['not-selected','explicitly-excluded','recent-or-unknown-user-activity','new-since-baseline','transcript-changed-since-baseline','cli-id-changed-since-baseline','index-changed-since-baseline'].includes(s.reason));
  if(verified&&options.discardBackup&&!unresolved){await safe(batch);await fs.rm(batch,{recursive:true});report.backupDirectory=null;report.backupDiscarded=true;}
  else {await fs.rm(stage,{recursive:true});if(options.discardBackup)report.backupRetainedReason='Unresolved candidates remain';}
  return report;
}
function safeError(message) {
  const allowed=['Backup verification failed','Insufficient space','Plan expired','Protected','Concurrent','Target changed','Source','Staged','Transcript','Visible-record','Database','Document','Keychain','Applied'];
  return allowed.some(s=>message.startsWith(s))?message.split('\n')[0]:'See the private journal; original error omitted';
}

function allowedRestorePath(plan,file) {
  const opts=plan.options;
  if(plan.identity.target){const t=plan.identity.target;const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;if(!uuid.test(t.account)||!uuid.test(t.org)||t.directory!==path.join(opts.target,'claude-code-sessions',t.account,t.org))return false;}
  if(plan.operation==='reset') {
    for(const root of opts.profiles) {
      const rel=path.relative(root,file);
      if(['config.json','Cookies','Cookies-journal','Cookies-wal','Cookies-shm','config.json.journal','plan-usage-history.json','ant-did','remote-control-state.json','ant-device-registry.json','Local Storage/leveldb'].includes(rel))return true;
    }
    for(const root of opts.codeDirs){const rel=path.relative(root,file);if(['.credentials.json','.claude.json'].includes(rel)||/^backups\/[.]claude[.]json[.]backup[.][^/]+$/.test(rel))return true;}
    return opts.codeDirs.includes(path.join(plan.home,'.claude'))&&file===path.join(plan.home,'.claude.json');
  }
  if(plan.operation==='recover'||plan.operation==='handoff') {
    if(plan.identity.target&&path.dirname(file)===plan.identity.target.directory&&/^local_[a-f0-9-]{36}\.json$/i.test(path.basename(file)))return true;
    return plan.operation==='handoff'&&opts.codeDirs.some(root=>{const rel=path.relative(path.join(root,'projects'),file);return /^[^/]+\/[a-f0-9-]{36}\.jsonl$/i.test(rel);});
  }
  return false;
}
export async function inspectBackup(batch,{home=os.homedir()}={}) {
  batch=path.resolve(batch);await safe(batch);const file=path.join(batch,'journal.json'),journal=await readJSON(file);
  const p=journal.plan;
  if(journal.schema!==1||journal.version!==VERSION||p.home!==path.resolve(home)||p.digest!==planDigest(p)||journal.home!==p.home)throw Error('Unsupported or altered backup journal');
  if(batch!==path.join(p.options.backupParent,'run-'+p.id))throw Error('Backup location does not match original plan');
  const entries=[];
  for(const e of journal.entries)if(e.path) {
    if(!allowedRestorePath(p,e.path)||!p.actions.some(a=>a.kind===e.kind&&a.path===e.path))throw Error('Backup target outside original rule scope');
    await safe(e.path);
    if(!Number.isSafeInteger(e.id)||e.id<0||!p.actions[e.id]||p.actions[e.id].kind!==e.kind||p.actions[e.id].path!==e.path)throw Error('Invalid backup entry identity');
    if(e.backup!==null&&e.backup!==String(e.id))throw Error('Invalid backup payload path');
    if(e.backup!==null&&!equal(contentTree(e.before),contentTree(await inventory(path.join(batch,'payload',e.backup)))))throw Error('Backup content verification failed');
    const current=await inventory(e.path);const state=equal(current,e.before)?'already-original':e.after&&equal(current,e.after)?'restorable':'conflict';
    entries.push({id:e.id,path:e.path,kind:e.kind,state,current,before:e.before,after:e.after,backup:e.backup});
  }
  return {version:VERSION,backupDirectory:batch,status:journal.status,entries,keychainRestorable:false,journalSha256:(await inventory(file))['.'].sha256};
}
export async function buildRestorePlan(batch,ids=[],context={}) {
  (context.guard??ensureStopped)();const inspection=await inspectBackup(batch,context);
  const selected=inspection.entries.filter(e=>!ids.length||ids.includes(e.id));
  if(ids.some(id=>!inspection.entries.some(e=>e.id===id)))throw Error('Unknown backup entry');
  if(selected.some(e=>e.state==='conflict'))throw Error('Restore conflicts with newer/current data; do not overwrite');
  const p={schema:1,version:VERSION,operation:'restore',home:path.resolve(context.home??os.homedir()),id:randomUUID(),backupDirectory:inspection.backupDirectory,journalSha256:inspection.journalSha256,entries:selected.filter(e=>e.state==='restorable'),requestedIds:ids};
  p.digest=sha(canonical(p));return p;
}
export async function executeRestore(saved,context={}) {
  const {digest,...body}=saved;if(digest!==sha(canonical(body))||saved.operation!=='restore'||saved.home!==path.resolve(context.home??os.homedir()))throw Error('Invalid restore plan');
  const fresh=await buildRestorePlan(saved.backupDirectory,saved.requestedIds,context);
  if(saved.journalSha256!==fresh.journalSha256||!equal(saved.entries,fresh.entries))throw Error('Restore plan expired');
  const guard=context.guard??ensureStopped;guard();
  const root=path.join(saved.backupDirectory,'restore-'+saved.id);if(await exists(root))throw Error('Restore already attempted');
  await checkSpace([{directory:root,requiredBytes:saved.entries.reduce((n,e)=>n+bytes(e.current)+bytes(e.before)*2,0)},...saved.entries.map(e=>({directory:path.dirname(e.path),requiredBytes:bytes(e.before)}))],{statfs:context.statfs});
  await fs.mkdir(root,{mode:0o700});const log={status:'backing-up-current',entries:[]};const save=()=>atomicJSON(path.join(root,'journal.json'),log);await save();
  try {
    for(const e of saved.entries) {
      const record={id:e.id,path:e.path,status:'pending'};log.entries.push(record);await save();
      if(e.current['.'].type!=='absent'){await privateCopy(e.path,path.join(root,String(e.id)));if(!equal(contentTree(e.current),contentTree(await inventory(path.join(root,String(e.id))))))throw Error('Current-state backup verification failed');}
    }
    guard();const again=await buildRestorePlan(saved.backupDirectory,saved.requestedIds,context);if(!equal(again.entries,saved.entries))throw Error('Restore target changed');
    log.status='restoring';await save();
    for(const e of saved.entries) {
      guard();if(!equal(await inventory(e.path),e.current))throw Error('Concurrent restore target change');
      const record=log.entries.find(r=>r.id===e.id);record.status='writing';await save();
      if(e.before['.'].type==='absent')await fs.unlink(e.path);
      else if(e.before['.'].type==='file')await installFile(path.join(saved.backupDirectory,'payload',e.backup),e.path,e.before['.'].mode,{create:e.current['.'].type==='absent'});
      else {
        await applyDirectory(path.join(saved.backupDirectory,'payload',e.backup),e.path,record,save);
        for(const[rel,meta]of Object.entries(e.before))await fs.chmod(rel==='.'?e.path:path.join(e.path,rel),meta.mode);
      }
      if(!equal(await inventory(e.path),e.before))throw Error('Restored content verification failed');record.status='complete';await save();
    }
    log.status='complete';await save();return {status:'complete',restored:saved.entries.length,currentStateBackup:root};
  }catch{log.status='partial-or-stopped';await save();throw Error('Restore stopped; current-state backup and journal retained: '+root);}
}
