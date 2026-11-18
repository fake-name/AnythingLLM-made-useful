[CmdletBinding()]
param([string]$StorageDirectory = (Join-Path $env:APPDATA 'anythingllm-desktop\storage'))
$ErrorActionPreference = 'Stop'
try {
    if (-not (Test-Path -LiteralPath $StorageDirectory -PathType Container)) {
        throw "AnythingLLM storage was not found at '$StorageDirectory'. Launch AnythingLLM Desktop once, or rerun with -StorageDirectory followed by the folder shown by its Open storage command."
    }
    $source = Join-Path $PSScriptRoot 'plugins'
    if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw 'Extract the entire release ZIP before running Install.cmd.' }
    $destination = Join-Path $StorageDirectory 'plugins\agent-skills'
    $backupRoot = Join-Path $StorageDirectory ('plugins\anythingllm-made-useful\backups\' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fffffff'))
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    $count = 0
    foreach ($folder in Get-ChildItem -LiteralPath $source -Directory) {
        $manifest = Get-Content -LiteralPath (Join-Path $folder.FullName 'plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($manifest.hubId -ne $folder.Name -or $folder.Name -notmatch '^amu_[a-z_]+$') { throw "Invalid plugin folder: $($folder.Name)" }
        $target = Join-Path $destination $folder.Name
        $stage = Join-Path $destination ('.amu-stage-' + [guid]::NewGuid().ToString())
        try {
            Copy-Item -LiteralPath $folder.FullName -Destination $stage -Recurse
            if (Test-Path -LiteralPath $target) {
                $old = Get-Content -LiteralPath (Join-Path $target 'plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json
                $manifest.active = $old.active
                foreach ($property in $manifest.setup_args.PSObject.Properties) {
                    $previous = $old.setup_args.PSObject.Properties[$property.Name]
                    if ($null -ne $previous) { $property.Value.value = $previous.Value.value }
                }
                [IO.File]::WriteAllText((Join-Path $stage 'plugin.json'), ($manifest | ConvertTo-Json -Depth 20), $utf8)
                New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
                Move-Item -LiteralPath $target -Destination (Join-Path $backupRoot $folder.Name)
            }
            try { Move-Item -LiteralPath $stage -Destination $target }
            catch {
                $backup = Join-Path $backupRoot $folder.Name
                if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $target }
                throw
            }
            $count++
        } finally { if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force } }
    }
    Write-Host "Installed $count Made Useful tools to $destination"
    Write-Host 'Quit AnythingLLM from its system tray, reopen it, then check Settings > Agent Skills.'
    Write-Host 'Project registrations and command logs are preserved when upgrading.'
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}
