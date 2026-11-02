import { parseArgs } from 'node:util';
import path from 'node:path';
import { VERSION, writeNew, readJSON, within } from './safety.mjs';
import { buildPlan, savePlan, loadPlan } from './planner.mjs';
import { executePlan, inspectBackup, buildRestorePlan, executeRestore } from './engine.mjs';
const SPEC={help:{type:'boolean'},yes:{type:'boolean'},apply:{type:'boolean'},plan:{type:'string'},execute:{type:'string'},'plan-out':{type:'string'},report:{type:'string'},profile:{type:'string',multiple:true},source:{type:'string',multiple:true},target:{type:'string'},org:{type:'string'},'code-dir':{type:'string',multiple:true},'desktop-only':{type:'boolean'},traces:{type:'boolean'},'identity-records':{type:'boolean'},'include-keychain':{type:'boolean'},'backup-dir':{type:'string'},'output-dir':{type:'string'},'discard-backup':{type:'boolean'},session:{type:'string',multiple:true},exclude:{type:'string',multiple:true},'protect-since':{type:'string'},'time-zone':{type:'string'},baseline:{type:'string'},inspect:{type:'string'},restore:{type:'string'},entry:{type:'string',multiple:true}};
export function help(mode) {return `Claude Account Reset ${VERSION} — ${mode}\n\nDefault: preview only; quit Claude first. No real model/UI verification.\n\n${mode==='backup'?'node bin/backup.mjs --restore RUN_DIR --plan-out restore.plan.json\nnode bin/backup.mjs --execute restore.plan.json --yes':`node bin/${mode}.mjs --plan-out ${mode}.plan.json\nnode bin/${mode}.mjs --execute ${mode}.plan.json --yes`}\n\nCommon: --plan-out FILE | --execute FILE --yes | --report NEW_FILE\n--backup-dir DIR      Private run backups (default ./operation-backups)\n--discard-backup      Record in the PLAN; remove only this successful run backup\n\nreset: --profile DIR (repeat) --code-dir DIR (repeat) --desktop-only\n       --traces --identity-records --include-keychain\n       userID/device records are retained unless explicitly selected; machineID stays.\n\nrecover/handoff: --source DIR (repeat) --target DIR --org UUID --code-dir DIR\n       --session UUID (repeat) --exclude UUID (repeat)\n       --protect-since YYYY-MM-DD --time-zone Asia/Shanghai --baseline PRIOR_PLAN\n       --output-dir DIR (handoff only; default ./handoff-documents)\n\nbackup: --inspect RUN_DIR\n        --restore RUN_DIR [--entry NUMBER] --plan-out restore.plan.json\n        --execute restore.plan.json --yes\n\nOld --apply --yes alone is refused. --apply --plan FILE --yes is an alias.\nPlans/reports/backups contain private paths and metadata; never publish them.\nRestore can reintroduce login credentials. Keychain deletion cannot be restored.\n`;}
export function parseCLI(mode,argv) {
  const {values:v}=parseArgs({args:argv,options:SPEC});
  if(v.help)return {help:true};
  if(v.plan&&!v.apply)throw Error('--plan requires --apply; use --plan-out for preview');
  if(v.apply&&!v.plan)throw Error('v0.4 requires a reviewed saved plan: use --plan-out then --execute FILE --yes');
  const execute=v.execute??v.plan;
  if(v.execute&&v.plan)throw Error('Choose one execution plan');
  if(execute) {
    if(!v.yes)throw Error('Execution requires --yes');
    const allowed=new Set(['execute','plan','apply','yes','report']);if(Object.keys(v).some(k=>!allowed.has(k)))throw Error('Execution options are frozen in the plan; do not add selection/cleanup flags');
    return {execute,report:v.report};
  }
  if(v.yes)throw Error('--yes requires an execution plan');
  if(mode==='backup') {
    const allowed=new Set(['inspect','restore','entry','plan-out','report']);if(Object.keys(v).some(k=>!allowed.has(k)))throw Error('Unsupported backup option');
    if(!!v.inspect===!!v.restore)throw Error('Choose --inspect or --restore');
    const ids=(v.entry??[]).map(x=>{if(!/^\d+$/.test(x))throw Error('Invalid entry ID');return Number(x);});return {inspect:v.inspect,restore:v.restore,ids,planOut:v['plan-out'],report:v.report};
  }
  if(v.inspect||v.restore||v.entry)throw Error('Use bin/backup.mjs for backup operations');
  if(v['desktop-only']&&v['code-dir'])throw Error('Choose --desktop-only or --code-dir');
  if(v['desktop-only']&&mode!=='reset')throw Error('--desktop-only applies only to reset');
  const options={};
  const mapping={profile:'profiles',source:'sources',target:'target',org:'org','code-dir':'codeDirs',traces:'traces','identity-records':'identityRecords','include-keychain':'includeKeychain','backup-dir':'backupParent','output-dir':'outputParent','discard-backup':'discardBackup',session:'include',exclude:'exclude','protect-since':'protectSince','time-zone':'timeZone',baseline:'baseline'};
  for(const[k,name]of Object.entries(mapping))if(v[k]!==undefined)options[name]=v[k];
  if(v['desktop-only'])options.codeDirs=[];
  return {options,planOut:v['plan-out'],report:v.report};
}
function preview(plan) {
  return {version:VERSION,mode:'audit',planId:plan.id,operation:plan.operation,scope:plan.options,identity:plan.identity,actions:plan.actions.map(({expected,...a})=>a),selection:plan.selection,warnings:plan.warnings,space:plan.space,sourceFiles:Object.values(plan.inputs).reduce((n,tree)=>n+Object.values(tree).filter(v=>v.type==='file').length,0),uiVerified:false};
}
function outsideInputs(file,p) {if(!file)return;const out=path.resolve(file);if(Object.keys(p.inputs??{}).some(root=>within(out,root)))throw Error('Plan/report file must be outside inspected data');}
export async function cli(mode,argv=process.argv.slice(2)) {
  try {
    const command=parseCLI(mode,argv);if(command.help){console.log(help(mode));return;}
    if(process.platform!=='darwin'||process.getuid?.()===0)throw Error('Run on macOS as your own user, without sudo');
    let result;
    if(command.execute) {
      const raw=await readJSON(command.execute);
      if(mode==='backup') {if(raw.operation!=='restore')throw Error('Wrong plan operation');const inspection=await inspectBackup(raw.backupDirectory);if(command.report&&(within(command.report,raw.backupDirectory)||inspection.entries.some(e=>within(command.report,e.path))))throw Error('Restore report must be outside backup and target data');if(command.report)await writeNew(command.report,'');result=await executeRestore(raw);}
      else {const p=await loadPlan(command.execute);if(p.operation!==mode)throw Error('Wrong plan operation');outsideInputs(command.report,p);if(command.report)await writeNew(command.report,'');result=await executePlan(p);}
    }else if(mode==='backup') {
      if(command.inspect){result=await inspectBackup(command.inspect);if(command.report&&(within(command.report,result.backupDirectory)||result.entries.some(e=>within(command.report,e.path))))throw Error('Report must be outside backup and target data');}
      else {const p=await buildRestorePlan(command.restore,command.ids);for(const file of [command.planOut,command.report])if(file&&(within(file,p.backupDirectory)||p.entries.some(e=>within(file,e.path))))throw Error('Restore outputs must be outside backup and target data');if(command.planOut)await writeNew(command.planOut,JSON.stringify(p,null,2)+'\n');result=p;}
    }else {
      const p=await buildPlan(mode,command.options);outsideInputs(command.planOut,p);outsideInputs(command.report,p);
      if(command.planOut)await savePlan(p,command.planOut);result=preview(p);
    }
    const output=JSON.stringify(result,null,2)+'\n';
    if(command.report) {if(command.execute){const fs=await import('node:fs/promises');await fs.writeFile(command.report,output,{mode:0o600});}else await writeNew(command.report,output);}
    console.log(output);
  }catch(e){console.error('Stopped: '+e.message);process.exitCode=1;}
}
