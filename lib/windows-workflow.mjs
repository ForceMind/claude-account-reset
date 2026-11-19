import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { ensureStopped } from './platform.mjs';
import { auditWindows } from './windows-audit.mjs';
import { moveWindowsDirectoryWithoutOverwrite, moveWindowsFileWithoutOverwrite, verifyPrivateWindowsTree } from './windows.mjs';
import { atomicJSON, checkSpace, equal, exists, fileHash, fingerprint, inventory, privateDirectory,
  readJSON, safe, sha, within, writeNew, VERSION } from './safety.mjs';
import { transformTranscript } from './handoff.mjs';

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const history = new Set(['projects', 'sessions', 'file-history', 'attachments', 'uploads',
  'history.jsonl', 'claude-code-sessions', 'local-agent-mode-sessions', 'scratch-workspaces',
  'side-session-notes', 'git-shadow', 'cowork', 'cowork-workspaces']);
const privateRoot = home => path.join(home, '.claude-account-reset');
const sourceKey = file => sha(path.resolve(file).toLowerCase());
const checkFields = (data, fields) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || Object.keys(data).some(key => !fields.includes(key))) throw Error('Unexpected fields in Windows workflow input');
};

function historical(relative) {
  return relative !== '.' && relative.split(path.sep).some(part => history.has(part.toLowerCase()));
}

export async function listWindowsHistory(target, context = {}) {
  const { audit } = await checkedAudit(context);
  const directory = path.resolve(target);
  if (!path.isAbsolute(target) || !audit.roots.some(root => root.canMove && sourceKey(root.path) === sourceKey(directory))) {
    throw Error('Choose a confirmed Windows activity path from audit');
  }
  const entries = await inventory(directory);
  return Object.entries(entries).filter(([relative, item]) => item.type === 'file' && historical(relative))
    .map(([relative, item]) => ({ path: path.join(directory, relative), bytes: item.size }));
}

async function checkedAudit(context) {
  const home = path.resolve(context.home ?? os.homedir());
  const guard = context.guard ?? ensureStopped;
  const audit = await auditWindows(home, { ...context, guard });
  if (audit.rootStatus !== 'verified') throw Error('Windows user data roots unverified; writes refused');
  return { home, guard, audit };
}

async function openPrivateRoot(home, create = false) {
  const root = privateRoot(home);
  // Keep reports, history and originals outside Git working trees.
  for (let current = root; ; current = path.dirname(current)) {
    if (await exists(path.join(current, '.git'))) throw Error('Windows workflow storage is inside a repository');
    if (current === path.dirname(current)) break;
  }
  if (within(root, process.cwd())) throw Error('Run from the tool directory outside the private Windows storage tree');
  await safe(root);
  if (!await exists(root) && create) await privateDirectory(root);
  verifyPrivateWindowsTree(root);
  return root;
}

function runPath(root, id, operation) {
  if (typeof id !== 'string' || !uuid.test(id)) throw Error('A valid Windows workflow ID is required');
  return path.join(root, operation + '-' + id.toLowerCase());
}

function redactJSON(value, redact) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(child => redactJSON(child, redact));
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value).map(([key, child]) => [redact(key), redactJSON(child, redact)]);
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw Error('Redaction would collide with an existing key');
  return Object.fromEntries(entries);
}

function redactor(ids) {
  const replacements = new Map(ids.map((id, index) => [id, 'redacted-id-' + (index + 1)]));
  const pattern = new RegExp(ids.join('|'), 'gi');
  return text => text.replace(pattern, match => replacements.get(match.toLowerCase()));
}

async function archivePayload(entry, redact) {
  if (entry.format === 'binary') return [{ name: entry.name, sha256: await fileHash(entry.source) }];
  if ((await fs.stat(entry.source)).size > 32 * 1024 * 1024) throw Error('Selected archive text exceeds 32 MiB');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(entry.source));
  if (text.includes('\0')) throw Error('Archive text must be UTF-8');
  let content, reading;
  const expand = value => redactJSON(JSON.parse(value), redact);
  if (entry.format === 'transcript') {
    const parsed = text.split('\n').map(line => line.trim() ? JSON.stringify(expand(line)) : '').join('\n');
    const result = transformTranscript(Buffer.from(parsed), path.basename(entry.name));
    content = result.output;
    reading = result.markdown;
  } else if (entry.format === 'json') {
    // Verify known message blocks here too. Unrecognized nested thinking stops the archive.
    const result = transformTranscript(Buffer.from(JSON.stringify(expand(text))));
    content = JSON.stringify(JSON.parse(result.output), null, 2) + '\n';
  } else {
    content = redact(text);
  }
  const outputs = [{ name: entry.name, content }];
  if (reading !== undefined) outputs.push({ name: entry.name + '.md', content: reading });
  return outputs.map(item => ({ ...item, sha256: sha(item.content) }));
}

