[CmdletBinding()]
param([string]$StorageDirectory = (Join-Path $env:APPDATA 'anythingllm-desktop\storage'))
$ErrorActionPreference = 'Stop'
try {
    $source = Join-Path $PSScriptRoot 'plugins'
    $destination = Join-Path $StorageDirectory 'plugins\agent-skills'
    foreach ($folder in Get-ChildItem -LiteralPath $source -Directory) {
        if ($folder.Name -notmatch '^amu_[a-z_]+$') { throw 'Invalid plugin folder.' }
        $target = Join-Path $destination $folder.Name
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    }
    Write-Host 'Removed Made Useful tools. Restart AnythingLLM.'
    Write-Host 'Project files, registrations, logs, backups, and running jobs were left intact.'
    Write-Host 'Stop background jobs before uninstalling if you want them to terminate.'
} catch { Write-Error $_ -ErrorAction Continue; exit 1 }
