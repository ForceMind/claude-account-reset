import { DesktopService } from './service.mjs';
import { createDemo } from './demo.mjs';

let service;
const send = value => process.parentPort.postMessage(value);
process.parentPort.on('message', async ({ data }) => {
  if (data.method === 'cancel') { if (service) service.cancelled = true; return; }
  try {
    if (data.method === 'init') {
      const config = data.demo ? { ...await createDemo(data.demoRoot,{rich:data.richDemo!==false}), demo: true } : { home: data.home, storage: data.storage };
      service = new DesktopService({ ...config, emit: event => send({ event }) });
      send({ id: data.id, result: { demo: !!data.demo } }); return;
    }
    if (!service || !['discover', 'addDirectory', 'invalidate', 'preview', 'execute', 'listBackups', 'previewRestore', 'restore','libraryScan','libraryPage','libraryPreview','libraryAnalyze','libraryMark','libraryPrepare','librarySave','libraryOutputs','libraryReveal','environment'].includes(data.method)) throw Error('Unknown desktop operation');
    service.cancelled = false;
    const result = await service[data.method](...(data.args ?? []));
    send({ id: data.id, result });
  } catch (error) {
    // Never forward arbitrary exception messages, which can contain credentials or file content.
    const message = safeMessage(error.message);
    send({ id: data.id, error: message });
  }
});

function safeMessage(raw = '') {
  if (/Desktop operation stopped by user/.test(raw)) return '操作已安全停止。已生成的备份和日志会保留；请刷新备份列表后检查。';
  if (/Claude Desktop\/Code is running|Claude cannot clean/.test(raw)) return '请完全退出 Claude Desktop 和 Claude Code 后重新检查。客户端不会自动关闭它们。';
  if (/Plan expired|Modified|Concurrent|changed|conflict/i.test(raw)) return '资料或计划已发生变化，操作已停止。备份会保留；请重新检查，不要覆盖新数据。';
  if (/space|ENOSPC/i.test(raw)) return '可用磁盘空间不足，操作已停止。请保留备份，释放空间后重新检查。';
  if (/EACCES|EPERM|permission/i.test(raw)) return '没有所需访问权限，操作已停止。无法检查不代表数据不存在。';
  if (/Symlink|Unsupported file|symbolic/i.test(raw)) return '资料包含不支持的链接或文件类型，操作已停止。';
  if (/Unsupported thinking|UTF-8|transcript|line exceeds/i.test(raw)) return '历史格式或编码不受支持，已停止本次读取或导出。原始历史未改写。';
  if (/^([\u3400-\u9fff])/.test(raw)) return raw.slice(0, 240);
  if (/keychain/i.test(raw)) return '钥匙串操作无法验证，操作已停止。请保留备份；文件恢复不能还原已删除的钥匙串项。';
  return '无法完成本次操作，未完成的步骤不会标记为成功。请保留备份并查看本地操作记录。';
}
