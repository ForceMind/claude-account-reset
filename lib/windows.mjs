import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function windowsDesktopRoaming(home, environment = {}) {
  const local = environment.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  return path.join(local, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming');
}

export function isWindowsDesktopProfile(directory, home, environment = {}) {
  return path.relative(path.join(windowsDesktopRoaming(home, environment), 'Claude'), directory) === '';
}

export function windowsPowerShell(script, variables = {}) {
  const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)\n$ErrorActionPreference = 'Stop'\n${script}`;
  const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
    env: { ...process.env, ...variables }, encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024
  });
  if (result.status !== 0) {
    const detail = result.error ?? new Error(result.stderr.trim() || `PowerShell exit status ${result.status}`);
    throw Error('Windows permission or process inspection failed', { cause: detail });
  }
  return result.stdout.trim();
}

export function windowsProcesses() {
  const json = windowsPowerShell('Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,ExecutablePath | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath | ConvertTo-Json -Compress');
  const rows = JSON.parse(json);
  if (!Array.isArray(rows) || !rows.some(row => row.ProcessId === process.pid)) throw Error('Cannot inspect Windows process table');
  return rows.map(row => `${row.ProcessId} ${row.ParentProcessId} ${row.ExecutablePath || row.Name}`).join('\n');
}

export function protectWindowsDirectory(directory) {
  windowsPowerShell(`
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User
$system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($user)
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($user, $system)) {
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($rule)
}
[IO.Directory]::SetAccessControl($env:CAR_PATH, $acl)
$actual = [IO.Directory]::GetAccessControl($env:CAR_PATH)
if (!$actual.AreAccessRulesProtected) { throw 'Directory inheritance is active' }
$rules = $actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
foreach ($rule in $rules) {
  if ($rule.IdentityReference -ne $user -and $rule.IdentityReference -ne $system) { throw 'Unexpected directory permission' }
}
`, { CAR_PATH: directory });
}

export function windowsFileAcl(file) {
  return windowsPowerShell(`
$section = [Security.AccessControl.AccessControlSections]::Access
if ([IO.Directory]::Exists($env:CAR_PATH)) {
  $acl = [IO.Directory]::GetAccessControl($env:CAR_PATH, $section)
} else {
  $acl = [IO.File]::GetAccessControl($env:CAR_PATH, $section)
}
$acl.GetSecurityDescriptorSddlForm($section)
`, { CAR_PATH: file });
}

export function preserveWindowsFileAcl(file, acl) {
  windowsPowerShell(`
$section = [Security.AccessControl.AccessControlSections]::Access
$security = [IO.File]::GetAccessControl($env:CAR_PATH, $section)
if ($security.GetSecurityDescriptorSddlForm($section) -cne $env:CAR_DACL) {
  $security.SetSecurityDescriptorSddlForm($env:CAR_DACL, $section)
  [IO.File]::SetAccessControl($env:CAR_PATH, $security)
  $security = [IO.File]::GetAccessControl($env:CAR_PATH, $section)
  if ($security.GetSecurityDescriptorSddlForm($section) -cne $env:CAR_DACL) {
    throw 'Cannot reproduce the original file permissions in this directory'
  }
}
`, { CAR_PATH: file, CAR_DACL: acl });
}

export function moveWindowsFileWithoutOverwrite(temporary, target) {
  windowsPowerShell('[IO.File]::Move($env:CAR_TEMP, $env:CAR_TARGET)', { CAR_TEMP: temporary, CAR_TARGET: target });
}
