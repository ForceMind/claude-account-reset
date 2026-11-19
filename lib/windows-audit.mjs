import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { exists, safe, within } from './safety.mjs';
import { windowsPowerShell } from './windows.mjs';
import { ensureStopped } from './platform.mjs';

const family = 'Claude_pzs8sxrjxfjjc';
export const desktopMarkers = [
  'config.json', 'claude_desktop_config.json', 'Cookies', 'Cookies-wal',
  'Cookies-shm', 'Cookies-journal', 'Network/Cookies', 'Network/Cookies-wal',
  'Network/Cookies-shm', 'Network/Cookies-journal', 'config.json.journal',
  'Local Storage', 'Session Storage', 'IndexedDB', 'Local State',
  'claude-code-sessions', 'local-agent-mode-sessions', 'scratch-workspaces',
  'side-session-notes', 'git-shadow', 'remote-control-state.json', 'ant-did',
  'ant-device-registry.json', 'ccd-session-presets.json', 'plugin-list', 'Extensions',
  'Extension State', 'Local Extension Settings', 'cowork-enabled-cli-ops.json',
  'cowork-memory-resets.json'
];
const codeMarkers = ['.claude.json', '.credentials.json', 'settings.json', 'settings.local.json',
  'backups', 'projects', 'sessions', 'file-history', 'attachments', 'uploads', 'history.jsonl'];
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && path.isAbsolute(a) && path.relative(a, b) === '';

function nativeWindowsState() {
  const state = JSON.parse(windowsPowerShell(String.raw`
$result = @{
  home = [Environment]::GetFolderPath('UserProfile', 'DoNotVerify')
  local = [Environment]::GetFolderPath('LocalApplicationData', 'DoNotVerify')
  roaming = [Environment]::GetFolderPath('ApplicationData', 'DoNotVerify')
  package = 'unverified'
  credentialManager = 'unverified'
  overrides = @{}
  configuredCode = @{}
}
try {
  $folder = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
  $result.registryLocal = [Environment]::ExpandEnvironmentVariables($folder.'Local AppData')
  $result.registryRoaming = [Environment]::ExpandEnvironmentVariables($folder.AppData)
} catch {}
try {
  $package = @(Get-AppxPackage -Name Claude | Where-Object { $_.PackageFamilyName -eq 'Claude_pzs8sxrjxfjjc' })
  if ($package.Count -eq 0) { $result.package = 'not-registered' }
  if ($package.Count -eq 1) {
    $result.package = 'registered'
    $result.packageVersion = [string]$package[0].Version
  }
} catch {}
foreach ($scope in @('Process', 'User', 'Machine')) {
  try {
    $vars = [Environment]::GetEnvironmentVariables($scope)
    $result.overrides[$scope] = @($vars.Keys | Where-Object { $_ -match '^(ANTHROPIC_.*|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CONFIG_DIR|CLAUDE_CODE_USE_.*)$' })
    if ($vars['CLAUDE_CONFIG_DIR']) { $result.configuredCode[$scope] = $vars['CLAUDE_CONFIG_DIR'] }
  } catch { $result.overrides[$scope] = $null }
}
try {
  $listing = & "$env:SystemRoot\System32\cmdkey.exe" /list
  if ($LASTEXITCODE -eq 0) {
    $result.credentialManager = if ($listing -match '(?i)\b(Claude|Anthropic)\b') { 'possible-match' } else { 'no-project-name-match' }
  }
} catch {}
$result | ConvertTo-Json -Compress -Depth 5
`));
  return state;
}

export function demoWindowsState(home) {
  const local = path.join(home, 'AppData', 'Local');
  const roaming = path.join(home, 'AppData', 'Roaming');
  return { home, local, roaming, registryLocal: local, registryRoaming: roaming,
    package: 'registered', credentialManager: 'synthetic', overrides: {}, configuredCode: {} };
}