async function planArchive(spec, audit) {
  checkFields(spec, ['ids', 'files']);
  if (!Array.isArray(spec.ids) || !spec.ids.length || spec.ids.length > 100
    || spec.ids.some(id => typeof id !== 'string' || !uuid.test(id))
    || !Array.isArray(spec.files) || !spec.files.length) throw Error('Specify known account or organization UUIDs and a file list');
  const ids = [...new Set(spec.ids.map(id => id.toLowerCase()))].sort();
  const redact = redactor(ids);
  const files = [], destinations = new Set(), sources = new Set();
  for (const item of spec.files) {
    checkFields(item, ['path', 'format']);
    if (typeof item.path !== 'string' || !path.isAbsolute(item.path)
      || !['text', 'json', 'transcript', 'binary'].includes(item.format)) throw Error('Unsupported archive file entry');
    const source = path.resolve(item.path);
    const root = audit.roots.filter(root => root.canMove && within(source, root.path)
      && historical(path.relative(root.path, source))).sort((a, b) => b.path.length - a.path.length)[0];
    if (!root || sources.has(sourceKey(source))) throw Error('Select each file once from an identified history tree');
    sources.add(sourceKey(source));
    await safe(source);
    if (!(await fs.stat(source)).isFile()) throw Error('Archive selection requires regular files');
    const extension = path.extname(source).toLowerCase();
    if ((extension === '.jsonl' && item.format !== 'transcript')
      || (extension === '.json' && item.format !== 'json')
      || (['.txt', '.md', '.csv', '.log', '.xml', '.html', '.yaml', '.yml'].includes(extension) && item.format !== 'text')
      || /^(?:config|settings(?:\.local)?|\.claude|\.credentials)\.json$/i.test(path.basename(source))) {
      throw Error('Archive selection contains a configuration file or an unsupported history format');
    }
    const name = path.join(String(audit.roots.indexOf(root) + 1), redact(path.relative(root.path, source)));
    const sourceSha256 = await fileHash(source);
    const outputs = await archivePayload({ source, name, format: item.format }, redact);
    if (sourceSha256 !== await fileHash(source)) throw Error('Archive source changed during preview');
    for (const output of outputs) {
      const key = output.name.toLowerCase();
      if (destinations.has(key)) throw Error('Archive output path collision');
      destinations.add(key);
    }
    files.push({ source, name, format: item.format, sourceSha256,
      bytes: outputs.reduce((sum, output) => sum + (output.content === undefined ? 0 : Buffer.byteLength(output.content)), 0)
        + (item.format === 'binary' ? (await fs.stat(source)).size : 0),
      outputs: outputs.map(({ name, sha256 }) => ({ name, sha256 })) });
  }
  return { ids, files };
}

async function readArchive(root, id) {
  const directory = runPath(root, id, 'archive');
  await safe(directory);
  verifyPrivateWindowsTree(directory, { recursive: true });
  const manifest = await readJSON(path.join(directory, 'manifest.json'));
  if (manifest.schema !== 1 || manifest.id !== id || !Array.isArray(manifest.sources) || !manifest.sources.length
    || manifest.outputs?.['.']?.type !== 'directory'
    || !equal(manifest.outputs, await inventory(path.join(directory, 'files')))) throw Error('Archive integrity verification failed');
  return { directory, manifest };
}

