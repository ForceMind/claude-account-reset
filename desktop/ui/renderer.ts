type Row = { id: string; path: string; name: string; kind: 'desktop' | 'code' };
type Action = { kind: string; path: string; fields: string[]; irreversible: boolean; preservedValues: number | null };
type Plan = { id: string; operation: 'reset' | 'restore'; actions: Action[]; protectedFiles: number; desktopSessions: number; codeSessions: number; backupBytes: number; stageBytes: number; backupParent: string; keychain: string; includeKeychain: boolean; limitations: string[]; entries?: {path: string}[]; warning?: string };
type Backup = { id: string; name: string; path: string; status: string; valid: boolean; entries?: {state: string}[] };
interface Window { maintenance: { call(method: string, value?: unknown): Promise<{ ok: boolean; value?: any; error?: string }>; onProgress(callback: (event: any) => void): () => void } }

const content = document.querySelector('#content')!;
let rows: Row[] = [], selected = new Set<string>(), plan: Plan | null = null, demo = false, busy = false;
let options = { traces: false, identityRecords: false, includeKeychain: false };
const $ = (id: string) => document.getElementById(id)!;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] { const e = document.createElement(tag); e.textContent = text; e.className = className; return e; }
function button(text: string, fn: () => unknown, secondary = false) { const b = node('button', text, 'button' + (secondary ? ' secondary' : '')); b.type = 'button'; b.onclick = () => void fn(); return b; }
async function call(method: string, value?: unknown) { const result = await window.maintenance.call(method, value); if (!result.ok) throw Error(result.error || '操作未完成。'); return result.value; }
function alert(message = '') { $('alert').textContent = message; $('alert').hidden = !message; }
function setBusy(value: boolean) { busy = value; document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input').forEach(e => { if (e.id !== 'cancel') e.disabled = value || (demo && e instanceof HTMLInputElement && e.name === 'includeKeychain'); }); $('progress').hidden = !value; }
async function perform(fn: () => Promise<void>) { if (busy) return; alert(); setBusy(true); try { await fn(); } catch (error) { plan = null; alert((error as Error).message); } finally { setBusy(false); } }
function heading(title: string, detail: string) { content.replaceChildren(node('h1', title), node('p', detail, 'intro')); }
function steps(current: number) { const e = node('div', '', 'steps'); ['选择资料', '审阅计划', '备份与执行', '查看结果'].forEach((s, i) => { if (i) e.append(node('span', '', 'step-line')); const t = node('span', '', 'step' + (i === current ? ' current' : '')); t.append(node('b', String(i + 1)), document.createTextNode(s)); e.append(t); }); content.append(e); }
function card(title: string, detail?: string) { const c = node('div', '', 'card'); c.append(node('h2', title)); if (detail) c.append(node('p', detail, 'caption')); content.append(c); return c; }
function actions(...buttons: HTMLElement[]) { const e = node('div', '', 'actions'); e.append(...buttons); content.append(e); }
function invalidate() { plan = null; void call('invalidate').catch(() => {}); }
function resetView() {
  $('nav-reset').classList.add('active'); $('nav-backups').classList.remove('active'); $('breadcrumb').textContent = '账号维护 / 检查与清理';
  heading('换个账号，保留已有对话。', '先查看本机资料，再审阅具体变更。每一次执行都会先备份并校验。'); steps(0);
  const source = card('01　选择要检查的资料', '不会默认扩大到未选择的目录。首版至少选择一份 Desktop 资料；Code 资料可选。');
  if (!rows.length) source.append(node('div', '尚未识别资料。点击下方按钮开始，或手动选择文件夹。', 'empty'));
  for (const row of rows) {
    const label = node('label', '', 'source-row'), checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(row.id);
    checkbox.onchange = () => { if (checkbox.checked) selected.add(row.id); else selected.delete(row.id); invalidate(); };
    const text = node('div'); const title = node('strong', row.name); title.append(node('span', row.kind === 'desktop' ? 'DESKTOP' : 'CODE', 'tag')); text.append(title, node('span', row.path, 'path')); label.append(checkbox, text); source.append(label);
  }
  const tools = node('div', '', 'actions'); tools.append(button('识别本机资料', discover, true));
  if (!demo) for (const [kind, title] of [['desktop', '选择 Desktop 文件夹'], ['code', '选择 Code 文件夹']] as const) tools.append(button(title, () => perform(async () => { const row = await call('pick', kind); if (row) { rows = [...rows.filter(r => r.id !== row.id), row]; resetView(); } }), true));
  source.append(tools);
  const settings = card('02　选择处理范围', '默认只处理已知登录状态，不改写会话正文。以下额外范围均须明确选择。');
  const descriptions = { traces: ['已知缓存与遥测字段', '仅处理现有规则识别的字段，不是全盘缓存删除。'], identityRecords: ['本地身份登记字段', '额外处理 userID、ant-did 等已知登记；不更改 machineID。'], includeKeychain: ['共享钥匙串项', demo ? '演示模式禁用；不会访问真实系统钥匙串。' : '影响 Claude Safe Storage。文件备份不能恢复此项，执行时需再次确认。'] };
  for (const key of Object.keys(descriptions) as (keyof typeof descriptions)[]) {
    const label = node('label', '', 'option'), input = node('input'); input.type = 'checkbox'; input.name = key; input.checked = options[key]; input.disabled = demo && key === 'includeKeychain'; input.onchange = () => { options[key] = input.checked; invalidate(); };
    const text = node('div'); text.append(node('strong', descriptions[key][0]), node('small', descriptions[key][1])); label.append(input, text); settings.append(label);
  }
  settings.append(node('div', '始终保留：会话正文、thinking、项目文件和所有既有备份。', 'protected'));
  actions(button('生成只读检查与计划 →', () => perform(async () => { plan = await call('preview', { directoryIds: [...selected], ...options }); planView(); })));
}
async function discover() { return perform(async () => { const result = await call('discover'); rows = result.directories; selected.clear(); resetView(); if (result.processState === 'blocked') alert('检测到 Claude 运行或进程状态无法确认。可以选择目录；请完全退出 Claude 后再生成计划。'); }); }
function bytes(n: number) { return n < 1048576 ? Math.ceil(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
function planView() {
  if (!plan) return; const p = plan;
  heading('先看清楚，再决定。', '这是本次选定范围的检查结果。原始账号与会话文件尚未改写。'); steps(1);
  const stats = node('div', '', 'stats'); for (const [v, label] of [[p.actions.length, '计划处理项'], [p.protectedFiles, '纳入保护校验的文件'], [bytes(p.backupBytes), '原件备份大小']] as const) { const s = node('div', '', 'stat'); s.append(node('strong', String(v)), node('small', label)); stats.append(s); } content.append(stats);
  const keep = card('会保留什么', `识别到桌面索引 ${p.desktopSessions} 条、Code 正文 ${p.codeSessions} 份；两项可能指向同一会话，不能相加。`); keep.append(node('div', '用户消息、回答、工具记录、thinking、项目文件，以及未选择的资料。', 'protected'));
  const changes = card('本次会修改什么', '仅列出路径与字段名，不显示 Token、Cookie 内容或对话正文。');
  if (!p.actions.length) changes.append(node('p', '没有符合当前规则的清理项。可以返回调整选择。', 'caption'));
  const labels: Record<string, string> = { json: '移除已知字段', delete: '删除已知登录状态文件', leveldb: '精确处理 Local Storage', keychain: '删除共享钥匙串项' };
  for (const a of p.actions) { const row = node('div', '', 'plan-item'); row.append(node('strong', labels[a.kind] || a.kind), node('span', a.path, 'path')); if (a.fields.length) row.append(node('p', a.fields.join('、'))); if (a.preservedValues !== null) row.append(node('p', `保留 ${a.preservedValues} 条其他键值，并逐项校验。`)); if (a.irreversible) row.append(node('p', '此项无法由文件备份恢复。', 'warning')); changes.append(row); }
  const backup = card('备份与影响', `还需暂存空间约 ${bytes(p.stageBytes)}，执行前会再次核对空间和资料状态。`); backup.append(node('span', p.backupParent, 'path'), node('p', '备份会保留，可在“备份与恢复”中检查。常规检查不覆盖浏览器、硬件密钥或服务端记录。', 'caption'));
  if (p.keychain === 'unavailable') backup.append(node('p', '钥匙串状态无法读取，不能将其视为已清理。', 'warning'));
  for (const message of p.limitations) backup.append(node('p', message, 'warning'));
  actions(button('返回调整', () => { invalidate(); resetView(); }, true), button('确认计划并继续…', () => perform(async () => { const result = await call('execute', p.id); if (!result.cancelled) resultView(result); })));
}
function resultView(result: any) {
  if (result.cancelled) return;
  plan = null; heading('本次处理已完成。', '本地文件和保护范围校验通过。原始备份已保留。'); steps(3);
  content.append(node('div', '✓', 'result-icon'));
  const c = card('结果与保留项'); c.append(node('p', `完成 ${result.changes?.length ?? 0} 项处理；会话正文与 thinking 保留。`), node('p', '界面恢复与真实模型续聊未验证；不代表服务端账号状态或所有未知记录已清空。', 'caption'));
  if (result.keychainIrreversible) c.append(node('div', '本次包含钥匙串删除。文件恢复无法还原该项。', 'warning'));
  c.append(node('span', result.backupDirectory, 'path'));
  actions(button('在 Finder 显示报告', () => perform(async () => { await call('reveal', 'report'); }), true), button('查看备份与恢复', backupsView));
}
async function backupsView() { return perform(async () => {
  const backups: Backup[] = await call('backups');
  $('nav-reset').classList.remove('active'); $('nav-backups').classList.add('active'); $('breadcrumb').textContent = '账号维护 / 备份与恢复';
  heading('每次操作，都留有原件。', '这里只列出此客户端保存的批次。不会自动删除备份；恢复也需要先审阅计划。');
  if (!backups.length) card('还没有本地批次', '完成一次操作后，备份会显示在这里。');
  for (const b of backups) {
    const status = b.status === 'complete' ? '备份完整，校验通过' : b.status === 'partial-or-stopped' ? '批次未完成，原始备份保留' : '请保留原件并检查批次记录';
    const c = card(b.valid ? '已校验的本地备份' : '备份需要检查', status); c.append(node('span', b.path, 'path'));
    const states = b.entries ?? []; if (states.some(e => e.state === 'conflict')) c.append(node('p', '当前资料包含新变化。恢复会停止，不会覆盖新数据。', 'warning'));
    const bar = node('div', '', 'actions'); bar.append(button('在 Finder 显示', () => perform(async () => { await call('reveal', b.id); }), true));
    if (b.valid) bar.append(button('检查恢复计划', () => perform(async () => { plan = await call('previewRestore', b.id); restoreView(); }), true));
    c.append(bar);
  }
  actions(button('刷新备份', backupsView, true));
}); }
function restoreView() {
  if (!plan) return; const p = plan;
  heading('恢复前，再核对一次。', '只恢复本批次允许的原始路径。与新数据冲突时会停止。');
  const c = card(`计划恢复 ${p.entries?.length ?? 0} 项`); c.append(node('div', p.warning, 'warning'));
  for (const e of p.entries ?? []) c.append(node('span', e.path, 'path'));
  actions(button('返回备份列表', backupsView, true), button('确认恢复…', () => perform(async () => { const result = await call('restore', p.id); if (!result.cancelled) { heading('文件恢复已完成。', `恢复 ${result.restored} 项。恢复前的当前版本也已备份。`); const c = card('当前版本备份位置'); c.append(node('span', result.currentStateBackup, 'path')); actions(button('返回备份列表', backupsView)); } })));
}
const phases: Record<string, string> = { planning: '正在生成只读计划', 'backing-up': '正在备份与校验原件', staging: '正在生成并校验暂存结果', applying: '正在执行已确认的计划', complete: '正在核对处理结果', restoring: '正在备份当前版本并恢复' };
window.maintenance.onProgress(e => { $('progress-title').textContent = phases[e.phase] || '正在处理'; $('progress-message').textContent = e.message || (typeof e.total === 'number' ? `${e.completed} / ${e.total} 项 · 请保持客户端打开。` : '请保持客户端打开。'); });
$('cancel').onclick = () => { void call('cancel'); $('progress-message').textContent = '已请求安全停止，等待当前文件步骤结束。备份将保留。'; };
$('nav-reset').onclick = () => { if (!busy) { alert(); invalidate(); resetView(); } };
$('nav-backups').onclick = () => void backupsView();
void perform(async () => { const info = await call('info'); demo = info.demo; $('demo').hidden = !demo; $('version').textContent = `v${info.version} · ${demo ? '合成资料演示' : 'macOS 客户端'}`; resetView(); });
