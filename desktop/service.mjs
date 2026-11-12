import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildPlan, savePlan } from '../lib/planner.mjs';
import { executePlan, inspectBackup, buildRestorePlan, executeRestore } from '../lib/engine.mjs';
import { discover } from '../lib/core.mjs';
import { safe, exists, within, privateDirectory } from '../lib/safety.mjs';
import { ensureStopped } from '../lib/platform.mjs';
import { isWindowsDesktopProfile } from '../lib/windows.mjs';
import { SessionLibrary } from './library.mjs';
import { environmentOverview } from './environment.mjs';

export class DesktopService {
  constructor({ home, storage, demo = false, platform = process.platform, emit = () => {} }) {
    this.home = path.resolve(home); this.storage = path.resolve(storage); this.demo = demo;
    this.platform = platform; this.emit = emit; this.directories = new Map(); this.plans = new Map(); this.backups = new Map(); this.cancelled = false;
    this.library = new SessionLibrary({storage:this.storage,check:()=>this.checkCancel(),guard:()=>{this.checkCancel();if(!this.demo)ensureStopped();},emit:this.emit});
  }
  context() {
    return { home: this.home, ...(this.demo ? { keychainState: () => 'absent', environment: {} } : {}), guard: () => { this.checkCancel(); if (!this.demo) ensureStopped(); }, checkCancelled: () => this.checkCancel(), onProgress: event => this.emit(event) };
  }
  checkCancel() { if (this.cancelled) throw Error('Desktop operation stopped by user'); }
  checkPlatform() {
    if (!['darwin','win32'].includes(this.platform)) throw Error('当前客户端支持 macOS 和 Windows。');
    if (!this.demo && process.getuid?.() === 0) throw Error('请以自己的用户身份启动客户端，不要使用管理员提权。');
  }
  register(directory, kind) {
    const found = [...this.directories].find(([, d]) => d.path === directory && d.kind === kind);
    if (found) return { id: found[0], ...found[1] };
    const id = randomUUID();
    const writable = kind==='code'||(kind==='desktop'&&(this.platform!=='win32'||isWindowsDesktopProfile(directory,this.home,this.demo?{}:process.env)));
    const item = { path: directory, kind, name: path.basename(directory), writable };
    this.directories.set(id, item); return { id, ...item };
  }
  async discover() {
    this.checkPlatform(); this.plans.clear();
    const environment=this.demo?{}:process.env;
    const desktop = await discover(this.home,environment), code = path.join(this.home, '.claude');
    const rows = desktop.map(p => this.register(p, 'desktop'));
    if (await exists(code)) { await safe(code); rows.push(this.register(code, 'code')); }
    if(this.platform==='win32'&&environment.CLAUDE_CONFIG_DIR&&path.isAbsolute(environment.CLAUDE_CONFIG_DIR)) {
      const configured=path.resolve(environment.CLAUDE_CONFIG_DIR);
      if(configured!==code) {
        try { rows.push(await this.addDirectory(configured,'code')); }
        catch { /* An unsupported path remains available for manual inspection. */ }
      }
    }
    if(this.demo&&await exists(path.join(this.home,'demo-project')))rows.push(this.register(path.join(this.home,'demo-project'),'project'));
    let processState = 'stopped';
    try { if (!this.demo) ensureStopped(); } catch { processState = 'blocked'; }
    return { directories: rows, demo: this.demo, processState, backupParent: path.join(this.storage, 'backups') };
  }
  async addDirectory(directory, kind) {
    this.checkPlatform();
    if (!['desktop', 'code','project'].includes(kind) || typeof directory !== 'string') throw Error('资料类型无效。');
    directory = path.resolve(directory); await safe(directory);
    if (!(await fs.stat(directory)).isDirectory()) throw Error('请选择文件夹。');
    if (this.demo && !within(directory, this.home)) throw Error('演示模式只能使用演示目录。');
    if(within(directory,this.storage)||within(this.storage,directory))throw Error('请选择具体 Claude 资料或项目目录，不能包含本工具的数据目录。');
    if (kind === 'desktop' && !/^Claude(?:[- ]|$)/.test(path.basename(directory)) && !await exists(path.join(directory, 'claude_desktop_config.json'))) throw Error('未识别为 Claude Desktop 资料，请核对目录。');
    if (kind === 'code' && !await exists(path.join(directory, 'projects')) && !await exists(path.join(directory, '.claude.json')) && !await exists(path.join(directory,'.credentials.json'))) throw Error('未识别为 Claude Code 配置目录。');
    this.plans.clear(); return this.register(directory, kind);
  }
  invalidate() { this.plans.clear(); return true; }
  selectedDirectories(ids){
    this.checkPlatform();if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>!this.directories.has(id)))throw Error('请明确选择已经识别或授权的目录。');
    return [...new Set(ids)].map(id=>this.directories.get(id));
  }
  async libraryScan(value){
    if(!value||Object.keys(value).some(k=>k!=='directoryIds'))throw Error('读取范围无效。');
    const dirs=this.selectedDirectories(value.directoryIds);if(!dirs.some(d=>d.kind!=='project'))throw Error('请选择 Desktop 或 Code 资料。');
    return this.library.scan(dirs);
  }
  libraryPage(value){return this.library.page(value);}
  libraryPreview(value){return this.library.preview(value);}
  libraryAnalyze(id){return this.library.analyze(id);}
  libraryMark(value){return this.library.mark(value);}
  libraryPrepare(value){return this.library.prepare(value);}
  librarySave(id,parent){return this.library.save(id,this.demo?path.join(this.storage,'exports'):parent);}
  libraryOutputs(){return this.library.outputs();}
  libraryReveal(id){return this.library.reveal(id);}
  async environment(value){
    if(!value||Object.keys(value).some(k=>k!=='directoryIds'))throw Error('读取范围无效。');
    const dirs=this.selectedDirectories(value.directoryIds);if(dirs.every(d=>d.kind==='project'))throw Error('请至少选择一份 Desktop 或 Code 资料，项目配置需关联 Code 视图。');
    return environmentOverview(dirs,{home:this.home,check:()=>this.checkCancel()});
  }
  async preview(request) {
    this.checkPlatform(); this.plans.clear();
    if (!request || Object.keys(request).some(k => !['directoryIds', 'traces', 'identityRecords', 'includeKeychain'].includes(k))) throw Error('检查选项无效。');
    if (!Array.isArray(request.directoryIds) || request.directoryIds.some(id => !this.directories.has(id))) throw Error('资料选择已失效，请重新识别。');
    for (const k of ['traces', 'identityRecords', 'includeKeychain']) if (typeof request[k] !== 'boolean') throw Error('请选择明确的处理范围。');
    if (this.demo && request.includeKeychain) throw Error('演示模式不访问或清理系统钥匙串。');
    const selected = [...new Set(request.directoryIds)].map(id => this.directories.get(id));
    if(selected.some(d=>d.kind==='project'))throw Error('项目配置目录只用于环境概览，不参与清理。');
    const profiles = selected.filter(d => d.kind === 'desktop').map(d => d.path), codeDirs = selected.filter(d => d.kind === 'code').map(d => d.path);
    if(this.platform==='win32') {
      if(!selected.length||selected.some(d=>!d.writable))throw Error('请选择 Code 目录或已识别的 Windows MSIX Desktop 资料目录。');
      if(request.traces||request.identityRecords||request.includeKeychain)throw Error('Windows 写入范围为所选资料中的已识别登录状态。');
    } else if (!profiles.length) throw Error('至少选择一份 Desktop 资料。');
    this.emit({ phase: 'planning', message: '读取选定资料并计算保护范围；不会改写原文件。' });
    const plan = await buildPlan('reset', { profiles, codeDirs, traces: request.traces, identityRecords: request.identityRecords, includeKeychain: request.includeKeychain, discardBackup: false, backupParent: path.join(this.storage, 'backups'), outputParent: path.join(this.storage, 'documents') }, this.context());
    this.checkCancel();
    await privateDirectory(path.join(this.storage,'plans'),{recursive:true});
    await savePlan(plan, path.join(this.storage, 'plans', plan.id + '.plan.json'));
    this.plans.set(plan.id, plan);
    return this.summary(plan);
  }
  summary(plan) {
    const limitations = [];
    if(this.platform==='win32'&&plan.options.profiles.length) {
      limitations.push('Desktop 仅处理已识别的配置字段和 claude.ai 登录 Cookie。其他凭据存储未检查。');
      for(const warning of plan.warnings)if(warning.startsWith('Desktop cookie'))limitations.push('Cookie 数据库格式或事务状态无法确认。请完整退出 Claude 后重新检查。');
    }
    if (plan.identity.credentialSources.some(s => s.apiKeyHelperConfigured)) limitations.push('选定 Code 配置使用外部凭据提供器。本次会保留它，之后仍可能提供登录凭据。');
    const environmentNames = [...new Set(plan.identity.credentialSources.flatMap(s => s.environmentVariableNames))];
    if (environmentNames.length) limitations.push('保留 Code 环境配置：' + environmentNames.join('、') + '。这些配置可能影响后续连接；此处不显示值。');
    if (plan.identity.keychain.codeCredentials === 'present') limitations.push('检测到 Claude Code-credentials 系统钥匙串项。本次仅检查其存在性，不会删除，可能仍可提供登录凭据。');
    if (plan.identity.keychain.codeCredentials === 'unavailable') limitations.push('无法检查 Claude Code 系统钥匙串凭据，不能将其视为不存在。');
    if (plan.identity.discoveredCodeDirectoryCandidates.some(p => !plan.options.codeDirs.includes(p))) limitations.push('发现其他 Code 资料候选目录，本次未选择的目录会保留。需要处理时请返回并手动选择。');
    const files = Object.values(plan.inputs ?? {}).flatMap(t => Object.entries(t)).filter(([, m]) => m.type === 'file');
    const desktopIds = new Set(), codeIds = new Set();
    for (const [root, entries] of Object.entries(plan.inputs ?? {})) for (const [relative, meta] of Object.entries(entries)) {
      if (meta.type !== 'file') continue;
      const file = path.join(root, relative).split(path.sep).join('/');
      if (file.includes('/claude-code-sessions/') && /local_[a-f0-9-]{36}\.json$/i.test(file)) desktopIds.add(path.basename(file));
      if (file.includes('/projects/') && /[a-f0-9-]{36}\.jsonl$/i.test(file)) codeIds.add(path.basename(file));
    }
    return { id: plan.id, createdAt: plan.createdAt, operation: 'reset', actions: plan.actions.map(a => ({ kind: a.kind, path: a.path ?? a.service, fields: a.fields ?? a.removedKeys ?? [], irreversible: a.kind === 'keychain', preservedValues: a.preserved ?? null })), protectedFiles: files.length, desktopSessions: desktopIds.size, codeSessions: codeIds.size, backupBytes: plan.space.backupBytes, stageBytes: plan.space.stageBytes, backupParent: plan.options.backupParent, includeKeychain: plan.options.includeKeychain, traces: plan.options.traces, identityRecords: plan.options.identityRecords, keychain: plan.identity.keychain.safeStorage, warnings: plan.warnings.length, limitations, preserved: ['会话正文与 thinking', '项目文件与工作目录', '未选择的资料', 'machineID', '所有既有备份'], demo: this.demo };
  }
  async execute(id) {
    this.checkPlatform(); const plan = this.plans.get(id); this.plans.clear();
    if (!plan || plan.operation !== 'reset') throw Error('计划已失效，请重新检查。');
    const result = await executePlan(plan, this.context());
    const backupId = randomUUID(); this.backups.set(backupId, result.backupDirectory);
    const report = path.join(this.storage, 'plans', plan.id + '.report.json');
    await fs.writeFile(report, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { ...result, backupId, report, demo: this.demo };
  }
  async listBackups() {
    const root = path.join(this.storage, 'backups'); this.backups.clear(); const rows = [];
    if (!await exists(root)) return rows;
    await safe(root);
    for (const entry of await fs.readdir(root, { withFileTypes: true })) if (entry.isDirectory() && /^run-[a-f0-9-]{36}$/.test(entry.name)) {
      const dir = path.join(root, entry.name), id = randomUUID(); this.backups.set(id, dir);
      try { const data = await inspectBackup(dir, this.context()); rows.push({ id, name: entry.name, path: dir, status: data.status, entries: data.entries.map(e => ({ id: e.id, path: e.path, state: e.state })), valid: true }); }
      catch { rows.push({ id, name: entry.name, path: dir, valid: false, status: '无法验证，请保留原件' }); }
    }
    return rows;
  }
  async previewRestore(id) {
    this.checkPlatform(); this.plans.clear(); const dir = this.backups.get(id);
    if (!dir) throw Error('备份选择已失效，请刷新列表。');
    const plan = await buildRestorePlan(dir, [], this.context());
    if (!plan.entries.length) throw Error('这份备份没有需要恢复的文件。');
    this.plans.set(plan.id, plan);
    return { id: plan.id, operation: 'restore', entries: plan.entries.map(e => ({ id: e.id, path: e.path })), backupDirectory: dir, warning: this.platform==='win32'?'恢复可能带回旧登录凭据。恢复前会校验访问权限并备份当前文件。':'恢复可能带回旧登录凭据。系统钥匙串无法由文件备份恢复。恢复前仍会备份当前文件。' };
  }
  async restore(id) {
    this.checkPlatform(); const plan = this.plans.get(id); this.plans.clear();
    if (!plan || plan.operation !== 'restore') throw Error('恢复计划已失效，请重新检查备份。');
    this.emit({ phase: 'restoring', message: '核对备份与当前文件，备份当前版本后恢复。' });
    return executeRestore(plan, this.context());
  }
}