async function planFresh(spec, audit, root) {
  checkFields(spec, ['paths', 'archiveId']);
  if (!Array.isArray(spec.paths) || !spec.paths.length || spec.paths.some(value => typeof value !== 'string' || !path.isAbsolute(value))) {
    throw Error('Choose explicit activity paths from the audit result');
  }
  if (audit.package === 'unverified' || audit.inaccessible.length) throw Error('Windows layout or access unverified; activity isolation refused');
  const paths = spec.paths.map(value => path.resolve(value));
  for (const [index, target] of paths.entries()) {
    if (!audit.roots.some(entry => entry.canMove && within(target, entry.path) && within(entry.path, target))
      || paths.some((other, i) => i !== index && within(target, other))) throw Error('Unverified, overlapping or excluded Windows activity path');
    await safe(target);
    if ((await fs.stat(target)).dev !== (await fs.stat(root)).dev) throw Error('Activity and private storage must be on the same volume');
  }
  const { manifest } = await readArchive(root, spec.archiveId);
  const archived = new Map(manifest.sources.map(entry => [entry.pathSha256, entry.sha256]));
  const inputs = await fingerprint(paths);
  for (const [target, entries] of Object.entries(inputs)) {
    for (const [relative, item] of Object.entries(entries)) {
      if (item.type === 'file' && historical(relative) && archived.get(sourceKey(path.join(target, relative))) !== item.sha256) {
        throw Error('Archive is missing a current history file from the selected activity paths');
      }
    }
  }
  return { paths, inputs, archiveId: spec.archiveId, package: audit.package, packageVersion: audit.packageVersion };
}

export async function previewWindowsWorkflow(operation, spec, context = {}) {
  if (!['archive', 'fresh'].includes(operation)) throw Error('Unsupported Windows workflow');
  const { home, audit } = await checkedAudit(context);
  const root = await openPrivateRoot(home, true);
  const data = operation === 'archive' ? await planArchive(spec, audit) : await planFresh(spec, audit, root);
  const id = randomUUID();
  await writeNew(path.join(root, 'plan-' + id + '.json'), JSON.stringify({ version: VERSION, id, operation, spec, data }, null, 2));
  return operation === 'archive'
    ? { id, operation, files: data.files.map(({ source, format, outputs }) => ({ source, format, outputs })),
        opaqueFiles: data.files.filter(file => file.format === 'binary').length }
    : { id, operation, archiveId: data.archiveId,
        paths: data.paths.map(target => ({ path: target, entries: Object.keys(data.inputs[target]).length })),
        package: data.package, identityVerified: false, quarantine: runPath(root, id, 'fresh') };
}

async function archive(root, id, files, ids) {
  const directory = runPath(root, id, 'archive');
  await checkSpace([{ directory: root, requiredBytes: files.reduce((sum, file) => sum + file.bytes, 0) }]);
  await privateDirectory(directory);
  const filesRoot = path.join(directory, 'files');
  await fs.mkdir(filesRoot);
  const redact = redactor(ids);
  for (const file of files) {
    const outputs = await archivePayload(file, redact);
    if (!equal(file.outputs, outputs.map(({ name, sha256 }) => ({ name, sha256 })))) throw Error('Archive source changed');
    for (const output of outputs) {
      const destination = path.resolve(filesRoot, output.name);
      if (!within(destination, filesRoot)) throw Error('Archive output escaped its root');
      await safe(destination);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      if (file.format === 'binary') await fs.copyFile(file.source, destination, 1);
      else await writeNew(destination, output.content);
      if (await fileHash(destination) !== output.sha256 || await fileHash(file.source) !== file.sourceSha256) throw Error('Archive readback failed');
    }
  }
  await writeNew(path.join(directory, 'manifest.json'), JSON.stringify({
    schema: 1, id, sources: files.map(file => ({ pathSha256: sourceKey(file.source), sha256: file.sourceSha256 })),
    outputs: await inventory(filesRoot)
  }, null, 2));
  verifyPrivateWindowsTree(directory, { recursive: true, claimNewEntries: true });
  await readArchive(root, id);
  return { status: 'archive-verified', id, directory };
}

const move = async (source, target, isDirectory) => {
  await safe(source);
  await safe(target);
  (isDirectory ? moveWindowsDirectoryWithoutOverwrite : moveWindowsFileWithoutOverwrite)(source, target);
};

async function restoreMoved(journal, directory, guard) {
  const save = () => atomicJSON(path.join(directory, 'journal.json'), journal);
  let conflict = false;
  for (const entry of journal.entries.slice().reverse()) {
    try {
      const source = path.join(directory, 'original-' + entry.index);
      if (!await exists(source)) {
        if (!equal(await inventory(entry.path), entry.before)) throw Error('Missing verified original');
        continue;
      }
      guard();
      if (await exists(entry.path) || !equal(await inventory(source), entry.before)) throw Error('Activity rollback conflict');
      await move(source, entry.path, entry.before['.'].type === 'directory');
      if (!equal(await inventory(entry.path), entry.before)) throw Error('Rollback readback failed');
    } catch {
      conflict = true;
    }
  }
  journal.status = conflict ? 'rollback-incomplete' : 'rolled-back';
  await save();
  if (conflict) throw Error('Activity rollback conflict; preserve quarantine');
}

