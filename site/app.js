const modes = {
  audit: ['node bin/reset.mjs --traces', '默认只读。展示已知字段的处理计划，检查后删除临时数据库副本。'],
  reset: ['node bin/reset.mjs --apply --yes', '执行清理：移除已知登录状态，保留其他记录，并校验受保护会话文件。'],
  traces: ['node bin/reset.mjs --apply --yes --traces', '执行扩展清理：在登录状态之外，额外移除已知账号功能缓存、遥测和退出标记。'],
  'recover-audit': ['node bin/recover.mjs', '只预览可恢复的本地 Code 索引、跳过原因和 thinking 检测。请先登录目标账号并进入 Code，再退出客户端。'],
  recover: ['node bin/recover.mjs --apply --yes', '执行恢复：先备份目标索引，新增缺失记录；保留原件与 thinking，手动权限，远程控制关闭。']
};
let mode = 'audit';
const keychain = document.querySelector('#keychain');
function render() {
  const [base, description] = modes[mode];
  keychain.disabled = !['reset', 'traces'].includes(mode);
  if (keychain.disabled) keychain.checked = false;
  const command = base + (keychain.checked ? ' --include-keychain' : '');
  document.querySelector('#mode-command').textContent = command;
  document.querySelector('#copy-mode').dataset.copy = command;
  document.querySelector('#mode-description').textContent = description;
  document.querySelectorAll('[data-mode]').forEach(b => { const active = b.dataset.mode === mode; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
}
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; render(); }));
keychain.addEventListener('change', render);
let timer;
document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
  const status = document.querySelector('#status');
  try { await navigator.clipboard.writeText(b.dataset.copy); status.textContent = '命令已复制'; }
  catch { status.textContent = '无法自动复制，请选择命令文本手动复制'; }
  clearTimeout(timer); timer = setTimeout(() => { status.textContent = ''; }, 3000);
}));
