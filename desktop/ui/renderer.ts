type Row = { id: string; path: string; name: string; kind: 'desktop' | 'code' | 'project'; writable: boolean };
type Action = { kind: string; path: string; fields: string[]; irreversible: boolean; preservedValues: number | null };
type Plan = { id: string; operation: 'reset' | 'restore'; actions: Action[]; protectedFiles: number; desktopSessions: number; codeSessions: number; backupBytes: number; stageBytes: number; backupParent: string; keychain: string; includeKeychain: boolean; limitations: string[]; entries?: {path: string}[]; warning?: string };
type Backup = { id: string; name: string; path: string; status: string; valid: boolean; entries?: {state: string}[] };
interface Window { maintenance: { call(method: string, value?: unknown): Promise<{ ok: boolean; value?: any; error?: string }>; onProgress(callback: (event: any) => void): () => void } }

const content = document.querySelector('#content')!;
let rows: Row[] = [], selected = new Set<string>(), plan: Plan | null = null, demo = false, busy = false, windowsClient = false;
let options = { traces: false, identityRecords: false, includeKeychain: false };
const $ = (id: string) => document.getElementById(id)!;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] { const e = document.createElement(tag); e.textContent = text; e.className = className; return e; }
function button(text: string, fn: () => unknown, secondary = false) { const b = node('button', text, 'button' + (secondary ? ' secondary' : '')); b.type = 'button'; b.onclick = () => void fn(); return b; }
async function call(method: string, value?: unknown) { const result = await window.maintenance.call(method, value); if (!result.ok) throw Error(result.error || '操作未完成。'); return result.value; }
function alert(message = '') { $('alert').textContent = message; $('alert').hidden = !message; }
function setBusy(value: boolean) { busy = value; document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('button,input,select,textarea').forEach(e => { if (e.id !== 'cancel') e.disabled = value || (demo && e instanceof HTMLInputElement && e.name === 'includeKeychain'); }); $('progress').hidden = !value; }
async function perform(fn: () => Promise<void>) { if (busy) return; alert(); $('progress-title').textContent='正在处理当前操作'; $('progress-message').textContent='仅处理当前选择，请稍候。'; setBusy(true); try { await fn(); } catch (error) { plan = null; alert((error as Error).message); } finally { setBusy(false); } }
function heading(title: string, detail: string) { content.replaceChildren(node('h1', title), node('p', detail, 'intro')); }
function steps(current: number) { const e = node('div', '', 'steps'); ['选择资料', '审阅计划', '备份与执行', '查看结果'].forEach((s, i) => { if (i) e.append(node('span', '', 'step-line')); const t = node('span', '', 'step' + (i === current ? ' current' : '')); t.append(node('b', String(i + 1)), document.createTextNode(s)); e.append(t); }); content.append(e); }
function card(title: string, detail?: string) { const c = node('div', '', 'card'); c.append(node('h2', title)); if (detail) c.append(node('p', detail, 'caption')); content.append(c); return c; }
function actions(...buttons: HTMLElement[]) { const e = node('div', '', 'actions'); e.append(...buttons); content.append(e); }
function invalidate() { plan = null; void call('invalidate').catch(() => {}); }
function activate(view:string){for(const key of ['sessions','environment','reset','backups'])$('nav-'+key).classList.toggle('active',key===view);$('breadcrumb').textContent='本地工作区 / '+({sessions:'会话',environment:'环境概览',reset:'检查与清理',backups:'备份与恢复'} as Record<string,string>)[view];}
function resetView() {
  activate('reset');
  heading('换个账号，保留已有对话。', '先查看本机资料，再审阅具体变更。每一次执行都会先备份并校验。'); steps(0);
  const sources = rows.filter(row => windowsClient ? row.writable : row.kind !== 'project');
  const source = card('选择要检查的资料', windowsClient ? '选择 Code 配置目录或已识别的 MSIX Desktop 资料。' : '选择一份 Desktop 资料。也可同时选择 Code 资料。');
  if (!sources.length) source.append(node('div', '尚未识别资料。点击下方按钮开始，或手动选择文件夹。', 'empty'));
  for (const row of sources) {
    const label = node('label', '', 'source-row'), checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(row.id);
    checkbox.onchange = () => { if (checkbox.checked) selected.add(row.id); else selected.delete(row.id); invalidate(); };
    const text = node('div'); const title = node('strong', row.name); title.append(node('span', row.kind === 'desktop' ? 'DESKTOP' : 'CODE', 'tag')); text.append(title, node('span', row.path, 'path')); label.append(checkbox, text); source.append(label);
  }
  const tools = node('div', '', 'actions'); tools.append(button('识别本机资料', discover, true));
  if (!demo) for (const [kind, title] of [['desktop', '选择 Desktop 文件夹'], ['code', '选择 Code 文件夹']] as const) {
    tools.append(button(title, () => perform(async () => { const row = await call('pick', kind); if (row) { rows = [...rows.filter(r => r.id !== row.id), row]; resetView(); if(windowsClient&&!row.writable)alert('该资料可在会话与环境页面查看。当前清理范围支持 Code 和已识别的 MSIX Desktop 目录。'); } }), true));
  }
  source.append(tools);
  const settings = card('处理范围', windowsClient ? '清理所选目录中已识别的登录状态。' : '默认只处理已知登录状态。额外范围均须明确选择。');
  const descriptions = { traces: ['已知缓存与遥测字段', '仅处理现有规则识别的字段，不是全盘缓存删除。'], identityRecords: ['本地身份登记字段', '额外处理 userID、ant-did 等已知登记；不更改 machineID。'], includeKeychain: ['共享钥匙串项', demo ? '演示模式禁用；不会访问真实系统钥匙串。' : '影响 Claude Safe Storage。文件备份不能恢复此项，执行时需再次确认。'] };
  for (const key of (windowsClient ? [] : Object.keys(descriptions)) as (keyof typeof descriptions)[]) {
    const label = node('label', '', 'option'), input = node('input'); input.type = 'checkbox'; input.name = key; input.checked = options[key]; input.disabled = demo && key === 'includeKeychain'; input.onchange = () => { options[key] = input.checked; invalidate(); };
    const text = node('div'); text.append(node('strong', descriptions[key][0]), node('small', descriptions[key][1])); label.append(input, text); settings.append(label);
  }
  settings.append(node('div', '始终保留：会话正文、thinking、项目文件和所有既有备份。', 'protected'));
  actions(button('生成只读检查与计划 →', () => perform(async () => { plan = await call('preview', { directoryIds: sources.filter(r=>selected.has(r.id)).map(r=>r.id), ...options }); planView(); })));
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
  const labels: Record<string, string> = { json: '移除已知字段', delete: '删除已知登录状态文件', leveldb: '精确处理 Local Storage', keychain: '删除共享钥匙串项', 'desktop-cookies': '移除已识别的登录 Cookie' };
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
  actions(button('打开报告所在目录', () => perform(async () => { await call('reveal', 'report'); }), true), button('查看备份与恢复', backupsView));
}
async function backupsView() { return perform(async () => {
  const backups: Backup[] = await call('backups');
  activate('backups');
  heading('每次操作，都留有原件。', '这里只列出此客户端保存的批次。不会自动删除备份；恢复也需要先审阅计划。');
  if (!backups.length) card('还没有本地批次', '完成一次操作后，备份会显示在这里。');
  for (const b of backups) {
    const status = b.status === 'complete' ? '备份完整，校验通过' : b.status === 'partial-or-stopped' ? '批次未完成，原始备份保留' : '请保留原件并检查批次记录';
    const c = card(b.valid ? '已校验的本地备份' : '备份需要检查', status); c.append(node('span', b.path, 'path'));
    const states = b.entries ?? []; if (states.some(e => e.state === 'conflict')) c.append(node('p', '当前资料包含新变化。恢复会停止，不会覆盖新数据。', 'warning'));
    const bar = node('div', '', 'actions'); bar.append(button('打开备份所在目录', () => perform(async () => { await call('reveal', b.id); }), true));
    if (b.valid) bar.append(button('检查恢复计划', () => perform(async () => { plan = await call('previewRestore', b.id); restoreView(); }), true));
    c.append(bar);
  }
  const outputs=await call('libraryOutputs');
  if(outputs.length){card('会话导出与资料备份','这些是独立文件副本，不会直接替换 Claude 数据。保存时通过校验，之后的外部修改尚未复查。');for(const o of outputs){const c=card(o.kind==='backup'?'会话资料备份':'Markdown 文档',`${o.files} 份正文 · ${new Date(o.createdAt).toLocaleString()}`);c.append(node('span',o.path,'path'),button('显示保存文件夹',()=>perform(async()=>{await call('libraryReveal',o.id);}),true));}}
  actions(button('刷新备份', backupsView, true));
}); }
function restoreView() {
  if (!plan) return; const p = plan;
  heading('恢复前，再核对一次。', '只恢复本批次允许的原始路径。与新数据冲突时会停止。');
  const c = card(`计划恢复 ${p.entries?.length ?? 0} 项`); c.append(node('div', p.warning, 'warning'));
  for (const e of p.entries ?? []) c.append(node('span', e.path, 'path'));
  actions(button('返回备份列表', backupsView, true), button('确认恢复…', () => perform(async () => { const result = await call('restore', p.id); if (!result.cancelled) { heading('文件恢复已完成。', `恢复 ${result.restored} 项。恢复前的当前版本也已备份。`); const c = card('当前版本备份位置'); c.append(node('span', result.currentStateBackup, 'path')); actions(button('返回备份列表', backupsView)); } })));
}
type SessionRow={id:string;title:string;project:string;lastActivity:string|null;fileUpdated:string|null;archived:string;issues:string[];classification:string;mark:{favorite:boolean;note:string};indexCount:number;copies:{id:string;path:string;bytes:number}[]};
let libraryRows:SessionRow[]=[],libraryProjects:string[]=[],libraryTotal=0,libraryNext:number|null=null,libraryOffset=0,libraryLoaded=false,libraryIssues:{path:string;message:string}[]=[],libraryChecked=new Set<string>(),libraryDetail:SessionRow|null=null;
let filters={query:'',project:'',filter:'all'},sourcesOpen=true,environmentData:any=null;
const classification:Record<string,string>={unchecked:'多个副本，待比较',single:'单份正文',missing:'正文缺失',identical:'完全相同的副本','prefix-snapshots':'前缀快照',divergent:'分叉副本，分别保留'};
function resetCatalogue(){libraryRows=[];libraryLoaded=false;libraryChecked.clear();libraryDetail=null;environmentData=null;}
function sourcePanel(view:'sessions'|'environment'){
  const allowed=rows.filter(r=>view==='environment'||r.kind!=='project');
  if(!sourcesOpen&&allowed.length&&(view==='sessions'?libraryLoaded:!!environmentData)){
    const strip=node('div','','scope-strip');strip.append(node('span',`已选择 ${allowed.filter(r=>selected.has(r.id)).length} 个资料目录 · 只读来源`),button('更改资料范围',()=>{sourcesOpen=true;view==='sessions'?sessionsView():environmentView();},true));content.append(strip);return;
  }
  const c=card('资料范围','仅在点击读取后检查已勾选的资料。浏览不会改写 Claude 文件。');
  if(!allowed.length)c.append(node('p','尚未识别资料；可以识别本机目录或手动授权。','caption'));
  for(const row of allowed){const label=node('label','','source-row'),input=node('input');input.type='checkbox';input.checked=selected.has(row.id);input.onchange=()=>{input.checked?selected.add(row.id):selected.delete(row.id);resetCatalogue();view==='sessions'?sessionsView():environmentView();};const text=node('div');text.append(node('strong',row.name+' · '+({desktop:'Desktop',code:'Code',project:'项目配置'}[row.kind])),node('span',row.path,'path'));label.append(input,text);c.append(label);}
  const toolbar=node('div','','actions');
  toolbar.append(button('识别资料目录',()=>perform(async()=>{const found=await call('discover');rows=found.directories;selected.clear();resetCatalogue();view==='sessions'?sessionsView():environmentView();}),true));
  if(!demo)for(const kind of (view==='environment'?['desktop','code','project']:['desktop','code']) as Row['kind'][]){toolbar.append(button('添加'+({desktop:' Desktop',code:' Code',project:'项目目录'}[kind]),()=>perform(async()=>{const row=await call('pick',kind);if(row){rows=[...rows.filter(r=>r.id!==row.id),row];resetCatalogue();view==='sessions'?sessionsView():environmentView();}}),true));}
  toolbar.append(button(view==='sessions'?'读取选中会话':'读取环境概览',()=>perform(async()=>{
    const directoryIds=allowed.filter(r=>selected.has(r.id)).map(r=>r.id);
    if(view==='sessions'){const result=await call('libraryScan',{directoryIds});libraryIssues=result.issues;libraryLoaded=true;libraryChecked.clear();libraryDetail=null;await loadPage(0);sourcesOpen=false;sessionsView();}
    else {environmentData=await call('environment',{directoryIds});sourcesOpen=false;environmentView();}
  })));
  c.append(toolbar);
}
async function loadPage(offset:number){const result=await call('libraryPage',{...filters,offset});libraryRows=result.rows;libraryProjects=result.projects;libraryTotal=result.total;libraryNext=result.next;libraryOffset=result.offset;return result;}
function sessionsView(){
  activate('sessions');heading('把历史，放在手边。','按项目找会话，保留每份原始历史。这里的收藏和备注只属于本工具。');sourcePanel('sessions');
  if(!libraryLoaded){card('等待读取本地资料','支持 Desktop Code 索引与 Code 主会话正文。云端聊天、Cowork 未知格式和独立子代理不在本版列表范围。');return;}
  const bar=card(`本地会话 · ${libraryTotal} 条`,`已选择 ${libraryChecked.size} 条。重复副本按关联分组，存在分叉时不会合并。`),controls=node('div','','filter-bar');
  const query=node('input');query.placeholder='搜索标题或项目';query.value=filters.query;query.setAttribute('aria-label','搜索标题或项目');
  const project=node('select');project.setAttribute('aria-label','项目目录筛选');for(const value of ['',...libraryProjects]){const option=node('option',value||'全部项目');option.value=value;option.selected=value===filters.project;project.append(option);}
  const select=node('select');select.setAttribute('aria-label','会话状态筛选');for(const [value,label]of [['all','全部会话'],['favorite','已收藏'],['issues','异常或多副本'],['archived','归档或混合归档']]){const o=node('option',label);o.value=value;o.selected=value===filters.filter;select.append(o);}
  const search=()=>perform(async()=>{filters={query:query.value,project:project.value,filter:select.value};libraryDetail=null;await loadPage(0);sessionsView();});query.onkeydown=e=>{if(e.key==='Enter')void search();};controls.append(query,project,select,button('筛选',search,true));bar.append(controls);
  const grid=node('div','','session-grid'),list=node('div','','session-list'),detail=node('div','','session-detail');content.append(grid);grid.append(list,detail);
  if(!libraryRows.length)list.append(node('p','没有匹配的会话。','empty'));
  for(const row of libraryRows){
    const item=node('div','','session-row'+(row.id===libraryDetail?.id?' selected':'')),check=node('input');check.type='checkbox';check.checked=libraryChecked.has(row.id);check.setAttribute('aria-label','选择 '+row.title);check.onchange=()=>{check.checked?libraryChecked.add(row.id):libraryChecked.delete(row.id);sessionsView();};
    const text=node('div');text.append(button((row.mark.favorite?'★ ':'')+row.title,()=>{libraryDetail=row;sessionsView();},true),node('span',row.project,'path'),node('p',row.lastActivity?'最后活动 '+new Date(row.lastActivity).toLocaleString():row.fileUpdated?'活动时间未知 · 文件更新时间 '+new Date(row.fileUpdated).toLocaleString():'活动时间未记录','caption'),node('p',classification[row.classification]??row.classification,row.classification==='missing'?'issue-text':'caption'));const issues=row.issues.filter(s=>s!==classification[row.classification]);if(issues.length)text.append(node('p',issues.join('；'),'issue-text'));item.append(check,text);list.append(item);
  }
  if(libraryDetail)renderDetail(detail,libraryDetail);else detail.append(node('h2','选择一条会话'),node('p','查看可见记录、比较副本，或添加本工具内的备注。','caption'));
  const page=node('div','','actions');if(libraryOffset>0)page.append(button('上一页',()=>perform(async()=>{await loadPage(Math.max(0,libraryOffset-40));sessionsView();}),true));if(libraryNext!==null)page.append(button('下一页',()=>perform(async()=>{await loadPage(libraryNext!);sessionsView();}),true));page.append(button('选择本页',()=>{for(const r of libraryRows)libraryChecked.add(r.id);sessionsView();},true));content.append(page);
  if(libraryIssues.length){const c=card(`有 ${libraryIssues.length} 项未正常读取`,'未将损坏、链接或未知格式当作空会话。');for(const issue of libraryIssues.slice(0,12))c.append(node('p',issue.message,'caption'),node('span',issue.path,'path'));if(libraryIssues.length>12)c.append(node('p','其余项目请缩小目录范围后检查。','caption'));}
  actions(button('导出选中会话为 Markdown',()=>prepareSave('markdown'),true),button('备份选中会话资料',()=>prepareSave('backup')));
}
function renderDetail(panel:HTMLElement,row:SessionRow){
  panel.append(node('h2',row.title),node('p',`${row.copies.length} 份正文 · ${row.indexCount} 份索引 · ${row.archived==='archived'?'原记录为归档':row.archived==='mixed'?'不同索引的归档标记不一致':'原记录未全部归档'}`,'caption'));
  const note=node('textarea');note.value=row.mark.note;note.maxLength=2000;note.placeholder='只保存在本工具中的备注';note.setAttribute('aria-label','会话备注');panel.append(note);
  const saveMark=(favorite:boolean)=>perform(async()=>{await call('libraryMark',{id:row.id,favorite,note:note.value});await loadPage(libraryOffset);libraryDetail=libraryRows.find(r=>r.id===row.id)??null;sessionsView();});
  panel.append(button(row.mark.favorite?'取消收藏':'收藏会话',()=>saveMark(!row.mark.favorite),true),button('保存备注',()=>saveMark(row.mark.favorite),true));
  if(row.copies.length)panel.append(button('比较副本与检测 thinking',()=>perform(async()=>{const analysis=await call('libraryAnalyze',row.id);row.classification=analysis.classification;sessionsView();const target=content.querySelector('.session-detail')!;target.append(node('p',`${classification[analysis.classification]} · 各副本合计 ${analysis.thinkingBlocks} 个 thinking 块（不去重）。`,'protected'));}),true));
  const preview=node('div','','transcript');
  for(const copy of row.copies){panel.append(node('span',copy.path,'path'),button('预览这份正文 · '+bytes(copy.bytes),()=>previewPage(row,copy.id,null,preview),true));}
  if(row.copies.length||row.indexCount)panel.append(button('打开源文件所在目录',()=>perform(async()=>{await call('libraryReveal',row.id);}),true));panel.append(preview);
}
async function previewPage(row:SessionRow,copyId:string,cursor:string|null,target:HTMLElement){return perform(async()=>{const page=await call('libraryPreview',{id:row.id,copyId,cursor});target.replaceChildren(node('p',page.scope,'caption'));target.append(node('p',`本页跳过 ${page.thinkingInPage} 个思考块，原文保留。`,'caption'));for(const message of page.messages){target.append(node('strong',message.role==='user'?'用户':'Claude'),node('pre',message.text));if(message.truncated)target.append(node('p','此条仅为截短预览；可导出 Markdown 查看完整可见文本。','caption'));}if(page.next)target.append(button('下一页记录',()=>previewPage(row,copyId,page.next,target),true));target.append(button('从头读取这份正文',()=>previewPage(row,copyId,null,target),true));});}
async function prepareSave(kind:'markdown'|'backup'){return perform(async()=>{
  const p=await call('libraryPrepare',{ids:[...libraryChecked],kind});heading('保存前，核对范围。','只生成独立文件副本，不改写或导入 Claude 原始资料。');const c=card(kind==='backup'?'会话资料备份':'可见历史文档',`${p.sessions} 条会话，${p.copies} 份正文副本，源文件约 ${bytes(p.bytes)}。`);for(const warning of p.warnings)c.append(node('p',warning,'caption'));
  actions(button('返回会话',sessionsView,true),button(demo?'保存到合成资料目录':'选择位置并保存',()=>perform(async()=>{const result=await call('librarySave',p.id);if(result.cancelled)return;heading('已保存独立副本。','保存与校验完成，源会话未改写。不会自动删除备份。');const c=card(result.kind==='backup'?'会话资料备份':'Markdown 文档',`${result.files} 份正文副本，附校验清单。`);c.append(node('span',result.path,'path'));if(result.registered===false)c.append(node('p','文件已保存并校验，但历史登记失败，请记住以上位置。','warning'));actions(button('显示保存文件夹',()=>perform(async()=>{await call('libraryReveal',result.id);}),true),button('返回会话',sessionsView));})));
});}
function environmentView(){
  activate('environment');heading('看懂配置，再决定下一步。','这里只读取你授权的配置，不切换账号、不改连接，也不启动模型、MCP 或凭据提供器。');sourcePanel('environment');
  if(!environmentData){card('等待读取环境信息','可以额外授权项目目录，查看项目配置；未检查的来源会标为未知。');return;}
  for(const env of environmentData.cards){const c=card(env.name+' · '+(env.kind==='desktop'?'Desktop':'Code'));c.append(node('span',env.path,'path'));const table=node('dl','','environment-values');for(const [label,value]of [['版本',env.version],['连接候选',env.connection],['模型候选',env.model],['运行状态',env.runtime],['MCP 配置',env.mcp.length?env.mcp.join('、'):'已检查文件中未发现'],['凭据来源',env.credentials.filter((s:any)=>s.configured).map((s:any)=>s.name).join('、')||'已检查文件中未发现凭据来源']])table.append(node('dt',label),node('dd',value));c.append(table);
    for(const hint of env.identity)c.append(node('p',hint.name+'：'+hint.value+' · '+hint.status,'caption'));for(const conflict of env.conflicts)c.append(node('p',conflict,'warning'));
    const details=node('details');details.append(node('summary','查看配置来源与候选值'));for(const source of env.sources)details.append(node('p',source.scope+' · '+source.state,'caption'),node('span',source.file,'path'));for(const candidate of env.candidates)details.append(node('p',candidate.scope+' · '+candidate.field+' = '+candidate.value,'caption'));c.append(details);
  }
  const limits=card('检查范围与未知项');for(const limit of environmentData.limits)limits.append(node('p',limit,'caption'));for(const issue of environmentData.issues)limits.append(node('p',issue.message,'warning'),node('span',issue.path,'path'));
}
const phases: Record<string, string> = { catalogue:'正在读取会话目录',saving:'正在保存并校验独立副本',planning: '正在生成只读计划', 'backing-up': '正在备份与校验原件', staging: '正在生成并校验暂存结果', applying: '正在执行已确认的计划', complete: '正在核对处理结果', restoring: '正在备份当前版本并恢复' };
window.maintenance.onProgress(e => { $('progress-title').textContent = phases[e.phase] || '正在处理'; $('progress-message').textContent = e.message || (typeof e.total === 'number' ? `${e.completed} / ${e.total} 项 · 请保持客户端打开。` : '请保持客户端打开。'); });
$('cancel').onclick = () => { void call('cancel'); $('progress-message').textContent = '已请求安全停止，等待当前文件步骤结束。备份将保留。'; };
$('nav-reset').onclick = () => { if (!busy) { alert(); invalidate(); resetView(); } };
$('nav-backups').onclick = () => void backupsView();
$('nav-sessions').onclick=()=>{if(!busy){alert();sessionsView();}};
$('nav-environment').onclick=()=>{if(!busy){alert();environmentView();}};
void perform(async () => { const info = await call('info'); demo = info.demo; windowsClient = info.platform === 'win32'; $('demo').hidden = !demo; $('version').textContent = `v${info.version} · ${demo ? '合成资料演示' : windowsClient ? 'Windows 客户端' : 'macOS 客户端'}`; sessionsView(); });
