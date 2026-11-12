import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { windowsProcesses } from './windows.mjs';
export function isClaudeCommand(command) {
  const executable = path.win32.basename(command.trim()).toLowerCase();
  return /Claude\.app\//i.test(command) || /\/\.local\/share\/claude\/versions\/[^/\s]+$/i.test(command.trim())
    || /\\WindowsApps\\Claude_[^\\]+__pzs8sxrjxfjjc\\/i.test(command)
    || ['claude','claude-code','claude.exe','claude-code.exe','claude-desktop.exe','claude-cli.exe'].includes(executable);
}
export function validateProcessTable(text, parent=process.ppid, { exitedParent = false } = {}) {
  const table=new Map();
  for(const line of text.split('\n')) { const m=/^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);if(m)table.set(Number(m[1]),{parent:Number(m[2]),command:m[3]}); }
  if(!table.size)throw Error('Cannot inspect process table');
  if([...table.values()].some(r=>isClaudeCommand(r.command)))throw Error('Claude Desktop/Code is running; quit it first');
  let pid=parent; const seen=new Set();
  for(let i=0;i<64;i++) {
    if(pid<=1)return;
    if(!table.has(pid)&&exitedParent)return;
    if(seen.has(pid)||!table.has(pid))throw Error('Cannot establish caller ancestry');seen.add(pid);
    const row=table.get(pid);if(isClaudeCommand(row.command))throw Error('Claude cannot clean its own data');pid=row.parent;
  }
  throw Error('Caller ancestry exceeds inspection limit');
}
export function ensureStopped() {
  if(process.platform==='win32')return validateProcessTable(windowsProcesses(), process.ppid, { exitedParent: true });
  const r=spawnSync('/bin/ps',['-axo','pid=,ppid=,comm='],{encoding:'utf8',timeout:10000});
  if(r.status!==0)throw Error('Process inspection unavailable; use a normal terminal');validateProcessTable(r.stdout);
}
export function keychainState(service='Claude Safe Storage',account='Claude Key') {
  if(process.platform!=='darwin')return 'unsupported';
  const args=['find-generic-password','-s',service,...(account?['-a',account]:[])];
  const r=spawnSync('/usr/bin/security',args,{encoding:'utf8',timeout:15000});
  return r.status===0?'present':r.status===44?'absent':'unavailable';
}
export function deleteSharedKeychain() {
  if(process.platform!=='darwin')throw Error('Keychain operation is only available on macOS');
  const before=keychainState();if(before==='unavailable')throw Error('Keychain access unavailable; not treated as absence');if(before==='absent')return 'absent';
  const r=spawnSync('/usr/bin/security',['delete-generic-password','-s','Claude Safe Storage','-a','Claude Key'],{encoding:'utf8',timeout:15000});
  if(r.status!==0||keychainState()!=='absent')throw Error('Keychain deletion could not be verified');return 'deleted';
}
