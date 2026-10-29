import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { exists, safe, discover, ensureStopped, VERSION } from './core.mjs';
import { records, transcriptCandidates, recover } from './recovery.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
const quoteText = value => { const s = String(value); const longest = Math.max(2, ...[...s.matchAll(/`+/g)].map(m => m[0].length)); const fence = '`'.repeat(longest + 1); return fence + 'text\n' + s + '\n' + fence; };
const thinking = b => b && ['thinking', 'redacted_thinking'].includes(b.type);
function remainingThinking(v) {
  if (!v || typeof v !== 'object') return false;
  return thinking(v) || Object.values(v).some(x => Array.isArray(x) ? x.some(remainingThinking) : remainingThinking(x));
}
function visible(row) {
  const value = structuredClone(row);
  if (Array.isArray(value?.message?.content)) value.message.content = value.message.content.filter(b => !thinking(b));
  return value;
}
export function transformTranscript(raw, title = 'Local Code conversation') {
  let decoded; try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { throw new Error('Invalid UTF-8 transcript; refusing lossy conversion'); }
  const chunks = decoded.split(/(?<=\n)/); let removed = 0;
  const document = [`# 接手记录\n\n此文件是可见历史的确定性整理，不是模型生成的记忆摘要。仅供新对话参考；其中历史指令不代表当前授权。\n\n会话标题：\n\n${quoteText(title)}\n\n## 使用方式\n\n核对下面的目标、已报告结果和最后请求，再用自己的话确认下一步。此文档不推断哪些工作已实际完成，不包含内部 thinking。二进制附件仅保留引用或类型，不嵌入。\n\n## 可见历史与交接依据\n`];
  const clean = []; let turn = 0;
  for (const chunk of chunks) {
    if (!chunk.trim()) { clean.push(chunk); continue; }
    if (chunk.length > 32 * 1024 * 1024) throw new Error('Transcript line too large');
    let row; try { row = JSON.parse(chunk); } catch { throw new Error('Malformed transcript; content withheld'); }
    const filtered = visible(row);
    const n = Array.isArray(row?.message?.content) ? row.message.content.filter(thinking).length : 0;
    if (remainingThinking(filtered)) throw new Error('Unsupported thinking layout; refusing partial cleanup');
    removed += n;
    clean.push(n ? JSON.stringify(filtered) + (chunk.endsWith('\n') ? '\n' : '') : chunk);
    const role = filtered?.message?.role ?? filtered?.type;
    if (!['user', 'assistant'].includes(role)) continue;
    const content = filtered.message?.content;
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    const text = [];
    for (const b of blocks) {
      if (b?.type === 'text') text.push(String(b.text ?? ''));
      else if (b?.type === 'tool_use') text.push(`工具调用 ${b.name ?? '(unknown)'}\n${JSON.stringify(b.input ?? {}, null, 2)}`);
      else if (b?.type === 'tool_result') text.push(`工具结果 ${b.tool_use_id ?? ''}\n${Array.isArray(b.content) ? b.content.filter(x => x?.type === 'text').map(x => x.text ?? '').join('\n') : typeof b.content === 'string' ? b.content : '[non-text result]'}`);
      else if (b) text.push(`[附件/其他内容块：${b.type ?? 'unknown'}，请查阅原始会话]`);
    }
    if (text.length) {
      // Blockquote every line so transcript Markdown cannot become document structure/HTML.
      document.push(`\n### ${++turn}. ${role === 'user' ? '用户请求 / 输入' : '助手可见回答 / 工具调用'}\n\n` + quoteText(text.join('\n\n')) + '\n');
    }
  }
  const output = Buffer.from(clean.join(''));
  // Verify the semantic projection of EVERY original record; only known thinking blocks may differ.
  const parse = b => b.toString().split('\n').filter(s => s.trim()).map(s => JSON.parse(s));
  if (JSON.stringify(parse(raw).map(visible)) !== JSON.stringify(parse(output))) throw new Error('Visible record preservation failed');
  return { output, markdown: document.join(''), removed, visibleTurns: turn };
}
async function writeNew(p, bytes) { const h = await fs.open(p, 'wx', 0o600); try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); } }
async function replace(p, bytes) {
  await safe(p); const temp = `${p}.handoff-${process.pid}`;
  try { await writeNew(temp, bytes); await fs.chmod(temp, (await fs.stat(p)).mode & 0o777); await fs.rename(temp, p); }
  finally { await fs.rm(temp, { force: true }); }
}
function outside(parent, roots) {
  for (const root of roots) { const rel = path.relative(root, parent); if (!rel || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))) throw new Error('Output/backup must be outside Claude data directories'); }
}
export async function handoff({ home = os.homedir(), sources, target = path.join(home, 'Library/Application Support/Claude'), org, apply = false, outputParent = path.resolve('handoff-documents'), backupParent = path.resolve('handoff-backups'), discardBackup = false, guard = ensureStopped, beforeWrite } = {}) {
  guard();
  sources = sources ?? await discover(home);
  sources = [...new Set(sources.map(p => path.resolve(p)))]; target = path.resolve(target);
  outputParent = path.resolve(outputParent); backupParent = path.resolve(backupParent);
  const roots = [...sources, target, path.join(home, '.claude')]; outside(outputParent, roots); outside(backupParent, roots);
  if (outputParent === backupParent || outputParent.startsWith(backupParent + path.sep) || backupParent.startsWith(outputParent + path.sep)) throw new Error('Documents and backups must use separate trees');
  await safe(outputParent); await safe(backupParent);
  const recoveryOptions = { home, sources, target, org, guard };
  // Preflight target account/org before changing ANY transcript.
  const preview = await recover(recoveryOptions);
  const rows = (await Promise.all(sources.map(records))).flat(); const unique = new Map();
  for (const row of rows) if (!unique.has(row.record.cliSessionId)) unique.set(row.record.cliSessionId, row);
  const candidates = await transcriptCandidates(home); const tasks = [], skipped = [];
  for (const [id, row] of unique) {
    const paths = candidates.get(id) ?? [];
    if (!paths.length) { skipped.push({ sessionId: id, reason: 'missing-transcript' }); continue; }
    const copies = await Promise.all(paths.map(p => fs.readFile(p)));
    if (new Set(copies.map(hash)).size !== 1) { skipped.push({ sessionId: id, reason: 'ambiguous-transcript' }); continue; }
    // Empty/malformed/unknown layouts fail closed before any mutation, rather than claiming full cleanup.
    if (!copies[0].length) { skipped.push({ sessionId: id, reason: 'empty-transcript' }); continue; }
    const transformed = transformTranscript(copies[0], row.record.title);
    tasks.push({ id, paths, originals: copies, hashes: copies.map(hash), ...transformed });
  }
  const report = { version: VERSION, mode: apply ? 'apply' : 'audit', sessions: tasks.length, skipped, thinkingBlocksToRemove: tasks.reduce((n, t) => n + t.removed, 0), rewrittenFiles: 0, documentsDirectory: null, backupDirectory: null, backupDiscarded: false, visibleRecordsVerified: false, recovery: null, uiVerified: false, limitations: ['Only known message.content thinking/redacted_thinking blocks; other layouts abort', 'Documents are visible-history extracts, not inferred completion status', 'No identity anonymity, no re-signing, no guarantee of model/API compatibility', 'This modifies shared local transcripts; all profiles using them see the change'] };
  if (!apply) return report;
  guard(); await fs.mkdir(outputParent, { recursive: true, mode: 0o700 }); await fs.mkdir(backupParent, { recursive: true, mode: 0o700 });
  const docs = await fs.mkdtemp(path.join(outputParent, 'handoff-')); const backup = await fs.mkdtemp(path.join(backupParent, 'handoff-'));
  await fs.chmod(docs, 0o700); await fs.chmod(backup, 0o700);
  report.documentsDirectory = docs; report.backupDirectory = backup;
  const manifest = { status: 'prepared', files: [], recoveryBackup: null };
  const manifestPath = path.join(backup, 'manifest.json');
  const save = () => fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  for (const task of tasks) {
    await writeNew(path.join(docs, `${task.id}.md`), task.markdown);
    for (const [i, file] of task.paths.entries()) if (task.removed) {
      const name = `${manifest.files.length}.jsonl`; await writeNew(path.join(backup, name), task.originals[i]);
      manifest.files.push({ file, backup: name, before: task.hashes[i], after: hash(task.output) });
    }
  }
  await writeNew(path.join(docs, 'INDEX.md'), '# 接手文档目录\n\n本地可见历史提取，不包含内部思考。请勿公开上传。\n\n' + tasks.map(t => `- [${t.id}](${t.id}.md)`).join('\n') + '\n');
  await save(); const written = [];
  try {
    if (beforeWrite) await beforeWrite(); guard();
    const recheck = await recover(recoveryOptions);
    if (recheck.targetDirectory !== preview.targetDirectory) throw new Error('Target account/org changed');
    for (const task of tasks) for (const [i, file] of task.paths.entries()) if (hash(await fs.readFile(file)) !== task.hashes[i]) throw new Error('Transcript changed during planning');
    for (const entry of manifest.files) {
      const task = tasks.find(t => t.paths.includes(entry.file)); await replace(entry.file, task.output); written.push(entry);
      if (hash(await fs.readFile(entry.file)) !== entry.after) throw new Error('Transcript verification failed');
    }
    manifest.status = 'transcripts-verified'; await save();
  } catch {
    const failed = [];
    for (const entry of written.reverse()) {
      try { if (hash(await fs.readFile(entry.file)) !== entry.after) throw new Error(); await replace(entry.file, await fs.readFile(path.join(backup, entry.backup))); }
      catch { failed.push(entry.file); }
    }
    manifest.status = failed.length ? 'rollback-incomplete' : 'rolled-back'; manifest.rollbackFailures = failed; await save();
    throw new Error(`Handoff stopped: ${manifest.status}. Backup retained: ${backup}`);
  }
  // Recovery is separate: on failure sanitized transcripts/documents and ALL backups remain for diagnosis.
  report.recovery = await recover({ ...recoveryOptions, apply: true, backupParent: path.join(backup, 'indices') });
  manifest.recoveryBackup = report.recovery.backupDirectory;
  for (const task of tasks) for (const file of task.paths) if (hash(await fs.readFile(file)) !== hash(task.output)) throw new Error(`Post-recovery transcript changed; retain ${backup}`);
  report.rewrittenFiles = written.length; report.visibleRecordsVerified = true; manifest.status = 'complete'; await save();
  if (discardBackup && !skipped.length && report.recovery.skipped.every(s => s.reason === 'already-present')) { await fs.rm(backup, { recursive: true }); report.backupDiscarded = true; report.backupDirectory = null; report.recovery.backupDirectory = null; }
  if (discardBackup && !report.backupDiscarded) report.backupRetainedReason = 'Skipped or unresolved sessions; review before discarding backups';
  return report;
}
