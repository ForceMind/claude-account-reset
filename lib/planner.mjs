import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { VERSION, sha, canonical, equal, exists, safe, within, readJSON, fingerprint, inventory, bytes, fileHash, writeNew } from './safety.mjs';
import { randomUUID } from 'node:crypto';
import { stripConfig, localStorage, discover } from './core.mjs';
import { records, recoveredRecord } from './recovery.mjs';
import { scanTranscript, classifyCopies } from './transcripts.mjs';
import { ensureStopped, keychainState } from './platform.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PATH_OPTIONS=['target','backupParent','outputParent','baseline'];
const ALLOWED=new Set(['profiles','sources','codeDirs','target','org','traces','identityRecords','includeKeychain','backupParent','outputParent','discardBackup','include','exclude','protectSince','timeZone','baseline']);
const HISTORY=['claude-code-sessions','local-agent-mode-sessions','side-session-notes','scratch-workspaces','git-shadow','IndexedDB','Session Storage'];
function outside(p,roots) {if(roots.some(r=>within(p,r)||within(r,p)))throw Error('Output/backup must be separate and outside Claude data');}
export function validateDate(date,tz) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error('Invalid activity cutoff date');
  if(!tz)throw Error('--protect-since requires --time-zone');new Intl.DateTimeFormat('en-CA',{timeZone:tz}).format(0);
}
export function protectedByDate(stats,date,tz) {
  if(!date)return false;
  if(stats.unknownUserTime||!stats.lastUserAt)return true;
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stats.lastUserAt));return day>=date;
}
export async function normalizeOptions(mode,input,home) {
  if(!['reset','recover','handoff'].includes(mode))throw Error('Unknown operation');
  for(const key of Object.keys(input))if(!ALLOWED.has(key))throw Error('Unknown plan option');
  const opts={profiles:[],sources:[],codeDirs:[path.join(home,'.claude')],target:path.join(home,'Library/Application Support/Claude'),org:null,traces:false,identityRecords:false,includeKeychain:false,backupParent:path.resolve('operation-backups'),outputParent:path.resolve('handoff-documents'),discardBackup:false,include:[],exclude:[],protectSince:null,timeZone:null,baseline:null,...input};
  for(const key of PATH_OPTIONS)if(opts[key]!==null){if(typeof opts[key]!=='string')throw Error('Invalid path option');opts[key]=path.resolve(opts[key]);await safe(opts[key]);}
  for(const key of ['profiles','sources','codeDirs']) {if(!Array.isArray(opts[key])||opts[key].some(v=>typeof v!=='string'))throw Error('Invalid directory list');opts[key]=[...new Set(opts[key].map(p=>path.resolve(p)))].sort();for(const p of opts[key])await safe(p);}
  for(const key of ['include','exclude']) {if(!Array.isArray(opts[key])||opts[key].some(v=>typeof v!=='string'||!UUID.test(v.replace(/^local_/,''))))throw Error('Selection requires session UUIDs');opts[key]=[...new Set(opts[key])].sort();}
  for(const key of ['traces','identityRecords','includeKeychain','discardBackup'])if(typeof opts[key]!=='boolean')throw Error('Invalid boolean option');
  if(opts.org!==null&&!UUID.test(opts.org))throw Error('Invalid organization UUID');
  if(opts.protectSince!==null)validateDate(opts.protectSince,opts.timeZone);
  if(mode!=='reset'&&(opts.traces||opts.identityRecords||opts.includeKeychain||opts.profiles.length))throw Error('Cleanup options cannot be combined with recovery/handoff');
  if(mode==='reset'&&(opts.include.length||opts.exclude.length||opts.sources.length||opts.baseline||opts.protectSince||opts.org))throw Error('Session options require recovery or handoff');
  if(mode!=='reset'&&!opts.codeDirs.length)throw Error('Select at least one Code configuration directory');
  if(mode==='reset'&&!opts.profiles.length)opts.profiles=await discover(home);
  if(mode!=='reset'&&!opts.sources.length)opts.sources=await discover(home);
  const profiles=mode==='reset'?opts.profiles:[...new Set([...opts.sources,opts.target])];
  for(const p of profiles) {
    await safe(p);if(!await exists(p)||!(await fs.stat(p)).isDirectory())throw Error('Profile directory not found');
    if(!/^Claude(?:[- ]|$)/.test(path.basename(p))&&!await exists(path.join(p,'claude_desktop_config.json')))throw Error('Unrecognized Desktop profile shape');
  }
  const roots=[...profiles,...opts.codeDirs];outside(opts.backupParent,roots);outside(opts.outputParent,roots);
  if(within(opts.outputParent,opts.backupParent)||within(opts.backupParent,opts.outputParent))throw Error('Documents and backups must use separate trees');
  return opts;
}
export async function discoverTranscripts(codeDirs) {
  const map=new Map();
  for(const code of codeDirs) {
    const root=path.join(code,'projects');if(!await exists(root))continue;
    await safe(root);
    for(const name of (await fs.readdir(root)).sort()) {
      const dir=path.join(root,name);await safe(dir);if(!(await fs.stat(dir)).isDirectory())continue;
      for(const n of (await fs.readdir(dir)).sort())if(n.endsWith('.jsonl')&&UUID.test(n.slice(0,-6))) {
        const file=path.join(dir,n);await safe(file);if(!(await fs.stat(file)).isFile())continue;
        const id=n.slice(0,-6);map.set(id,[...(map.get(id)??[]),file]);
      }
    }
  }
  return map;
}
function planComparable(p){return {schema:p.schema,version:p.version,home:p.home,operation:p.operation,options:p.options,inputs:p.inputs,actions:p.actions,selection:p.selection,identity:p.identity,warnings:p.warnings,space:p.space};}
export function planDigest(p){return sha(canonical({...planComparable(p),id:p.id,createdAt:p.createdAt}));}
export async function savePlan(p,file){await writeNew(file,JSON.stringify(p,null,2)+'\n');}
export async function loadPlan(file){const p=await readJSON(file);if(p.schema!==1||p.version!==VERSION||p.digest!==planDigest(p))throw Error('Unsupported or modified plan; preview again');return p;}
export async function buildPlan(mode,input={},context={}) {
  const home=path.resolve(context.home??os.homedir());await safe(home);
  (context.guard??ensureStopped)();
  const opts=await normalizeOptions(mode,input,home);
  const actions=[],selection=[],warnings=[];const roots=new Set();
  const identity={desktop:[],keychain:{safeStorage:(context.keychainState??keychainState)(),codeCredentials:(context.keychainState??keychainState)('Claude Code-credentials',null)},codeDirectories:opts.codeDirs};
  if(opts.includeKeychain&&identity.keychain.safeStorage==='unavailable')throw Error('Cannot authorize keychain deletion while access is unavailable');
  warnings.push('Known fields and conventional Code credential service only; hardware/access-group keys, arbitrary API key helpers and browser profiles are not reset');
  if((context.environment??process.env).CLAUDE_CONFIG_DIR)warnings.push('CLAUDE_CONFIG_DIR is set: environment path is audit-only unless explicitly selected with --code-dir');
  identity.cachePresence=[];identity.credentialSources=[];
  for(const code of opts.codeDirs){
    for(const name of ['cache','telemetry'])identity.cachePresence.push({path:path.join(code,name),present:await exists(path.join(code,name)),selected:false});
    const settings=path.join(code,'settings.json');if(await exists(settings)){const config=await readJSON(settings);identity.credentialSources.push({directory:code,apiKeyHelperConfigured:!!config.apiKeyHelper,environmentVariableNames:Object.keys(config.env??{}).filter(k=>/^(ANTHROPIC_|CLAUDE_CODE_OAUTH_TOKEN)/.test(k)),valuesReadIntoReport:false});}
  }
  for(const profile of (mode==='reset'?opts.profiles:opts.sources))for(const name of ['Cache','Code Cache','GPUCache','Crashpad','sentry'])identity.cachePresence.push({path:path.join(profile,name),present:await exists(path.join(profile,name)),selected:false});
  const candidates=(await fs.readdir(home)).filter(n=>n.startsWith('.claude-'));identity.discoveredCodeDirectoryCandidates=candidates.map(n=>path.join(home,n));if(candidates.length)warnings.push('Additional .claude-* directories found; select explicitly with --code-dir');
  const profiles=mode==='reset'?opts.profiles:[...new Set([...opts.sources,opts.target])];
  for(const p of profiles) {
    for(const n of HISTORY)roots.add(path.join(p,n));
    for(const n of ['config.json','claude_desktop_config.json','ant-did','ant-device-registry.json'])roots.add(path.join(p,n));
    const config=path.join(p,'config.json');const data=await exists(config)?await readJSON(config):{};
    identity.desktop.push({profile:p,lastKnownAccountUuid:data.lastKnownAccountUuid??null,version:data.updaterLastSeenVersion??null,installationFieldsPresent:['userID','machineID'].filter(k=>k in data),deviceRecordsPresent:await exists(path.join(p,'ant-did'))});
  }
  for(const code of opts.codeDirs)for(const name of ['projects','sessions','file-history','uploads','history.jsonl','settings.json','settings.local.json','.claude.json','backups'])roots.add(path.join(code,name));
  if(mode==='reset') {
    const configs=[];
    for(const code of opts.codeDirs) {
      configs.push(path.join(code,'.claude.json'));
      if(code===path.join(home,'.claude'))configs.push(path.join(home,'.claude.json'));
      else { const sibling=code+'.json';if(await exists(sibling))warnings.push('Custom sibling '+sibling+' is not auto-edited; its format/ownership requires separate confirmation'); }
      const b=path.join(code,'backups');if(await exists(b))for(const n of (await fs.readdir(b)).sort())if(n.startsWith('.claude.json.backup.'))configs.push(path.join(b,n));
      const credential=path.join(code,'.credentials.json');roots.add(credential);if(await exists(credential))actions.push({kind:'delete',path:credential,category:'credentials'});
    }
    configs.push(...opts.profiles.map(p=>path.join(p,'config.json')));
    for(const file of [...new Set(configs)].sort()) {
      roots.add(file);if(!await exists(file))continue;
      const data=await readJSON(file),result=stripConfig(data,opts.traces,opts.identityRecords);
      if(result.removed.length)actions.push({kind:'json',path:file,recipe:'strip',fields:result.removed,sha256:sha(JSON.stringify(result.result,null,2)+'\n'),size:Buffer.byteLength(JSON.stringify(result.result,null,2)+'\n')});
      if('userID'in data&&!opts.identityRecords)warnings.push('Installation/user linkage userID preserved: '+file);
      if('machineID'in data)warnings.push('machineID preserved (no underlying identity rotation): '+file);
    }
    for(const p of opts.profiles) {
      for(const n of ['Cookies','Cookies-journal','Cookies-wal','Cookies-shm','config.json.journal',...(opts.traces?['plan-usage-history.json']:[]),...(opts.identityRecords?['ant-did']:[])]) {
        const file=path.join(p,n);roots.add(file);if(await exists(file)){if(!(await fs.stat(file)).isFile())throw Error('Expected regular cleanup file');actions.push({kind:'delete',path:file,category:n==='ant-did'?'device-record':'account'});}
      }
      for(const [name,field]of [['remote-control-state.json','identities'],...(opts.identityRecords?[['ant-device-registry.json',null]]:[])]) {
        const file=path.join(p,name);roots.add(file);if(!await exists(file))continue;
        const d=await readJSON(file);if(!d||Array.isArray(d)||typeof d!=='object')throw Error('Invalid account map');
        const result=field?{...d,[field]:{}}:{};if(!equal(d,result))actions.push({kind:'json',path:file,recipe:field?'identities':'device-map',fields:[field??'account-device mappings'],sha256:sha(JSON.stringify(result,null,2)+'\n'),size:Buffer.byteLength(JSON.stringify(result,null,2)+'\n')});
      }
      const db=path.join(p,'Local Storage/leveldb');roots.add(db);
      if(await exists(db)){const audit=await localStorage(db,{traces:opts.traces});actions.push({kind:'leveldb',path:db,removedKeys:audit.removedKeys,preserved:audit.preserved,category:'account'});}
    }
    if(opts.includeKeychain)actions.push({kind:'keychain',service:'Claude Safe Storage',account:'Claude Key',restorable:false});
  } else {
    const account=identity.desktop.find(d=>d.profile===opts.target)?.lastKnownAccountUuid;
    if(!UUID.test(account??''))throw Error('Target has no valid signed-in account identifier');
    const accountRoot=path.join(opts.target,'claude-code-sessions',account);if(!await exists(accountRoot))throw Error('Target Code directory not initialized');
    const orgs=[];for(const n of await fs.readdir(accountRoot))if(UUID.test(n)&&(await fs.stat(path.join(accountRoot,n))).isDirectory())orgs.push(n);
    if(opts.org&&!orgs.includes(opts.org))throw Error('Unknown target organization');if(!opts.org&&orgs.length!==1)throw Error('Target organization ambiguous; use --org');
    const targetDir=path.join(accountRoot,opts.org??orgs[0]);identity.target={account,org:path.basename(targetDir),directory:targetDir};
    const all=(await Promise.all(opts.sources.map(records))).flat();const targetRows=(await records(opts.target)).filter(r=>path.dirname(r.file)===targetDir);
    const transcripts=await discoverTranscripts(opts.codeDirs);const groups=new Map();
    for(const row of all){const id=row.record.sessionId;groups.set(id,[...(groups.get(id)??[]),row]);}
    const baseline=opts.baseline?await loadPlan(opts.baseline):null;if(baseline){roots.add(opts.baseline);if(baseline.home!==home)throw Error('Baseline belongs to a different home');}
    const known=new Set(all.flatMap(r=>[r.record.sessionId,r.record.cliSessionId]));for(const id of opts.include)if(!known.has(id))throw Error('Selected session ID not found');
    for(const [desktopId,group]of [...groups].sort(([a],[b])=>a.localeCompare(b))) {
      const cliIds=[...new Set(group.map(r=>r.record.cliSessionId))].sort();
      let choices=cliIds.filter(id=>opts.include.includes(id));if(!choices.length)choices=cliIds;
      const explicitCli=choices.length===1&&opts.include.includes(choices[0]);
      const row={sessionId:desktopId,title:group[0].record.title??'Untitled',cliIds,currentTargetCli:targetRows.find(r=>r.record.sessionId===desktopId)?.record.cliSessionId??null,selectedCli:choices.length===1?choices[0]:null,status:'selected',reason:null,copies:[],classification:'unknown',canonical:null,archived:!!group[0].record.isArchived};
      row.indexFingerprints=[];for(const item of group)row.indexFingerprints.push({file:item.file,sha256:await fileHash(item.file)});row.indexFingerprints.sort((a,b)=>a.file.localeCompare(b.file));
      const skip=reason=>{row.status='skipped';row.reason=reason;};
      if(opts.include.length&&!opts.include.includes(desktopId)&&!cliIds.some(id=>opts.include.includes(id)))skip('not-selected');
      else if(opts.exclude.includes(desktopId)||cliIds.some(id=>opts.exclude.includes(id)))skip('explicitly-excluded');
      else if(cliIds.length>1&&!explicitCli)skip('cli-id-changed-or-multiple: choose an explicit CLI ID');
      // Even excluded entries are represented; their files remain covered by the input fingerprint.
      if(row.status==='selected') {
        const chosen=group.filter(r=>r.record.cliSessionId===row.selectedCli).sort((a,b)=>Number(b.record.lastActivityAt??0)-Number(a.record.lastActivityAt??0)||a.file.localeCompare(b.file))[0];
        row.indexSource=chosen.file;row.archived=!!chosen.record.isArchived;row.cwd=chosen.record.cwd;row.cwdExists=await exists(chosen.record.cwd);
        for(const file of transcripts.get(row.selectedCli)??[]) {
          try {row.copies.push({file,stats:await scanTranscript(file,{title:row.title})});}catch{skip('unreadable-or-unsupported-transcript');break;}
        }
        if(row.status==='selected') {
          const classification=await classifyCopies(row.copies);row.classification=classification.kind;row.canonical=classification.canonical;
          if(classification.kind==='missing')skip('missing-transcript');else if(classification.kind==='divergent')skip('divergent-copies');else if(row.copies.some(c=>!c.stats.bytes))skip('empty-transcript');
          else if(row.copies.some(c=>protectedByDate(c.stats,opts.protectSince,opts.timeZone)))skip('recent-or-unknown-user-activity');
          if(baseline&&row.status==='selected') {
            const old=baseline.selection.find(s=>s.sessionId===desktopId);
            if(!old)skip('new-since-baseline');else if(!equal(old.cliIds,cliIds))skip('cli-id-changed-since-baseline');
            else if(!equal(old.indexFingerprints,row.indexFingerprints))skip('index-changed-since-baseline');
            else if(!equal(old.copies.map(c=>[c.file,c.stats.sha256]),row.copies.map(c=>[c.file,c.stats.sha256])))skip('transcript-changed-since-baseline');
          }
          if(row.status==='selected') {
            const dest=path.join(targetDir,chosen.record.sessionId+'.json');
            const existing=targetRows.some(r=>r.record.sessionId===desktopId||r.record.cliSessionId===row.selectedCli);
            if(!existing){const data=recoveredRecord(chosen.record),serialized=JSON.stringify(data,null,2)+'\n';actions.push({kind:'index',path:dest,source:chosen.file,sessionId:desktopId,sha256:sha(serialized),size:Buffer.byteLength(serialized)});}
            row.indexAlreadyPresent=existing;
            if(mode==='handoff') {
              for(const c of row.copies)if(c.stats.thinkingBlocks)actions.push({kind:'transcript',path:c.file,sessionId:desktopId,expected:c.stats});
              const canonicalCopy=row.copies.find(c=>c.file===row.canonical);actions.push({kind:'document',name:row.selectedCli+'.md',source:row.canonical,sessionId:desktopId,title:row.title,sha256:canonicalCopy.stats.documentSha256,size:canonicalCopy.stats.documentBytes});
            }
          }
        }
      }
      selection.push(row);
    }
  }
  const inputs=await fingerprint([...roots]);
  const seenPaths=new Set();for(const a of actions)if(a.path){if(seenPaths.has(a.path))throw Error('Conflicting planned mutations');seenPaths.add(a.path);}
  let backupBytes=0,stageBytes=0,largestTarget=0;
  const targetAllocations=[];
  for(const a of actions) {
    if(a.path&&a.kind!=='index'){const tree=await inventory(a.path);backupBytes+=bytes(tree);if(a.kind==='leveldb')stageBytes+=bytes(tree)*2+16*1024*1024;}
    const amount=a.kind==='transcript'?a.expected.outputBytes:a.kind==='leveldb'?bytes(await inventory(a.path))*2+16*1024*1024:a.size??0;stageBytes+=amount;
    if(a.path&&amount){targetAllocations.push({directory:path.dirname(a.path),requiredBytes:amount});largestTarget=Math.max(largestTarget,amount);}
  }
  const documentBytes=actions.filter(a=>a.kind==='document').reduce((n,a)=>n+a.size,0);
  const p={schema:1,version:VERSION,id:randomUUID(),createdAt:new Date().toISOString(),home,operation:mode,options:opts,inputs,actions,selection,identity,warnings,space:{backupBytes,stageBytes,documentBytes,targetAllocations,largestTarget,allocations:[{directory:opts.backupParent,requiredBytes:backupBytes+stageBytes+4*1024*1024},{directory:opts.outputParent,requiredBytes:documentBytes+1024*1024},...targetAllocations]}};
  p.digest=planDigest(p);return p;
}
export async function revalidatePlan(saved,context={}) {
  const home=path.resolve(context.home??os.homedir());
  if(saved.home!==home||saved.schema!==1||saved.version!==VERSION||saved.digest!==planDigest(saved))throw Error('Modified, incompatible or foreign-home plan');
  const fresh=await buildPlan(saved.operation,saved.options,context);
  if(!equal(planComparable(saved),planComparable(fresh)))throw Error('Plan expired or modified: scope, account, files, permissions or keychain state changed; preview again');
  return fresh;
}
