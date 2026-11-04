import { app, BrowserWindow, dialog, ipcMain, utilityProcess, shell, Menu } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const directory = path.dirname(fileURLToPath(import.meta.url));
const demo = process.argv.includes('--demo');
let window, worker, workerAlive = false, busy = false, currentPlan, lastResult, backupRows = [];
const pending = new Map();
let ready;

function request(method, ...args) {
  return new Promise((resolve, reject) => {
    if (!workerAlive) { reject(Error('后台进程已停止，请重新启动客户端并检查备份。')); return; }
    const id = randomUUID(); pending.set(id, { resolve, reject });
    try { worker.postMessage({ id, method, args }); }
    catch { pending.delete(id); reject(Error('后台进程无法接收操作，请重新启动客户端。')); }
  });
}
async function startWorker() {
  worker = utilityProcess.fork(path.join(directory, 'worker.mjs'), [], { serviceName: 'Account maintenance engine', stdio: 'pipe' });
  workerAlive = true;
  // Do not echo worker stdout/stderr; errors are reduced to known, non-sensitive messages.
  worker.stdout?.resume(); worker.stderr?.resume();
  worker.on('message', message => {
    if (message.event) { if (!window?.isDestroyed()) window.webContents.send('maintenance:progress', message.event); return; }
    const job = pending.get(message.id); if (!job) return; pending.delete(message.id);
    if (message.error) job.reject(Error(message.error)); else job.resolve(message.result);
  });
  worker.on('exit', () => {
    workerAlive = false;
    for (const job of pending.values()) job.reject(Error('后台进程停止。请保留备份，重新启动后检查结果。'));
    pending.clear(); currentPlan = null;
  });
  const id = randomUUID();
  const init = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  const demoRoot = demo ? await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'account-reset-demo-')) : null;
  worker.postMessage({ id, method: 'init', demo, demoRoot, home: demo ? undefined : os.homedir(), storage: demo ? undefined : path.join(app.getPath('userData'), 'maintenance') });
  await init;
}
function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('拒绝未知窗口请求。');
}
async function confirm(plan, restoring) {
  const items = restoring ? plan.entries.length : plan.actions.length;
  const result = await dialog.showMessageBox(window, { type: 'warning', title: restoring ? '确认恢复这份计划' : '确认执行清理计划', message: `${demo ? '【合成资料演示】' : ''}${restoring ? '恢复' : '处理'} ${items} 项文件或状态`, detail: restoring ? plan.warning : `已选范围：登录状态${plan.traces ? '、已知缓存字段' : ''}${plan.identityRecords ? '、身份登记字段' : ''}${plan.includeKeychain ? '、共享钥匙串（文件备份无法恢复）' : ''}。\n会话正文与 thinking 保留。所有文件先备份并校验，备份不会自动删除。\n备份位置：${plan.backupParent}\n执行前将再次检查资料是否变化。`, buttons: ['返回审阅', restoring ? '确认恢复' : '确认执行'], defaultId: 0, cancelId: 0, noLink: true });
  return result.response === 1;
}
ipcMain.handle('maintenance:call', async (event, method, value) => {
  trusted(event);
  if (method === 'cancel') { worker?.postMessage({ method: 'cancel' }); return { ok: true, value: true }; }
  if (busy) return { ok: false, error: '当前操作尚未结束，请稍候。' };
  busy = true;
  try {
    await ready;
    let result;
    switch (method) {
      case 'info': result = { version: app.getVersion(), demo, platform: process.platform }; break;
      case 'discover': currentPlan = null; result = await request('discover'); break;
      case 'pick': {
        if (!['desktop', 'code'].includes(value)) throw Error('资料类型无效。');
        if (demo) throw Error('演示模式只使用已生成的合成资料。');
        const chosen = await dialog.showOpenDialog(window, { title: value === 'desktop' ? '选择 Claude Desktop 资料文件夹' : '选择 Claude Code 配置文件夹', properties: ['openDirectory', 'showHiddenFiles'] });
        result = chosen.canceled ? null : await request('addDirectory', chosen.filePaths[0], value); currentPlan = null; break;
      }
      case 'preview': currentPlan = null; result = await request('preview', value); currentPlan = result; break;
      case 'invalidate': currentPlan = null; result = await request('invalidate'); break;
      case 'execute':
      case 'restore': {
        const restoring = method === 'restore';
        if (typeof value !== 'string' || !currentPlan || currentPlan.id !== value || currentPlan.operation !== (restoring ? 'restore' : 'reset')) throw Error('计划已失效，请重新检查。');
        if (!await confirm(currentPlan, restoring)) { result = { cancelled: true }; break; }
        const id = currentPlan.id; currentPlan = null;
        result = await request(method, id); lastResult = result; break;
      }
      case 'backups': result = await request('listBackups'); backupRows = result; break;
      case 'previewRestore':
        if (typeof value !== 'string') throw Error('请选择备份。');
        currentPlan = null; result = await request('previewRestore', value); currentPlan = result; break;
      case 'reveal': {
        const target = value === 'report' ? lastResult?.report : value === 'latest-backup' ? lastResult?.backupDirectory : backupRows.find(b => b.id === value)?.path;
        if (!target) throw Error('没有可显示的本地结果。');
        shell.showItemInFolder(target); result = true; break;
      }
      default: throw Error('不支持的操作。');
    }
    return { ok: true, value: result };
  } catch (error) {
    currentPlan = null;
    // Worker messages are already sanitized. Main-process errors contain only fixed messages.
    return { ok: false, error: /^[\u3400-\u9fff]/.test(error.message ?? '') ? error.message.slice(0, 300) : '无法完成操作。请保留备份并重新检查。' };
  } finally { busy = false; }
});

app.whenReady().then(async () => {
Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] }, { label: '编辑', submenu: [{ role: 'copy' }, { role: 'selectAll' }] }]));
window = new BrowserWindow({ width: 1180, height: 820, minWidth: 880, minHeight: 650, backgroundColor: '#f5f4f0', title: 'Claude Account Reset', webPreferences: { preload: path.join(directory, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
window.webContents.on('will-navigate', event => event.preventDefault());
window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file://') && !details.url.startsWith('devtools://') }));
window.on('close', event => { if (busy) { event.preventDefault(); dialog.showMessageBox(window, { type: 'info', message: '操作仍在进行，请等待完成或使用“安全停止”。', buttons: ['知道了'] }); } });
ready = startWorker();
await window.loadFile(path.join(directory, 'dist/index.html'));
}).catch(() => { dialog.showErrorBox('客户端未能启动', '请保留备份并重新启动。启动失败不会触发自动清理。'); app.quit(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => { if (busy) { event.preventDefault(); return; } worker?.kill(); });
