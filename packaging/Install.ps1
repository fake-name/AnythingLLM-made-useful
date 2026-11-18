[CmdletBinding()]
param([string]$StorageDirectory = (Join-Path $env:APPDATA 'anythingllm-desktop\storage'))
$ErrorActionPreference = 'Stop'
$owner = 'anythingllm-made-useful'
$legacy = @{
    amu_list_projects='ListProjects'; amu_register_project='RegisterProject'; amu_forget_project='ForgetProject'
    amu_list_directory='Glob'; amu_read_file='Read'; amu_write_file='Write'; amu_edit_file='Edit'
    amu_search_files='Grep'; amu_view_image='Read'; amu_run_command='PowerShell'; amu_start_command='PowerShell'
    amu_job_status='TaskOutput'; amu_stop_job='TaskStop'; amu_list_jobs='ListTasks'; amu_list_skills='ListSkills'; amu_read_skill='Skill'
}
function Get-Manifest([string]$Directory) {
    Get-Content -LiteralPath (Join-Path $Directory 'plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json
}
try {
    if (-not (Test-Path -LiteralPath $StorageDirectory -PathType Container)) {
        throw "AnythingLLM storage was not found at '$StorageDirectory'. Launch AnythingLLM Desktop once, or rerun with -StorageDirectory followed by the folder shown by its Open storage command."
    }
    $source = Join-Path $PSScriptRoot 'plugins'
    if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw 'Extract the entire release ZIP before running Install.cmd.' }
    $destination = Join-Path $StorageDirectory 'plugins\agent-skills'
    $state = Join-Path $StorageDirectory 'plugins\anythingllm-made-useful'
    $backupRoot = Join-Path $state ('backups\' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fffffff'))
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $folders = @(Get-ChildItem -LiteralPath $source -Directory)
    # Preflight every generic tool name before making any changes. Never replace
    # a Read/Bash/etc plugin belonging to someone else.
    foreach ($folder in $folders) {
        $manifest = Get-Manifest $folder.FullName
        if ($manifest.package -ne $owner -or $manifest.hubId -ne $folder.Name -or $folder.Name -notmatch '^[A-Za-z][A-Za-z0-9]+$') { throw "Invalid plugin folder: $($folder.Name)" }
        $target = Join-Path $destination $folder.Name
        if (Test-Path -LiteralPath $target) {
            $old = Get-Manifest $target
            if ($old.package -ne $owner -or $old.hubId -ne $folder.Name) { throw "Tool name '$($folder.Name)' is already used by another plugin. Rename or remove that plugin before installing." }
        }
    }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    New-Item -ItemType Directory -Path $state -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'support\bin') -Destination $state -Recurse -Force
    $count = 0
    foreach ($folder in $folders) {
        $manifest = Get-Manifest $folder.FullName
        $target = Join-Path $destination $folder.Name
        $stage = Join-Path $destination ('.made-useful-stage-' + [guid]::NewGuid().ToString())
        try {
            Copy-Item -LiteralPath $folder.FullName -Destination $stage -Recurse
            $old = $null
            if (Test-Path -LiteralPath $target) { $old = Get-Manifest $target }
            else {
                foreach ($name in @($legacy.Keys | Sort-Object)) {
                    if ($legacy[$name] -ne $folder.Name) { continue }
                    $oldDirectory = Join-Path $destination $name
                    if (-not (Test-Path -LiteralPath $oldDirectory)) { continue }
                    $candidate = Get-Manifest $oldDirectory
                    if ($candidate.hubId -eq $name -and $candidate.name -like 'Made Useful:*') { $old = $candidate; break }
                }
            }
            if ($null -ne $old) {
                $manifest.active = $old.active
                foreach ($property in $manifest.setup_args.PSObject.Properties) {
                    $previous = $old.setup_args.PSObject.Properties[$property.Name]
                    if ($null -ne $previous) { $property.Value.value = $previous.Value.value }
                }
            }
            [IO.File]::WriteAllText((Join-Path $stage 'plugin.json'), ($manifest | ConvertTo-Json -Depth 20), $utf8)
            if (Test-Path -LiteralPath $target) {
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
    foreach ($name in $legacy.Keys) {
        $oldDirectory = Join-Path $destination $name
        if (-not (Test-Path -LiteralPath $oldDirectory)) { continue }
        $old = Get-Manifest $oldDirectory
        if ($old.hubId -eq $name -and $old.name -like 'Made Useful:*') {
            New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
            Move-Item -LiteralPath $oldDirectory -Destination (Join-Path $backupRoot $name)
        }
    }
    Write-Host "Installed $count tools to $destination"
    Write-Host 'Quit AnythingLLM from its system tray, reopen it, then check Settings > Agent Skills.'
    Write-Host 'Project registrations and command logs are preserved when upgrading.'
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}