async function locked(root, callback) {
  const lock = path.join(root, 'workflow.lock');
  await writeNew(lock, String(process.pid));
  try { return await callback(); }
  finally { await fs.unlink(lock); }
}

async function isolate(root, id, data, guard, context) {
  const directory = runPath(root, id, 'fresh');
  await privateDirectory(directory);
  const journal = { schema: 1, id, status: 'moving', archiveId: data.archiveId,
    entries: data.paths.map((target, index) => ({ index, path: target, before: data.inputs[target] })) };
  const save = () => atomicJSON(path.join(directory, 'journal.json'), journal);
  await save(); // Written before the first move, including enough information to recover after a crash.
  try {
    for (const entry of journal.entries) {
      guard();
      await context.beforeMove?.(entry);
      if (!equal(await inventory(entry.path), entry.before)) throw Error('Activity data changed since preview');
      await move(entry.path, path.join(directory, 'original-' + entry.index), entry.before['.'].type === 'directory');
    }
    guard();
    for (const entry of journal.entries) {
      if (await exists(entry.path) || !equal(await inventory(path.join(directory, 'original-' + entry.index)), entry.before)) {
        throw Error('Activity isolation readback failed');
      }
    }
    await readArchive(root, data.archiveId);
    const after = (await checkedAudit(context)).audit;
    if (after.package !== data.package || after.packageVersion !== data.packageVersion || after.inaccessible.length) {
      throw Error('Package registration or data root verification changed');
    }
    journal.status = 'isolated';
    await save();
    return { status: 'activity-paths-isolated', id, directory, archiveId: data.archiveId,
      physicalPathsVerified: true, packageRegistrationVerified: true, identityVerified: false };
  } catch (error) {
    try { await restoreMoved(journal, directory, guard); }
    catch { throw Error('Isolation stopped; rollback incomplete. Preserve the private journal and quarantine.', { cause: error }); }
    throw Error('Isolation stopped and moved data was rolled back.', { cause: error });
  }
}

export async function applyWindowsWorkflow(id, context = {}) {
  const { home, audit, guard } = await checkedAudit(context);
  const root = await openPrivateRoot(home);
  if (typeof id !== 'string' || !uuid.test(id)) throw Error('A valid Windows workflow ID is required');
  return locked(root, async () => {
    const plan = await readJSON(path.join(root, 'plan-' + id + '.json'));
    if (plan.version !== VERSION || plan.id !== id || !['archive', 'fresh'].includes(plan.operation)) throw Error('Unsupported Windows workflow plan');
    const data = plan.operation === 'archive' ? await planArchive(plan.spec, audit) : await planFresh(plan.spec, audit, root);
    if (!equal(data, plan.data)) throw Error('Windows plan expired; preview again');
    return plan.operation === 'archive' ? archive(root, id, data.files, data.ids) : isolate(root, id, data, guard, context);
  });
}

export async function verifyWindowsArchive(id, context = {}) {
  const { home } = await checkedAudit(context);
  const archive = await readArchive(await openPrivateRoot(home), id);
  return { status: 'archive-verified', directory: archive.directory, files: archive.manifest.sources.length };
}

export async function rollbackWindowsWorkflow(id, context = {}) {
  const { home, guard } = await checkedAudit(context);
  const root = await openPrivateRoot(home);
  const directory = runPath(root, id, 'fresh');
  await safe(directory);
  verifyPrivateWindowsTree(directory);
  const journal = await readJSON(path.join(directory, 'journal.json'));
  const plan = await readJSON(path.join(root, 'plan-' + id + '.json'));
  if (journal.schema !== 1 || journal.id !== id || !Array.isArray(journal.entries)
    || plan.operation !== 'fresh' || plan.id !== id || !equal(journal.entries.map(entry => entry.path), plan.data.paths)
    || journal.entries.some((entry, index) => entry.index !== index || !equal(entry.before, plan.data.inputs[entry.path]) || !within(entry.path, home)
      || within(entry.path, privateRoot(home)) || within(privateRoot(home), entry.path))) throw Error('Invalid isolation journal');
  return locked(root, async () => {
    await restoreMoved(journal, directory, guard);
    return { status: journal.status, id, directory };
  });
}
