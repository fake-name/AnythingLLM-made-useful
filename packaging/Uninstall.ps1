[CmdletBinding()]
param([string]$StorageDirectory = (Join-Path $env:APPDATA 'anythingllm-desktop\storage'))
$ErrorActionPreference = 'Stop'
try {
    $source = Join-Path $PSScriptRoot 'plugins'
    $destination = Join-Path $StorageDirectory 'plugins\agent-skills'
    foreach ($folder in Get-ChildItem -LiteralPath $source -Directory) {
        if ($folder.Name -notmatch '^[A-Za-z][A-Za-z0-9]+$') { throw 'Invalid plugin folder.' }
        $target = Join-Path $destination $folder.Name
        if (-not (Test-Path -LiteralPath $target)) { continue }
        $manifest = Get-Content -LiteralPath (Join-Path $target 'plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($manifest.package -eq 'anythingllm-made-useful' -and $manifest.hubId -eq $folder.Name) {
            Remove-Item -LiteralPath $target -Recurse -Force
        } else { Write-Warning "Left unrelated plugin '$($folder.Name)' intact." }
    }
    Write-Host 'Removed Made Useful tools. Restart AnythingLLM.'
    Write-Host 'Project files, registrations, logs, backups, support files and running jobs were left intact.'
    Write-Host 'Stop background jobs before uninstalling if you want them to terminate.'
} catch { Write-Error $_ -ErrorAction Continue; exit 1 }