export async function auditWindows(home, { environment = process.env, state, guard = ensureStopped } = {}) {
  guard();
  const native = state ?? nativeWindowsState();
  const verified = samePath(home, native.home)
    && samePath(native.local, native.registryLocal) && samePath(native.roaming, native.registryRoaming)
    && (!environment.USERPROFILE || samePath(environment.USERPROFILE, home))
    && (!environment.LOCALAPPDATA || samePath(environment.LOCALAPPDATA, native.local))
    && (!environment.APPDATA || samePath(environment.APPDATA, native.roaming))
    && [native.local, native.roaming].every(root => !samePath(home, root) && within(root, home))
    && !within(native.local, native.roaming) && !within(native.roaming, native.local);
  const roots = [], inaccessible = [];
  const result = { rootStatus: 'unverified', package: native.package, packageVersion: native.packageVersion ?? null,
    credentialManager: native.credentialManager, overrides: native.overrides, roots, inaccessible };
  if (!verified) return { ...result, rootReason: 'known-folder-mismatch' };
  try {
    for (const root of [home, native.local, native.roaming]) {
      await safe(root);
      if (!await exists(root) && state) continue;
      // Use Node's native disk path. Electron overrides the promise-based
      // realpath for ASAR, including in the packaged utility process.
      const physical = realpathSync.native(root);
      const dosPath = /^\\\\\?\\[a-z]:\\/i.test(physical) ? physical.slice(4) : physical;
      if (!samePath(dosPath, root)) {
        // An 8.3 alias can resolve to a different spelling of the same
        // folder. Both spellings must be safe and identify the same NTFS entry.
        await safe(dosPath);
        const original = await fs.stat(root, { bigint: true });
        const resolved = await fs.stat(dosPath, { bigint: true });
        if (!original.isDirectory() || !resolved.isDirectory() || original.ino === 0n
          || original.dev !== resolved.dev || original.ino !== resolved.ino) {
          return { ...result, rootReason: 'physical-path-mismatch' };
        }
      }
    }
  } catch { return { ...result, rootReason: 'physical-path-unavailable' }; }
  result.rootStatus = 'verified';
  async function add(base, relative, kind, markers, canMove, file = false) {
    const directory = path.join(base, relative);
    try {
      await safe(directory);
      if (!await exists(directory)) return;
      if (!(file ? (await fs.stat(directory)).isFile() : (await fs.stat(directory)).isDirectory())) throw Error('Unexpected data type');
      const present = [];
      for (const marker of markers) {
        const candidate = path.join(directory, marker);
        await safe(candidate);
        if (await exists(candidate)) present.push(marker);
      }
      roots.push({ path: directory, kind, present, canMove: typeof canMove === 'function' ? canMove(present) : canMove });
    } catch { inaccessible.push({ path: directory, kind }); }
  }
  const code = async (base, name, kind, canMove) => add(base, name, kind, codeMarkers, canMove);
  const pkg = path.join(native.local, 'Packages', family);
  const packageVerified = native.package === 'registered';
  await add(native.local, path.join('Claude-Data', family), 'official-claude-data', desktopMarkers, packageVerified);
  await add(pkg, path.join('LocalCache', 'Roaming', 'Claude'), 'msix-profile', desktopMarkers, packageVerified);
  await add(pkg, path.join('LocalCache', 'Roaming', 'Claude-3p'), 'msix-third-party-profile', desktopMarkers, false);
  for (const slot of ['LocalState', 'RoamingState', 'LocalCache', 'Settings', 'TempState', 'AC', 'SystemAppData']) {
    // LocalCache contains the MSIX profile and can be selected independently.
    await add(pkg, slot, 'msix-' + slot, desktopMarkers,
      packageVerified && !['LocalCache', 'AC', 'SystemAppData'].includes(slot));
  }
  for (const base of [native.roaming, native.local]) {
    await add(base, 'Claude', 'other-desktop-layout', desktopMarkers,
      present => present.includes('config.json') || present.includes('claude_desktop_config.json'));
    await add(base, 'Claude-3p', 'third-party-profile', desktopMarkers, false);
  }
  await code(home, '.claude', 'default-code', true);
  for (const name of ['.claude.json', '.claude.json.backup']) await add(home, name, 'default-code-config', [], true, true);
  for (const override of new Set(Object.values(native.configuredCode ?? {}).filter(value => typeof value === 'string' && path.isAbsolute(value)))) {
    const location = path.resolve(override);
    if (roots.some(item => samePath(item.path, location))) continue;
    await code(path.dirname(location), path.basename(location), 'configured-code', false);
    const config = location + '.json';
    await add(path.dirname(config), path.basename(config), 'configured-code-config', [], false, true);
  }
  return result;
}
