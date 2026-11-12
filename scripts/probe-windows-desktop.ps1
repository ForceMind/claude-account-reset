# Runs on a disposable Windows runner. It does not sign in or read credential values.
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:RUNNER_TEMP 'claude-desktop-layout-probe'
New-Item -ItemType Directory -Path $root | Out-Null
$setup = Join-Path $root 'ClaudeSetup.exe'
$package = Join-Path $root 'Claude.msix'
$evidence = [ordered]@{ setup = 'unavailable'; package = 'unavailable'; install = 'not-attempted'; profiles = @() }

curl.exe -fsSL --max-time 60 https://claude.ai/api/desktop/win32/x64/setup/latest/redirect --output $setup
if ($LASTEXITCODE -eq 0) {
    $signature = Get-AuthenticodeSignature -LiteralPath $setup
    $evidence.setup = [ordered]@{ signature = [string]$signature.Status; version = (Get-Item -LiteralPath $setup).VersionInfo.ProductVersion }
}
curl.exe -fsSL --max-time 90 https://claude.ai/api/desktop/win32/x64/msix/latest/redirect --output $package
if ($LASTEXITCODE -eq 0) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($package)
    try {
        $entry = $archive.GetEntry('AppxManifest.xml')
        $reader = [IO.StreamReader]::new($entry.Open())
        try { [xml]$manifest = $reader.ReadToEnd() } finally { $reader.Dispose() }
        $evidence.package = [ordered]@{
            name = [string]$manifest.Package.Identity.Name
            architecture = [string]$manifest.Package.Identity.ProcessorArchitecture
            version = [string]$manifest.Package.Identity.Version
            publisher = [string]$manifest.Package.Identity.Publisher
        }
    } finally { $archive.Dispose() }
    try {
        Add-AppxPackage -Path $package
        $installed = Get-AppxPackage -Name $manifest.Package.Identity.Name | Select-Object -First 1
        if (!$installed) { throw 'MSIX registration unavailable' }
        $evidence.install = 'registered'
        $id = $manifest.Package.Applications.Application[0].Id
        Start-Process explorer.exe -ArgumentList ('shell:AppsFolder\' + $installed.PackageFamilyName + '!' + $id)
        $base = Join-Path $env:LOCALAPPDATA ('Packages\' + $installed.PackageFamilyName)
        $candidates = @{
            'roaming/Claude' = (Join-Path $env:APPDATA 'Claude')
            'package/LocalCache/Roaming/Claude' = (Join-Path $base 'LocalCache\Roaming\Claude')
            'package/LocalState' = (Join-Path $base 'LocalState')
        }
        $markers = @('config.json','claude_desktop_config.json','Network\Cookies','Cookies','Local Storage\leveldb','claude-code-sessions')
        foreach ($attempt in 1..20) {
            if ($candidates.Values | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'config.json') }) { break }
            Start-Sleep -Seconds 1
        }
        foreach ($label in $candidates.Keys) {
            if (Test-Path -LiteralPath $candidates[$label]) {
                $present = @($markers | Where-Object { Test-Path -LiteralPath (Join-Path $candidates[$label] $_) })
                $evidence.profiles += @{ layout = $label; knownMarkers = $present }
            }
        }
    } catch { $evidence.install = 'unavailable: ' + $_.FullyQualifiedErrorId }
}
$evidence | ConvertTo-Json -Depth 5
