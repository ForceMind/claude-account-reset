import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function windowsPowerShell(script, variables = {}) {
  const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)\n$ErrorActionPreference = 'Stop'\n${script}`;
  const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
    env: { ...process.env, ...variables }, encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024
  });
  if (result.status !== 0) throw Error('Windows permission or process inspection failed');
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
Set-Acl -LiteralPath $env:CAR_PATH -AclObject $acl
$actual = Get-Acl -LiteralPath $env:CAR_PATH
if (!$actual.AreAccessRulesProtected) { throw 'Directory inheritance is active' }
$rules = $actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
foreach ($rule in $rules) {
  if ($rule.IdentityReference -ne $user -and $rule.IdentityReference -ne $system) { throw 'Unexpected directory permission' }
}
`, { CAR_PATH: directory });
}

export function windowsFileAcl(file) {
  return windowsPowerShell(`(Get-Acl -LiteralPath $env:CAR_PATH).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)`, { CAR_PATH: file });
}

export function installWindowsFile(temporary, target, { create, acl }) {
  windowsPowerShell(`
if ($env:CAR_CREATE -eq '1') {
  if ($env:CAR_DACL) {
    $security = Get-Acl -LiteralPath $env:CAR_TEMP
    $security.SetSecurityDescriptorSddlForm($env:CAR_DACL, [Security.AccessControl.AccessControlSections]::Access)
    Set-Acl -LiteralPath $env:CAR_TEMP -AclObject $security
  }
  [IO.File]::Move($env:CAR_TEMP, $env:CAR_TARGET)
} else {
  [IO.File]::Replace($env:CAR_TEMP, $env:CAR_TARGET, [NullString]::Value, $false)
}
`, { CAR_TEMP: temporary, CAR_TARGET: target, CAR_CREATE: create ? '1' : '0', CAR_DACL: acl ?? '' });
}
